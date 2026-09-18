import axios from "axios";

/*
|--------------------------------------------------------------------------
| MSG91
|--------------------------------------------------------------------------
|
| TWO THINGS WERE WRONG, AND TOGETHER THEY MEANT THE APP COULD NOT TELL
| WHETHER AN OTP HAD BEEN SENT.
|
| 1. THE COUNTRY CODE WAS HARDCODED.
|
|        mobiles: `91${phone}`
|
|    Every number was dialled as Indian. That is correct today and becomes
|    silently wrong the moment a second country is switched on: a British
|    number would be sent to "91" followed by British digits, reaching
|    either nobody or a stranger in India. The caller now passes the dial
|    code, so enabling a country is a data change rather than a bug.
|
| 2. A REJECTED SEND LOOKED LIKE A SUCCESSFUL ONE.
|
|    MSG91's v5 flow API answers HTTP 200 for a REJECTED message and puts
|    the failure in the body as { type: "error", message: "..." }. axios
|    only throws on a non-2xx status, so the old code treated a refusal -
|    bad template id, expired auth key, no balance, DND-blocked number - as
|    a success and told the user the OTP was on its way.
|
|    The body is now inspected, and anything that is not an explicit
|    success throws.
|
| WHAT THIS STILL DOES NOT TELL YOU
|
| A success here means MSG91 ACCEPTED the message, not that it reached the
| handset. Those are different events and the gap between them is where
| most "I never got the OTP" reports live. The truth comes from MSG91's
| delivery report webhook; wire that up when the volume justifies it.
|
*/

export type SmsResult = {
  ok: true;
  requestId?: string;
  raw: any;
};

const isMissing = (value?: string) => !value || !String(value).trim();

export const isMsg91Configured = (): boolean =>
  !isMissing(process.env.MSG91_AUTH_KEY) &&
  !isMissing(process.env.MSG91_TEMPLATE_ID);

/*
| A DLT header for transactional SMS in India is exactly six uppercase
| letters. Not five, not lowercase, no digits, no spaces.
|
| Returns the header only when the configured value could actually be one.
| Warned about ONCE at first use rather than on every send, so a
| misconfiguration is visible in the log without burying everything else.
*/

let senderWarned = false;

export const dltHeader = (): string | null => {
  const raw = String(process.env.MSG91_SENDER_ID || "").trim();

  if (!raw) return null;

  if (/^[A-Z]{6}$/.test(raw)) return raw;

  if (!senderWarned) {
    senderWarned = true;

    console.warn(
      `[msg91] MSG91_SENDER_ID="${raw}" is not a valid DLT header ` +
        `(must be exactly 6 uppercase letters, e.g. "KSNSHK"). ` +
        `Ignoring it and letting the template's own registered header be ` +
        `used. Remove MSG91_SENDER_ID from .env to silence this.`,
    );
  }

  return null;
};

export const sendOtpSMS = async (
  phone: string,
  otp: string,
  dialCode = "+91",
): Promise<SmsResult> => {
  if (!isMsg91Configured()) {
    throw new Error(
      "SMS is not configured on the server. Set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID.",
    );
  }

  /* "+91" -> "91". MSG91 wants the country code with no plus. */
  const country = String(dialCode).replace(/\D/g, "");

  const payload: Record<string, any> = {
    template_id: process.env.MSG91_TEMPLATE_ID,

    /*
    |------------------------------------------------------------------
    | sender - OMITTED UNLESS IT IS A REAL DLT HEADER
    |------------------------------------------------------------------
    |
    | This is the field that broke SMS delivery, and it broke it in the
    | worst possible way: silently.
    |
    | MSG91_SENDER_ID had been set to "India" - the value in the Sender
    | ID COLUMN of the MSG91 template list, which is the region the
    | template is registered for, not a header. Under TRAI's DLT rules an
    | Indian transactional header is EXACTLY SIX UPPERCASE LETTERS,
    | A-Z, registered on the DLT portal and associated with the template.
    | "India" is five characters and lowercase, so it is not a header any
    | operator has ever heard of.
    |
    | Passing an unassociated header produces DLT error 203 - and 203 is
    | one of the failures MSG91 ACCEPTS: HTTP 200, a request_id comes
    | back, our success check passes, the app says "OTP sent", and the
    | operator drops the message. No error anywhere. Before the sender
    | field existed the OTP arrived, because MSG91 fell back to the
    | header actually bound to the template.
    |
    | So: only send `sender` when it LOOKS like a header. Anything else is
    | dropped with a loud warning rather than quietly poisoning every
    | send. The template's own registered header is the correct default,
    | and leaving MSG91_SENDER_ID unset is a perfectly good configuration.
    */
    ...(dltHeader() ? { sender: dltHeader() } : {}),

    mobiles: `${country}${phone}`,

    /*
    | The variable name must match the ##OTP## placeholder in the approved
    | MSG91 template. If the SMS arrives with a literal "##OTP##" in it,
    | this key and the template disagree.
    */
    OTP: otp,
  };

  let response;

  /*
  |----------------------------------------------------------------------
  | WHICH ENDPOINT? THIS IS NOT A DETAIL - IT DECIDES WHETHER SMS ARRIVES
  |----------------------------------------------------------------------
  |
  | MSG91 has TWO template systems and TWO endpoints, and a template id
  | from one is NOT valid on the other:
  |
  |   SendOTP  -> templates live at /app/m/l/otp/templates
  |               sent with  POST /api/v5/otp
  |
  |   Flow/SMS -> templates live under SMS -> Templates (flow templates)
  |               sent with  POST /api/v5/flow/
  |
  | KishanSahayakOTP was created in the SendOTP section, so its id belongs
  | to /api/v5/otp. This file was posting it to /api/v5/flow/ - and the
  | flow endpoint answers HTTP 200 with { type: "success" } and a request
  | id even when it cannot resolve the template, so nothing upstream ever
  | said "wrong endpoint". The message is simply never built and never
  | delivered.
  |
  | Default is "otp" because that is where the template actually lives.
  | Set MSG91_API=flow to go back to the flow endpoint if you later move
  | the template to SMS -> Templates.
  */

  const mode =
    String(process.env.MSG91_API || "otp").trim().toLowerCase() === "flow"
      ? "flow"
      : "otp";

  const url =
    mode === "flow"
      ? "https://control.msg91.com/api/v5/flow/"
      : "https://control.msg91.com/api/v5/otp";

  /*
  | The SendOTP endpoint takes its arguments as QUERY parameters, and it
  | accepts an `otp` we supply. That matters: we keep generating, hashing
  | and verifying the code ourselves, with our own expiry and attempt caps.
  | MSG91 is only the delivery pipe. Letting MSG91 both issue and verify
  | the code would mean throwing away the throttling in auth.service.
  */

  const params =
    mode === "flow"
      ? undefined
      : {
          template_id: process.env.MSG91_TEMPLATE_ID,
          mobile: `${country}${phone}`,
          otp,
          /* Kept in step with OTP_TTL_MS in auth.service (5 minutes). */
          otp_expiry: 5,
          ...(dltHeader() ? { sender: dltHeader() } : {}),
        };

  if (process.env.NODE_ENV !== "production") {
    console.log(`[msg91] ${mode} endpoint -> ${url}`);
  }

  try {
    response = await axios.post(url, mode === "flow" ? payload : {}, {
      params,

      headers: {
        authkey: process.env.MSG91_AUTH_KEY as string,
        "Content-Type": "application/json",
      },

      /*
      | Without a timeout, a hung MSG91 connection holds the request open
      | until the platform kills it - the user watches a spinner for a
      | minute and then gets nothing useful.
      */
      timeout: 15000,
    });
  } catch (error: any) {
    const detail =
      error?.response?.data?.message ||
      error?.response?.data?.msg ||
      error?.message ||
      "unknown error";

    console.error("[msg91] request failed:", detail);

    throw new Error(`Could not send the OTP: ${detail}`);
  }

  const body = response?.data;

  /*
  | HTTP 200 with a failure inside. This is the case the old code missed.
  */

  if (body?.type && String(body.type).toLowerCase() === "error") {
    const detail = body?.message || "the SMS provider rejected the request";

    console.error("[msg91] rejected:", detail);

    throw new Error(`Could not send the OTP: ${detail}`);
  }

  /*
  |----------------------------------------------------------------------
  | THE REQUEST ID IS IN `message`, NOT `request_id`
  |----------------------------------------------------------------------
  |
  | v5 answers a success as:
  |
  |     { "message": "3669637436586c6942655a64", "type": "success" }
  |
  | `message` is overloaded: on an error it is human text, on a success it
  | is the REQUEST ID. Reading only `request_id` made every successful
  | send log "accepted but returned no request_id" and threw away the one
  | value that can be looked up afterwards.
  |
  | That id is the whole answer to "where was my SMS blocked". MSG91's
  | panel under SendOTP -> Logs resolves it to the real per-operator
  | outcome - Delivered, Failed, DND, or a DLT rejection code. The send
  | response CANNOT tell you: acceptance and delivery are different
  | events, minutes apart, and only the second one knows.
  */

  const looksLikeId = (value: any) =>
    typeof value === "string" && /^[a-f0-9]{16,}$/i.test(value);

  const requestId =
    body?.request_id ||
    body?.requestId ||
    (looksLikeId(body?.message) ? body.message : undefined);

  if (requestId) {
    console.log(
      `[msg91] accepted, request_id=${requestId} ` +
        `(look this up in SendOTP -> Logs for the delivery outcome)`,
    );
  } else {
    console.warn(
      "[msg91] accepted but no request id could be read:",
      JSON.stringify(body),
    );
  }

  return { ok: true, requestId, raw: body };
};
