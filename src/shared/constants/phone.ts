/*
|--------------------------------------------------------------------------
| Phone Numbers - The Server's Copy Of The Rules
|--------------------------------------------------------------------------
|
| This deliberately mirrors src/constants/countries.js in the app.
|
| The duplication is intentional, and it is not laziness. The app's copy
| exists to give the user fast feedback while typing. THIS copy exists
| because the app cannot be trusted: anyone can POST straight to
| /api/auth/send-otp with curl and never run a line of your JavaScript.
| Validation that only lives in the client is decoration.
|
| Keep the two in step when you add a country. They are small, and the
| alternative - shipping the rules from the server on app start - buys
| nothing while the list is this short.
|
| `otpSupported` gates which countries the API will accept at all. A country
| goes true here and in the app on the same day MSG91 can actually deliver
| to it, and not before: an OTP that cannot arrive is an account that can
| never be created, and the user has no way to tell you.
|
*/

export type CountryRule = {
  code: string;
  dialCode: string;
  name: string;
  nationalLength: number;
  pattern: RegExp;
  otpSupported: boolean;
};

export const COUNTRY_RULES: CountryRule[] = [
  {
    code: "IN",
    dialCode: "+91",
    name: "India",
    nationalLength: 10,

    /* Indian mobile numbers begin 6-9. Landlines cannot receive an SMS,
       and "0000000000" is not a number anybody owns. */
    pattern: /^[6-9]\d{9}$/,

    otpSupported: true,
  },

  {
    code: "PK", dialCode: "+92", name: "Pakistan",
    nationalLength: 10, pattern: /^3\d{9}$/, otpSupported: false,
  },
  {
    code: "BD", dialCode: "+880", name: "Bangladesh",
    nationalLength: 10, pattern: /^1[3-9]\d{8}$/, otpSupported: false,
  },
  {
    code: "LK", dialCode: "+94", name: "Sri Lanka",
    nationalLength: 9, pattern: /^7\d{8}$/, otpSupported: false,
  },
  {
    code: "NP", dialCode: "+977", name: "Nepal",
    nationalLength: 10, pattern: /^9\d{9}$/, otpSupported: false,
  },
  {
    code: "AE", dialCode: "+971", name: "UAE",
    nationalLength: 9, pattern: /^5\d{8}$/, otpSupported: false,
  },
  {
    code: "GB", dialCode: "+44", name: "United Kingdom",
    nationalLength: 10, pattern: /^7\d{9}$/, otpSupported: false,
  },
  {
    code: "AU", dialCode: "+61", name: "Australia",
    nationalLength: 9, pattern: /^4\d{8}$/, otpSupported: false,
  },
  {
    code: "NZ", dialCode: "+64", name: "New Zealand",
    nationalLength: 9, pattern: /^2\d{8}$/, otpSupported: false,
  },
  {
    code: "ZA", dialCode: "+27", name: "South Africa",
    nationalLength: 9, pattern: /^[6-8]\d{8}$/, otpSupported: false,
  },
  {
    code: "US", dialCode: "+1", name: "United States",
    nationalLength: 10, pattern: /^[2-9]\d{9}$/, otpSupported: false,
  },
];

export const DEFAULT_COUNTRY_CODE = "IN";

export const findCountryRule = (code?: string): CountryRule | null =>
  COUNTRY_RULES.find(
    (rule) => rule.code === String(code || "").toUpperCase(),
  ) || null;

/*
| Normalise whatever arrived into bare national digits.
|
| Old builds of the app send a plain 10-digit string with no country at all,
| and they must keep working - so a missing country is India, which is what
| every existing row in the database already is.
*/

export const normaliseNational = (
  input: unknown,
  rule: CountryRule,
): string => {
  let digits = String(input ?? "").replace(/\D/g, "");

  const dial = rule.dialCode.replace(/\D/g, "");

  /* A full international number was sent - strip the country code. */
  if (dial && digits.length > rule.nationalLength && digits.startsWith(dial)) {
    digits = digits.slice(dial.length);
  }

  /* A trunk zero, as written on visiting cards. */
  if (digits.length > rule.nationalLength && digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }

  return digits;
};

export type PhoneCheckOk = {
  ok: true;
  phone: string;
  rule: CountryRule;
  e164: string;
};

export type PhoneCheckFail = {
  ok: false;
  message: string;
};

export type PhoneCheck = PhoneCheckOk | PhoneCheckFail;

/*
| A user-defined type guard rather than relying on `if (!check.ok)` to
| narrow the union on its own.
|
| Discriminated-union narrowing on a boolean literal only works when
| strictNullChecks is on. This project compiles with it off, so `check.ok`
| widens from `true | false` to plain `boolean`, the two branches stop being
| distinguishable, and every use of `check.message` fails to compile with
| "Property 'message' does not exist". An explicit guard narrows correctly
| under either setting.
*/

export const isPhoneOk = (check: PhoneCheck): check is PhoneCheckOk =>
  check.ok === true;

export const checkPhone = (
  input: unknown,
  countryCode?: string,
): PhoneCheck => {
  const rule = findCountryRule(countryCode || DEFAULT_COUNTRY_CODE);

  if (!rule) {
    return { ok: false, message: "That country is not supported." };
  }

  if (!rule.otpSupported) {
    return {
      ok: false,
      message: `CricIn cannot send an OTP to ${rule.name} yet.`,
    };
  }

  const digits = normaliseNational(input, rule);

  if (!digits) {
    return { ok: false, message: "A mobile number is required." };
  }

  if (digits.length !== rule.nationalLength) {
    /*
    | Worded to read correctly for every country name in the table.
    | "A India mobile number must be..." was grammatically wrong and it is
    | the message a user sees most often, because a half-typed number hits
    | it on every submit.
    */

    return {
      ok: false,
      message: `Please check the number - a mobile number in ${rule.name} is ${rule.nationalLength} digits.`,
    };
  }

  if (!rule.pattern.test(digits)) {
    return {
      ok: false,
      message:
        rule.code === "IN"
          ? "Please check the number - Indian mobile numbers start with 6, 7, 8 or 9."
          : "Please check the number - that is not a valid mobile number.",
    };
  }

  return {
    ok: true,
    phone: digits,
    rule,
    e164: `${rule.dialCode.replace("+", "")}${digits}`,
  };
};

/*
| "98765 43210" for display in a message the user reads. Never used as a
| key, never sent to MSG91.
*/

export const maskForDisplay = (phone: string, rule: CountryRule): string =>
  `${rule.dialCode} ${phone}`;
