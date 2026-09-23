import jwt from "jsonwebtoken";

import User from "../users/user.model";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

import {
  checkPhone,
  isPhoneOk,
  findCountryRule,
  DEFAULT_COUNTRY_CODE,
} from "../../shared/constants/phone";

import { generateOtp, hashOtp, verifyOtpHash, maskOtp } from "./utils/otp";
import { sendOtpSMS, isMsg91Configured } from "./msg91.service";

/*
|--------------------------------------------------------------------------
| Authentication
|--------------------------------------------------------------------------
|
| THE HOLE THIS CLOSES
|
| The previous version of this file contained:
|
|     // const otp = generateOtp();
|     const otp = "123456";
|     ...
|     // await sendOtpSMS(phone, otp);
|
| Both the generator and the send were commented out. On a deployed server
| that means anybody who installs the APK can type ANY phone number, enter
| 123456, and be logged in as that person - including as you. It also meant
| the endpoint reported "OTP sent successfully" having sent nothing, so the
| app had no way to know whether an SMS had gone out.
|
| Everything below exists because a public, unauthenticated endpoint that
| costs money per call needs more than a happy path.
|
| WHAT PROTECTS THE OTP
|
|   It is random, from crypto, not Math.random.
|   It is stored as a hash, so a database read is not a login.
|   It expires in five minutes.
|   Five wrong guesses destroys it.
|   Sends are rate limited per number, per window and per day.
|
| The expiry and the attempt cap are what actually make a six-digit code
| safe. The hash is what stops a leaked backup being a master key.
|
*/

/* ── Tunables ──────────────────────────────────────────────────────────── */

const OTP_TTL_MS = 5 * 60 * 1000;

/* Sends allowed inside one rolling window, and how long that window is. */
const SEND_WINDOW_MS = 15 * 60 * 1000;
const SEND_LIMIT_PER_WINDOW = 3;

/* A ceiling on top of the window, so three every fifteen minutes forever
   is not possible. */
const SEND_LIMIT_PER_DAY = 10;

/* The shortest gap between two sends to the same number. Stops a
   double-tapped button costing two SMS. */
const MIN_RESEND_GAP_MS = 30 * 1000;

/* Wrong guesses before the code is destroyed. */
const MAX_VERIFY_ATTEMPTS = 5;

const TOKEN_TTL = "30d";

/*
|--------------------------------------------------------------------------
| The same limits, while no SMS is being sent
|--------------------------------------------------------------------------
|
| Every number above exists for ONE reason: an SMS costs money and a
| flooded number is somebody else's phone ringing at 3am. When FIXED_OTP is
| active neither is true - the code is 123456, nothing leaves the server,
| and the cost of a send is zero.
|
| So the production limits were protecting nothing and blocking QA. Ten
| logins in a day is nothing when you are testing a login flow; the tester
| hits "Daily OTP limit reached for this number" and has to wait until
| tomorrow or edit the database. The 30-second resend gap is worse - it
| makes a screen that is meant to be tapped through feel broken.
|
| They are RAISED, not removed. A runaway retry loop in the app should
| still trip something loud rather than spin forever, and the shape of the
| guard stays identical so production behaviour is never a different code
| path that only runs for real users.
|
| The switch is FIXED_OTP, not TESTING_MODE, on purpose: FIXED_OTP is the
| thing that actually means "no SMS is going out". TESTING_MODE turns it on
| in production, and locally it is on by default without either flag - both
| cases want the same relaxed numbers.
*/

const TEST_IP_LIMIT = 500;
const TEST_SEND_LIMIT_PER_WINDOW = 1000;
const TEST_SEND_LIMIT_PER_DAY = 1000;
const TEST_MIN_RESEND_GAP_MS = 0;

/*
| FIXED_OTP is declared further down this file. That is fine - this only
| ever runs inside a request, long after the module has finished loading.
*/

const limits = () => {
  const noSms = FIXED_OTP !== null;

  return {
    noSms,
    ipLimit: noSms ? TEST_IP_LIMIT : IP_LIMIT,
    perWindow: noSms ? TEST_SEND_LIMIT_PER_WINDOW : SEND_LIMIT_PER_WINDOW,
    perDay: noSms ? TEST_SEND_LIMIT_PER_DAY : SEND_LIMIT_PER_DAY,
    resendGapMs: noSms ? TEST_MIN_RESEND_GAP_MS : MIN_RESEND_GAP_MS,
  };
};

/*
|--------------------------------------------------------------------------
| Per-IP Throttle
|--------------------------------------------------------------------------
|
| The per-number limits above stop one number being hammered. They do not
| stop one attacker cycling through thousands of numbers, which costs the
| same money and is the cheaper attack to run.
|
| In memory on purpose. A Mongo write per request on the free tier is a real
| cost for a defence that only needs to hold for minutes, and the per-number
| limits - which ARE persisted - remain intact across a restart. This is the
| second layer, not the only one.
|
| Move it to Redis if you ever run more than one instance: each instance
| would otherwise keep its own count and the effective limit multiplies.
|
*/

const ipHits = new Map<string, { count: number; windowStart: number }>();

const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;

const pruneIpHits = (now: number) => {
  if (ipHits.size < 5000) return;

  for (const [key, entry] of ipHits) {
    if (now - entry.windowStart > IP_WINDOW_MS) ipHits.delete(key);
  }
};

const checkIpLimit = (ip?: string) => {
  if (!ip) return;

  const now = Date.now();

  pruneIpHits(now);

  const entry = ipHits.get(ip);

  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return;
  }

  entry.count += 1;

  if (entry.count > limits().ipLimit) {
    throw new AppError(
      "Too many requests from this device. Please try again later.",
      429,
    );
  }
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

const minutesUntil = (from: number, span: number) =>
  Math.max(1, Math.ceil((span - from) / 60000));

/*
| Reset the rolling counters if their windows have aged out. Done on read
| rather than by a scheduled job, so there is nothing to keep running.
*/

const rollWindows = (user: any, now: number) => {
  if (
    !user.otpWindowStartedAt ||
    now - new Date(user.otpWindowStartedAt).getTime() > SEND_WINDOW_MS
  ) {
    user.otpWindowStartedAt = new Date(now);
    user.otpSendCount = 0;
  }

  const dayStart = user.otpDayStartedAt
    ? new Date(user.otpDayStartedAt).getTime()
    : 0;

  if (!dayStart || now - dayStart > 24 * 60 * 60 * 1000) {
    user.otpDayStartedAt = new Date(now);
    user.otpDailyCount = 0;
  }
};

const assertWithinSendLimits = (user: any, now: number) => {
  rollWindows(user, now);

  const { perWindow, perDay, resendGapMs } = limits();

  if (resendGapMs > 0 && user.lastOtpSentAt) {
    const since = now - new Date(user.lastOtpSentAt).getTime();

    if (since < resendGapMs) {
      const wait = Math.ceil((resendGapMs - since) / 1000);

      throw new AppError(
        `Please wait ${wait} more second${wait === 1 ? "" : "s"} before requesting another OTP.`,
        429,
      );
    }
  }

  if ((user.otpSendCount || 0) >= perWindow) {
    const elapsed = now - new Date(user.otpWindowStartedAt).getTime();

    throw new AppError(
      `Too many OTP requests. Please try again in ${minutesUntil(elapsed, SEND_WINDOW_MS)} minutes.`,
      429,
    );
  }

  if ((user.otpDailyCount || 0) >= perDay) {
    throw new AppError(
      "Daily OTP limit reached for this number. Please try again tomorrow.",
      429,
    );
  }
};

/*
|--------------------------------------------------------------------------
| Send OTP
|--------------------------------------------------------------------------
|
| `countryCode` is optional. Older builds of the app send only a bare
| ten-digit string, and they keep working - a missing country means India,
| which is what every existing row in the database already is.
|
*/

/*
|--------------------------------------------------------------------------
| Trace
|--------------------------------------------------------------------------
|
| A numbered, dev-only trace of the whole OTP path, so "it does not work"
| can be answered by looking at where the numbers stop instead of guessing.
|
| Every step prints BEFORE the thing it describes is attempted. That is the
| point: the last line you see is the step that FAILED, not the last one
| that succeeded. A trace that logs after the fact goes quiet at exactly
| the moment you need it to speak.
|
| Silent in production - `NODE_ENV=production` disables it wholesale, so
| phone numbers and codes cannot leak into a hosted log.
*/

const TRACE = process.env.NODE_ENV !== "production";

/*
|--------------------------------------------------------------------------
| DEV_FIXED_OTP - a fixed code for local testing
|--------------------------------------------------------------------------
|
| Set DEV_FIXED_OTP=123456 in .env and EVERY number gets that code, with no
| SMS sent and no MSG91 involvement at all. Login works while the delivery
| problem is still being sorted out.
|
| UNSET BY DEFAULT. With no DEV_FIXED_OTP in .env nothing below changes
| anything: the code path is byte-for-byte what it was.
|
| THIS IS A COMPLETE AUTHENTICATION BYPASS
|
| Anyone who knows the code owns every account on the server. So it is not
| enough for it to be "meant for development" - the env var alone cannot be
| the only thing standing between a bypass and production. Two independent
| guards:
|
|   1. NODE_ENV=production refuses it outright and shouts. Deploying with
|      DEV_FIXED_OTP still set does not weaken the live server; it just
|      logs an error on boot and behaves normally.
|
|   2. The value must be exactly six digits. A stray "true" or "yes" in
|      .env does not silently become a code.
|
| It is deliberately NOT a boolean like DEV_BYPASS_OTP=true. Typing the
| actual six digits you are about to use makes the consequence obvious to
| whoever reads .env next.
|
| Note there is no branch in verifyOtpService for this. The fixed code is
| hashed and stored exactly like a random one, so verification, expiry,
| attempt caps and throttling all behave normally. Fewer special cases
| means fewer places for the bypass to leak.
*/

/*
|--------------------------------------------------------------------------
| TESTING_MODE - the fixed code on a DEPLOYED server, on purpose
|--------------------------------------------------------------------------
|
| Everything above assumes the bypass is a local-only convenience and that
| NODE_ENV=production is the wall keeping it off a real server. That stays
| the default.
|
| This flag is the deliberate exception. The app is in QA: testers need to
| log in as any of the seeded numbers without an SMS reaching a phone
| nobody owns, and they need it on the DEPLOYED server the APK talks to,
| not only on a laptop.
|
| BE CLEAR ABOUT WHAT THIS IS
|
| With TESTING_MODE=true, anyone who knows the code owns EVERY account on
| that server - not "in development", on whatever server this is set on.
| That is a reasonable trade while the only accounts are seeded test data.
| It stops being reasonable the moment one real person signs up.
|
| It is a SEPARATE variable from DEV_FIXED_OTP on purpose, so that turning
| it on is a decision someone made in words - not a side effect of
| forgetting to set NODE_ENV.
|
| TO TURN IT OFF: delete TESTING_MODE from the environment (or set it to
| anything other than "true"). Nothing else needs to change.
|
| The app is told as well - see `testingMode` in the send response - so the
| OTP screen can say plainly that this build is for testing and show the
| code, instead of leaving a tester staring at an empty box.
|
*/

/*
| Accepts the spellings people actually type into a hosting dashboard.
|
| This was `=== "true"` and nothing else, which meant TESTING_MODE=1 - a
| completely reasonable thing to type - silently evaluated to false and the
| server quietly kept sending real OTPs, with no hint anywhere as to why.
| An auth flag that fails closed is right; one that fails closed SILENTLY on
| a typo is how an afternoon disappears.
|
| Anything else set on it is loud rather than ignored: setting the variable
| at all is a clear intent, so a value that does not parse deserves a line
| in the log rather than silence.
*/

const TRUTHY = new Set(["true", "1", "yes", "y", "on", "enabled"]);

const FALSY = new Set(["false", "0", "no", "n", "off", "disabled", ""]);

export const TESTING_MODE = (() => {
  const raw = String(process.env.TESTING_MODE ?? "").trim().toLowerCase();

  if (TRUTHY.has(raw)) return true;

  if (!FALSY.has(raw)) {
    console.warn(
      `[auth] TESTING_MODE="${process.env.TESTING_MODE}" is not a value I ` +
        `recognise, so it is being read as OFF and real OTPs will be sent. ` +
        `Use TESTING_MODE=true.`,
    );
  }

  return false;
})();

const FIXED_OTP: string | null = (() => {
  /*
  |----------------------------------------------------------------------
  | ON BY DEFAULT OUTSIDE PRODUCTION
  |----------------------------------------------------------------------
  |
  | Requiring DEV_FIXED_OTP in .env meant "it does not work" whenever the
  | variable had not been added or the server had not been restarted - the
  | failure looked exactly like a broken feature. Locally, the code you
  | want is 123456 essentially always, so that is the default and the env
  | var only exists to CHANGE or TURN OFF that behaviour:
  |
  |     (nothing in .env)        -> 123456, no SMS      <- local default
  |     DEV_FIXED_OTP=654321     -> 654321, no SMS
  |     DEV_FIXED_OTP=off        -> real random OTPs over MSG91
  |
  | Production is untouched by all three UNLESS TESTING_MODE=true. Without
  | that flag the guard below refuses unconditionally.
  */

  let raw = String(
    process.env.DEV_FIXED_OTP === undefined
      ? "123456"
      : process.env.DEV_FIXED_OTP,
  ).trim();

  /*
  | An explicit opt-out, for testing the real MSG91 path.
  |
  | TESTING_MODE wins over it. The two say opposite things, and the one
  | that was typed as a whole-server decision beats the one that reads like
  | a leftover - but say so out loud, because a contradiction in .env that
  | resolves silently is how someone ends up debugging the wrong half.
  */
  if (/^(off|false|0|no|none|disabled)$/i.test(raw)) {
    if (TESTING_MODE) {
      console.warn(
        "\n[auth] TESTING_MODE=true and DEV_FIXED_OTP=off contradict each other.\n" +
          "[auth] TESTING_MODE wins - the fixed code stays ON at 123456.\n" +
          "[auth] Remove DEV_FIXED_OTP from .env to silence this.\n",
      );

      /* "off" is not a code. Fall through with the default one. */
      raw = "123456";
    } else {
      console.warn(
        "[auth] DEV_FIXED_OTP is off - real OTPs will be sent via MSG91.",
      );

      return null;
    }
  }

  if (!raw) return null;

  if (process.env.NODE_ENV === "production" && !TESTING_MODE) {
    /*
    | Silent unless it was set deliberately - on a correctly configured
    | production server this is simply the normal path, not an incident.
    */
    if (process.env.DEV_FIXED_OTP !== undefined) {
      console.error(
        "\n[auth] ############################################################\n" +
          "[auth] DEV_FIXED_OTP IS SET ON A PRODUCTION SERVER AND IS BEING\n" +
          "[auth] IGNORED. Remove it from the environment.\n" +
          "[auth] ############################################################\n",
      );
    }

    return null;
  }

  if (!/^\d{6}$/.test(raw)) {
    console.warn(
      `[auth] DEV_FIXED_OTP="${raw}" ignored - it must be exactly 6 digits.`,
    );

    return null;
  }

  console.warn(
    "\n[auth] **************************************************************\n" +
      `[auth] FIXED OTP ACTIVE - EVERY number logs in with  ${raw}\n` +
      "[auth] No SMS is sent. This is a COMPLETE AUTH BYPASS.\n" +
      "[auth]\n" +
      (TESTING_MODE
        ? "[auth] Reason: TESTING_MODE=true. This OVERRIDES the production\n" +
          `[auth] guard - NODE_ENV is "${process.env.NODE_ENV || "(unset)"}" and the\n` +
          "[auth] bypass is on regardless. That is deliberate, for QA.\n" +
          "[auth]\n" +
          "[auth] TURN IT OFF BEFORE THE FIRST REAL USER:\n" +
          "[auth]   delete TESTING_MODE from the environment,\n" +
          "[auth]   set NODE_ENV=production,\n" +
          "[auth]   and make sure MSG91_AUTH_KEY / MSG91_TEMPLATE_ID are set.\n"
        : `[auth] NODE_ENV is "${process.env.NODE_ENV || "(unset)"}". This is only\n` +
          "[auth] disabled when NODE_ENV=production - make sure your deployed\n" +
          "[auth] server sets it.\n" +
          "[auth]\n" +
          "[auth] Turn off with DEV_FIXED_OTP=off in .env\n") +
      "[auth] **************************************************************\n",
  );

  return raw;
})();

/*
|--------------------------------------------------------------------------
| Say the effective mode OUT LOUD, at boot, always
|--------------------------------------------------------------------------
|
| Everything above logs when the bypass is ON. Nothing logged when it was
| OFF - that was treated as the boring default and left silent.
|
| That silence cost real hours. `.env` is gitignored, so it never reaches
| Render; Render sets NODE_ENV=production by default; TESTING_MODE was never
| added there. The guard therefore returned null and the deployed server
| sent real MSG91 OTPs - correctly, and completely invisibly. The APK asked
| for a code that was going to a phone nobody owns, the Render log said
| nothing about OTP mode at all, and the local server WAS on 123456, so
| every local test passed.
|
| One unconditional line answers it. Whichever mode is live, the log says
| so on the first line after boot, on every environment.
|
| It also names the reason, because "real OTP mode" without "because
| TESTING_MODE is not set" leaves you checking the wrong three things.
*/

const describeOtpMode = () => {
  if (FIXED_OTP) {
    return TESTING_MODE
      ? `FIXED CODE ${FIXED_OTP} for every number (TESTING_MODE=true)`
      : `FIXED CODE ${FIXED_OTP} for every number (non-production default)`;
  }

  if (process.env.NODE_ENV === "production" && !TESTING_MODE) {
    return (
      "REAL OTPs over MSG91 - because NODE_ENV=production and TESTING_MODE " +
      "is not set. To use 123456 on this server, set TESTING_MODE=true in " +
      "the host's environment (NOT in .env - .env is gitignored and never " +
      "deployed) and restart."
    );
  }

  return "REAL OTPs over MSG91 (DEV_FIXED_OTP is off)";
};

console.log(
  `[auth] OTP mode: ${describeOtpMode()}\n` +
    `[auth]   NODE_ENV=${process.env.NODE_ENV || "(unset)"}  ` +
    `TESTING_MODE=${process.env.TESTING_MODE ?? "(unset)"}  ` +
    `DEV_FIXED_OTP=${process.env.DEV_FIXED_OTP ?? "(unset)"}  ` +
    `MSG91=${isMsg91Configured() ? "configured" : "NOT configured"}`,
);

/*
| The same facts, fetchable. Reading a boot log means opening the host's
| dashboard and scrolling past a deploy; this is one URL, and it is the
| difference between knowing which mode the live server is in and guessing.
|
| Deliberately returns no code and no secret. When testing mode is ON the
| app already prints the code on the OTP screen for everyone, so there is
| nothing here to leak; when it is OFF - the state that actually matters -
| this says only that real OTPs are in use.
|
| Remove the route before launch if you would rather not advertise the
| mode at all. The endpoint is a debugging aid, not a feature.
*/

export const getOtpMode = () => ({
  testingMode: FIXED_OTP !== null,
  smsConfigured: isMsg91Configured(),
  description: describeOtpMode(),
});

const trace = (step: string, detail = "") =>
  TRACE && console.log(`[otp] ${step.padEnd(8)} ${detail}`);

const rule_ = (label: string) =>
  TRACE && console.log(`[otp] ${"-".repeat(58)}\n[otp] ${label}`);

export const sendOtpService = async (
  rawPhone: string,
  countryCode?: string,
  ip?: string,
) => {
  rule_(`SEND requested for "${rawPhone}" (country ${countryCode || "IN"})`);

  checkIpLimit(ip);

  trace("1/6", "IP rate limit passed");

  const check = checkPhone(rawPhone, countryCode);

  if (!isPhoneOk(check)) {
    trace("1/6 FAIL", `number rejected: ${check.message}`);
    throw new AppError(check.message, HTTP_STATUS.BAD_REQUEST);
  }

  const { phone, rule } = check;

  trace(
    "2/6",
    `number valid: ${rule.dialCode} ${phone} (${rule.name}, ${rule.nationalLength} digits)`,
  );

  const now = Date.now();

  /*
  | The throttling counters are select:false, so they must be asked for
  | explicitly - without the +fields they come back undefined and every
  | limit silently passes.
  */

  let user: any = await User.findOne({ phone }).select(
    "+otp +otpExpiry +otpAttempts +otpSendCount +otpWindowStartedAt +otpDailyCount +otpDayStartedAt +lastOtpSentAt",
  );

  if (!user) {
    user = new User({ phone, countryCode: rule.code });
    trace("3/6", "new user (first time this number has been seen)");
  } else {
    trace("3/6", `existing user ${user._id}`);
  }

  assertWithinSendLimits(user, now);

  {
    const L = limits();

    trace(
      "4/6",
      `throttle passed (window ${user.otpSendCount || 0}/${L.perWindow}, ` +
        `today ${user.otpDailyCount || 0}/${L.perDay}` +
        (L.noSms ? ", relaxed - no SMS is sent in fixed-OTP mode" : "") +
        ")",
    );
  }

  const otp = FIXED_OTP || generateOtp();

  /*
  | Stored BEFORE the SMS goes out. If the send fails we roll it back below.
  | The other order - send, then store - loses the code entirely when the
  | database write fails, and the user gets an SMS for an OTP the server
  | cannot verify.
  */

  const previous = {
    otp: user.otp,
    otpExpiry: user.otpExpiry,
    otpAttempts: user.otpAttempts,
  };

  user.otp = hashOtp(otp);
  user.otpExpiry = new Date(now + OTP_TTL_MS);
  user.otpAttempts = 0;
  user.countryCode = rule.code;

  user.otpSendCount = (user.otpSendCount || 0) + 1;
  user.otpDailyCount = (user.otpDailyCount || 0) + 1;
  user.lastOtpSentAt = new Date(now);

  await user.save();

  /*
  | THE CODE, IN CLEAR, IN DEVELOPMENT ONLY.
  |
  | This is the line that lets you confirm the whole thing end to end:
  | compare what is printed here against what arrives in the SMS. Same six
  | digits means generation, storage, MSG91 and the operator all worked.
  | A different code means the SMS came from somewhere else. No SMS at all,
  | with this line present, means the failure is after step 6.
  |
  | Silent in production - TRACE is false there.
  */
  trace("5/6", `code stored: ${TRACE ? otp : maskOtp(otp)} (expires in ${OTP_TTL_MS / 1000}s)`);

  /*
  |----------------------------------------------------------------------
  | Fixed-code shortcut: stop here, send nothing
  |----------------------------------------------------------------------
  |
  | The code is already stored and hashed above, so verify works normally.
  | There is nothing to deliver - the tester already knows the code - so
  | MSG91 is skipped entirely: no credits spent, and the login flow keeps
  | working no matter what state the SMS account is in.
  |
  | delivered:false so the app shows its "no SMS was sent" notice instead
  | of running a countdown towards a message that is not coming.
  */

  if (FIXED_OTP) {
    trace("6/6", `FIXED OTP MODE - no SMS sent, code is ${otp}`);

    rule_(
      `SEND DONE (fixed-code mode). Enter ${otp} in the app.\n` +
        `[otp] Remove DEV_FIXED_OTP from .env to go back to real OTPs.`,
    );

    return {
      success: true,
      message: `Testing mode - use ${otp}.`,
      delivered: false,

      /*
      | The app renders its own testing banner from these two. Sending the
      | code back is only safe BECAUSE it is the same fixed code for every
      | number - there is no secret here to leak. The moment real OTPs are
      | switched on, FIXED_OTP is null, this branch never runs, and neither
      | field is ever sent.
      */
      testingMode: true,
      testingOtp: otp,

      phone,
      countryCode: rule.code,
      dialCode: rule.dialCode,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      resendAfterSeconds: Math.floor(limits().resendGapMs / 1000),
      devOtp: otp,
    };
  }

  /*
  |----------------------------------------------------------------------
  | Actually send it
  |----------------------------------------------------------------------
  |
  | In development, with no MSG91 credentials configured, the code is
  | logged instead of sent so the flow can be exercised. That path is
  | refused outright in production - a server that "sends" OTPs nobody
  | receives, while reporting success, is exactly the state this file was
  | in, and it is worse than an error.
  */

  if (!isMsg91Configured()) {
    if (process.env.NODE_ENV === "production") {
      /* Undo the write - no code should be live that was never sent. */
      user.otp = previous.otp;
      user.otpExpiry = previous.otpExpiry;
      user.otpAttempts = previous.otpAttempts;
      await user.save();

      throw new AppError(
        "SMS is not configured on the server. Please contact support.",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }

    console.log(`[DEV OTP] ${rule.dialCode} ${phone}: ${otp}`);

    return {
      success: true,
      message: "OTP generated (development mode - check the server log).",

      /*
      | FALSE. No SMS left the building.
      |
      | Without this the app cannot tell a real send from a development
      | stub: both answered { success: true }, so the OTP screen showed a
      | resend countdown and the user waited for a message that was only
      | ever printed to a terminal. The app now says so on screen.
      */

      delivered: false,

      phone,
      countryCode: rule.code,
      dialCode: rule.dialCode,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      resendAfterSeconds: Math.floor(limits().resendGapMs / 1000),
      devOtp: otp,
    };
  }

  trace("6/6", "handing to MSG91...");

  const startedAt = Date.now();

  try {
    const sms = await sendOtpSMS(phone, otp, rule.dialCode);

    trace(
      "6/6 OK",
      `MSG91 accepted in ${Date.now() - startedAt}ms` +
        (sms?.requestId ? `, request_id=${sms.requestId}` : ""),
    );
  } catch (error: any) {
    trace("6/6 FAIL", error?.message || "unknown");
    /*
    | The SMS did not go. Put the previous code back so a live OTP does not
    | exist for a message nobody received, and let the failure reach the
    | user - this is the whole answer to "how do I know the OTP was sent".
    */

    user.otp = previous.otp;
    user.otpExpiry = previous.otpExpiry;
    user.otpAttempts = previous.otpAttempts;

    /* The send counters are NOT rolled back. A failed attempt still cost a
       call to MSG91 and still deserves to count against the limit. */

    await user.save();

    console.error("[auth] OTP send failed:", error?.message);

    throw new AppError(
      error?.message || "Could not send the OTP. Please try again.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  console.log(`[auth] OTP sent to ${rule.dialCode} ${phone} (${maskOtp(otp)})`);

  rule_(
    `SEND DONE. Server did everything correctly.\n` +
      `[otp] If no SMS arrives now, the failure is at MSG91/DLT/operator,\n` +
      `[otp] NOT in this code - look up the request_id above in\n` +
      `[otp] MSG91 panel -> SendOTP -> Logs.`,
  );

  return {
    success: true,
    message: `OTP sent to ${rule.dialCode} ${phone}`,

    /* MSG91 accepted the message. The countdown and resend are meaningful. */
    delivered: true,

    phone,
    countryCode: rule.code,
    dialCode: rule.dialCode,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    resendAfterSeconds: Math.floor(limits().resendGapMs / 1000),
  };
};

/*
|--------------------------------------------------------------------------
| Verify OTP
|--------------------------------------------------------------------------
*/

export const verifyOtpService = async (
  rawPhone: string,
  rawOtp: string,
  countryCode?: string,
) => {
  rule_(`VERIFY requested for "${rawPhone}" with code "${rawOtp}"`);

  const check = checkPhone(rawPhone, countryCode);

  if (!isPhoneOk(check)) {
    trace("1/5 FAIL", `number rejected: ${check.message}`);
    throw new AppError(check.message, HTTP_STATUS.BAD_REQUEST);
  }

  const { phone, rule } = check;

  const otp = String(rawOtp || "").replace(/\D/g, "");

  if (otp.length !== 6) {
    trace("1/5 FAIL", `got ${otp.length} digits, need 6`);
    throw new AppError(
      "Enter the 6-digit code.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  trace("1/5", `input ok: ${rule.dialCode} ${phone}, 6 digits`);

  const user: any = await User.findOne({ phone }).select(
    "+otp +otpExpiry +otpAttempts",
  );

  /*
  | Deliberately the same message for "no such user" and "no OTP pending".
  | Distinguishing them turns this endpoint into a way to find out which
  | phone numbers have CricIn accounts.
  */

  if (!user || !user.otp || !user.otpExpiry) {
    trace(
      "2/5 FAIL",
      !user ? "no such user - was an OTP ever sent?" : "no OTP pending for this user",
    );
    throw new AppError(
      "That code is not valid. Please request a new OTP.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  trace("2/5", "user found with a stored OTP hash");

  const msLeft = new Date(user.otpExpiry).getTime() - Date.now();

  if (msLeft < 0) {
    trace("3/5 FAIL", `expired ${Math.round(-msLeft / 1000)}s ago`);
    user.otp = null;
    user.otpExpiry = null;
    user.otpAttempts = 0;
    await user.save();

    throw new AppError(
      "That code has expired. Please request a new OTP.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  trace("3/5", `not expired (${Math.round(msLeft / 1000)}s left)`);

  if ((user.otpAttempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    trace("4/5 FAIL", `attempts exhausted (${user.otpAttempts}/${MAX_VERIFY_ATTEMPTS})`);
    user.otp = null;
    user.otpExpiry = null;
    user.otpAttempts = 0;
    await user.save();

    throw new AppError(
      "Too many incorrect attempts. Please request a new OTP.",
      429,
    );
  }

  /*
  | A thrown error here is the server's fault (a missing OTP_HASH_SECRET),
  | never the user's. Reporting it as a wrong code would send them round the
  | loop until their attempts ran out, with the real cause invisible.
  */

  trace(
    "4/5",
    `attempt ${(user.otpAttempts || 0) + 1}/${MAX_VERIFY_ATTEMPTS}`,
  );

  let matches = false;

  try {
    matches = verifyOtpHash(otp, user.otp);
  } catch (error: any) {
    console.error("[auth] OTP hashing is misconfigured:", error?.message);

    throw new AppError(
      "Verification is temporarily unavailable. Please contact support.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
  }

  trace("5/5", `hash compare -> ${matches ? "MATCH" : "NO MATCH"}`);

  if (!matches) {
    rule_(
      `VERIFY FAILED. The submitted code does not hash to the stored value.\n` +
        `[otp] If the user typed the code from the SMS, then the SMS carried a\n` +
        `[otp] DIFFERENT code than step 5/6 of the last SEND printed - compare\n` +
        `[otp] the two above.`,
    );

    user.otpAttempts = (user.otpAttempts || 0) + 1;

    const remaining = MAX_VERIFY_ATTEMPTS - user.otpAttempts;

    /* The last wrong guess kills the code rather than leaving it live. */
    if (remaining <= 0) {
      user.otp = null;
      user.otpExpiry = null;
      user.otpAttempts = 0;
    }

    await user.save();

    throw new AppError(
      remaining > 0
        ? `Incorrect OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
        : "Too many incorrect attempts. Please request a new OTP.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /* Correct. The code is single-use - destroy it before issuing a token. */

  user.isVerified = true;
  user.otp = null;
  user.otpExpiry = null;
  user.otpAttempts = 0;
  user.countryCode = user.countryCode || rule.code;
  user.lastLoginAt = new Date();

  await user.save();

  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    throw new AppError(
      "Server is misconfigured. Please contact support.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
  }

  const token = jwt.sign(
    { userId: String(user._id), phone: user.phone },
    secret,
    { expiresIn: TOKEN_TTL },
  );

  rule_(
    `VERIFY DONE. Code correct, code destroyed, token issued for ${user._id}.\n` +
      `[otp] The OTP flow is working end to end.`,
  );

  /*
  | toObject() runs the schema's toJSON transform, so the OTP hash and every
  | throttling counter are stripped even though this query asked for them.
  */

  return { token, user: user.toJSON() };
};

/*
| Resend is the same operation as send. It exists as its own export because
| the route does, and because giving it a different implementation is how
| the two drift until one of them forgets a limit.
*/

export const resendOtpService = sendOtpService;

export const AUTH_LIMITS = {
  OTP_TTL_MS,
  SEND_WINDOW_MS,
  SEND_LIMIT_PER_WINDOW,
  SEND_LIMIT_PER_DAY,
  MIN_RESEND_GAP_MS,
  MAX_VERIFY_ATTEMPTS,
};

export { findCountryRule, DEFAULT_COUNTRY_CODE };