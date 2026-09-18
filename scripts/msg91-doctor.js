#!/usr/bin/env node
/*
|==========================================================================
| MSG91 DOCTOR
|==========================================================================
|
| Run:   node scripts/msg91-doctor.js 7503020946
|
| Answers ONE question that nothing else has been able to answer:
|
|     Does MSG91 actually build a message when we call it, or does it
|     accept the request and do nothing?
|
| WHY THIS IS NEEDED
|
| The SendOTP log page shows "Nothing Here" while the API keeps handing
| back request ids. Those two facts cannot both be true of one account:
| a send that failed at the operator still leaves a row. So the request
| is landing somewhere other than the panel being looked at - almost
| certainly a different MSG91 account than the one that owns the
| template.
|
| THE DECISIVE TEST
|
| After sending, this script calls MSG91's own verify endpoint with a
| DELIBERATELY WRONG code, and reads which way it refuses:
|
|   "OTP not match"            -> MSG91 DID create an OTP for that number.
|                                 The message was built. The failure is
|                                 downstream: DLT, operator, DND.
|
|   "OTP expired" / not found  -> MSG91 created NOTHING. The template id
|                                 did not resolve under this auth key.
|                                 The account/template mismatch is real.
|
| That single distinction splits the remaining possibilities in half, and
| it costs one SMS credit to find out.
|
| SAFETY
|
| Nothing here prints your auth key. It prints a FINGERPRINT - first six
| and last four characters - which is enough to compare against the panel
| and useless to anyone who sees it. Paste the output anywhere you like.
|
*/

const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const axios = require("axios");

/* ── Helpers ───────────────────────────────────────────────────────── */

const line = (char = "-") => console.log(char.repeat(72));

const fingerprint = (value) => {
  const raw = String(value || "");

  if (!raw) return "(not set)";
  if (raw.length < 14) return `(set, ${raw.length} chars - suspiciously short)`;

  return `${raw.slice(0, 6)}...${raw.slice(-4)}  (${raw.length} chars)`;
};

const show = (label, value) =>
  console.log(`  ${label.padEnd(22)} ${value}`);

/*
| Both endpoints answer with { type, message }. On an error `message` is
| human text; on a success it is the request id. Same overloading the
| service file had to learn about.
*/
const describe = (body) => {
  if (body === undefined || body === null) return "(empty response)";
  if (typeof body === "string") return body.trim();

  return JSON.stringify(body);
};

const main = async () => {
  const phone = String(process.argv[2] || "").replace(/\D/g, "");

  line("=");
  console.log("  MSG91 DOCTOR");
  line("=");

  /* ── 1. What is configured? ──────────────────────────────────────── */

  console.log("\n[1] CONFIGURATION\n");

  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  show("MSG91_AUTH_KEY", fingerprint(authKey));
  show("MSG91_TEMPLATE_ID", templateId || "(not set)");
  show("MSG91_SENDER_ID", process.env.MSG91_SENDER_ID || "(not set - good)");
  show("MSG91_API", process.env.MSG91_API || "(not set - defaults to otp)");
  show("NODE_ENV", process.env.NODE_ENV || "(not set)");

  console.log(
    "\n  >> Compare the fingerprint above against the auth key shown in the\n" +
      "     MSG91 panel for the account that OWNS the template\n" +
      "     (top-right account menu -> API / Auth Key).\n" +
      "     If the first six characters differ, that is the whole bug.",
  );

  if (!authKey || !templateId) {
    console.log("\n  ABORT: auth key or template id missing from .env\n");
    process.exit(1);
  }

  if (!phone || phone.length !== 10) {
    console.log(
      "\n  ABORT: pass a 10-digit Indian mobile number.\n" +
        "         node scripts/msg91-doctor.js 9876543210\n",
    );
    process.exit(1);
  }

  const mobile = `91${phone}`;

  /* ── 2. Is the key alive, and whose balance is it? ───────────────── */

  console.log("");
  line();
  console.log("\n[2] BALANCE (does this key authenticate at all?)\n");

  const balances = [];

  for (const type of ["4", "1"]) {
    try {
      const { data } = await axios.get(
        "https://api.msg91.com/api/balance.php",
        { params: { authkey: authKey, type }, timeout: 15000 },
      );

      balances.push(describe(data));
      show(`route ${type}`, describe(data));
    } catch (error) {
      show(`route ${type}`, `request failed: ${error.message}`);
    }
  }

  console.log(
    "\n  >> A number here means the key is valid and has credit.\n" +
      "     Zero means accepted-but-never-delivered, with no error anywhere.\n" +
      "     An error string means the key itself is wrong or disabled.",
  );

  /*
  |----------------------------------------------------------------------
  | ZERO IS AN ANSWER, NOT A DETAIL - STOP HERE
  |----------------------------------------------------------------------
  |
  | An empty wallet reproduces EVERY symptom at once, which is why it took
  | so long to see:
  |
  |   - the auth key is valid, so the API accepts the call and issues a
  |     request id;
  |   - there is no credit to spend, so no message is ever queued;
  |   - a send that never entered the queue is never billed and therefore
  |     never logged - which is why SendOTP -> Logs says "Nothing Here"
  |     rather than showing a failed row;
  |   - and it explains the one OTP that DID arrive early on: that was the
  |     last of the trial credits.
  |
  | Sending more test messages against a zero balance tells us nothing, so
  | the script stops rather than burning time on the rest.
  */

  const allZero =
    balances.length > 0 && balances.every((value) => /^0(\.0+)?$/.test(value));

  if (allZero) {
    console.log("");
    line();
    console.log("\n  NOTE - THIS READING IS NOT AUTHORITATIVE\n");
    console.log(
      "  balance.php reports LEGACY PER-ROUTE SMS CREDITS. MSG91 moved to a\n" +
        "  rupee wallet, and on a wallet-model account these route counters\n" +
        "  sit at 0 forever while the account is perfectly funded - sends are\n" +
        "  deducted from the wallet, not from these.\n\n" +
        "  So check Settings -> Billing -> Wallet in the panel for the number\n" +
        "  that actually matters. If there are rupees there, ignore the zeros\n" +
        "  above.\n\n" +
        "  An earlier version of this script STOPPED here and declared the\n" +
        "  wallet empty. That was wrong, and it would have hidden the real\n" +
        "  test. It now carries on to the part that can actually tell us\n" +
        "  something.",
    );
  }

  /* ── 3. Send one OTP, print everything ───────────────────────────── */

  const testOtp = String(Math.floor(100000 + Math.random() * 900000));

  console.log("");
  line();
  console.log(`\n[3] SEND to +91 ${phone}  (test code ${testOtp})\n`);

  let sendBody;

  try {
    const response = await axios.post(
      "https://control.msg91.com/api/v5/otp",
      {},
      {
        params: {
          template_id: templateId,
          mobile,
          otp: testOtp,
          otp_expiry: 5,
        },
        headers: {
          authkey: authKey,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      },
    );

    sendBody = response.data;

    show("http status", response.status);
    show("raw body", describe(sendBody));
  } catch (error) {
    show("http status", error?.response?.status || "(no response)");
    show("raw body", describe(error?.response?.data) || error.message);

    console.log(
      "\n  The send was REJECTED outright. The message above is MSG91's own\n" +
        "  reason and is the answer - no need to read further.\n",
    );

    process.exit(1);
  }

  /* ── 4. THE DECISIVE TEST ────────────────────────────────────────── */

  console.log("");
  line();
  console.log("\n[4] DID MSG91 ACTUALLY CREATE AN OTP?\n");
  console.log(
    "  Verifying with a deliberately WRONG code (000000).\n" +
      "  How it refuses tells us whether an OTP exists on their side.\n",
  );

  let verifyBody;

  try {
    /*
    | The authkey goes in BOTH the query string and the header.
    |
    | The send endpoint accepts it as a header; this one answered
    | { "message": "Invalid authkey", "code": "201" } to the very same key
    | that had just been accepted a second earlier - because verify reads
    | it from the query string. Sending it both ways costs nothing and
    | removes a false "your key is wrong" that sent me looking in the
    | wrong direction.
    */
    const response = await axios.get(
      "https://control.msg91.com/api/v5/otp/verify",
      {
        params: { authkey: authKey, mobile, otp: "000000" },
        headers: { authkey: authKey },
        timeout: 20000,
      },
    );

    verifyBody = response.data;
  } catch (error) {
    verifyBody = error?.response?.data || { message: error.message };
  }

  show("raw body", describe(verifyBody));

  const text = String(verifyBody?.message || describe(verifyBody)).toLowerCase();

  console.log("");
  line("=");
  console.log("\n  VERDICT\n");

  if (/not match|mismatch|incorrect|invalid otp/.test(text)) {
    console.log(
      "  MSG91 HAS an OTP stored for this number.\n\n" +
        "  So the message WAS built and handed to the operator. Your auth key\n" +
        "  and template id belong together, and the code is doing its job.\n\n" +
        "  The failure is downstream - DLT registration, header association,\n" +
        "  DND, or the template's DLT category being promotional rather than\n" +
        "  transactional. A row for this attempt SHOULD now exist in\n" +
        "  SendOTP -> Logs. If it does, its Failure Reason column is your\n" +
        "  next and final answer.",
    );
  } else if (/expired|not found|no otp|does not exist/.test(text)) {
    console.log(
      "  MSG91 has NO OTP for this number, moments after accepting the send.\n\n" +
        "  That is the bug. The request was accepted and a request id issued,\n" +
        "  but no message was ever built - which is what happens when the\n" +
        "  template id does not exist under the account this auth key belongs\n" +
        "  to. It also explains the empty SendOTP -> Logs page.\n\n" +
        "  FIX: use the auth key from the SAME MSG91 account that owns\n" +
        "  template " +
        templateId +
        ".\n" +
        "  Panel -> top-right account menu -> API / Auth Key. Put that value\n" +
        "  in MSG91_AUTH_KEY and rerun this script.",
    );
  } else if (/invalid authkey|"201"/.test(text)) {
    console.log(
      "  The verify endpoint rejected the auth key that the send endpoint\n" +
        "  had just accepted. That is a quirk of the endpoint, not a problem\n" +
        "  with your key - and this script now sends the key as a query\n" +
        "  parameter as well, so seeing this again means something else.\n\n" +
        "  Check the wallet balance in section [2] first: an empty wallet\n" +
        "  explains an accepted send with no message and no log row.",
    );
  } else if (/already verified|verified/.test(text)) {
    console.log(
      "  This number is already marked verified on MSG91's side, so the\n" +
        "  verify endpoint short-circuits and cannot tell us anything.\n\n" +
        "  Rerun with a DIFFERENT mobile number to get a clean reading.",
    );
  } else {
    console.log(
      "  Unrecognised response - paste the two raw bodies above and I can\n" +
        "  read them.",
    );
  }

  console.log("");
  line("=");
  console.log("");
};

main().catch((error) => {
  console.error("\nDoctor crashed:", error.message, "\n");
  process.exit(1);
});
