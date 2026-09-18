import crypto from "crypto";

/*
|--------------------------------------------------------------------------
| OTP Generation, Hashing And Comparison
|--------------------------------------------------------------------------
|
| THREE THINGS CHANGED HERE, AND EACH ONE WAS A REAL HOLE.
|
| 1. Math.random() IS NOT A SECRET.
|
|    The previous generator used Math.random(), which is a fast statistical
|    PRNG, not a cryptographic one. Its internal state can be recovered from
|    a modest number of outputs, and every OTP after that is predictable.
|    crypto.randomInt draws from the OS entropy pool and is the right tool
|    for anything an attacker would want to guess.
|
| 2. THE OTP WAS STORED IN PLAINTEXT.
|
|    User.otp held the live code. Anyone who could read the users collection
|    - a leaked backup, an over-broad Atlas user, a read-only analytics
|    connection - could log in as any account with an OTP in flight. The
|    code is a password with a five-minute life; it gets hashed like one.
|
|    HMAC-SHA256 rather than bcrypt: bcrypt's slowness protects passwords
|    from offline brute force, but a 6-digit code has only a million values
|    and would fall to bcrypt too if an attacker had the hash and unlimited
|    time. What actually protects an OTP is the five-minute expiry and the
|    attempt cap, both enforced in auth.service. The hash is here so a
|    database read is not a login, and HMAC does that without a dependency.
|
| 3. COMPARISON WAS ===, WHICH LEAKS TIMING.
|
|    String equality in V8 returns as soon as two characters differ, so the
|    time taken reveals how many leading characters were right. Over enough
|    requests that turns a million-guess space into six hundred-guess ones.
|    timingSafeEqual always compares the whole buffer.
|
| THE PEPPER
|
| OTP_HASH_SECRET is a server-side secret that is NOT in the database. It
| means a stolen copy of the users collection is not enough to test guesses
| offline - you would need the application's environment too. It falls back
| to JWT_ACCESS_SECRET so this works without a new environment variable,
| but set a separate one when you can: reusing a signing key as a hashing
| key is a habit worth not forming.
|
*/

const OTP_LENGTH = 6;

const hashSecret = (): string => {
  const secret =
    process.env.OTP_HASH_SECRET || process.env.JWT_ACCESS_SECRET || "";

  if (!secret) {
    /*
    | Refusing loudly beats hashing with an empty key and believing the
    | result is protected.
    */
    throw new Error(
      "OTP_HASH_SECRET (or JWT_ACCESS_SECRET) must be set to hash OTPs.",
    );
  }

  return secret;
};

export const generateOtp = (): string => {
  /*
  | randomInt over the whole 6-digit range, so 000000 through 999999 are all
  | equally likely. Building it as "100000 + random * 900000" would exclude
  | every code starting with a zero and throw away a tenth of the space.
  */

  return String(crypto.randomInt(0, 1_000_000)).padStart(OTP_LENGTH, "0");
};

export const hashOtp = (otp: string): string =>
  crypto
    .createHmac("sha256", hashSecret())
    .update(String(otp))
    .digest("hex");

export const verifyOtpHash = (otp: string, storedHash?: string | null): boolean => {
  if (!storedHash) return false;

  /*
  | hashOtp throws only when the pepper is missing - a SERVER
  | misconfiguration, not a wrong code.
  |
  | This used to be wrapped in `try { } catch { return false }`, which
  | turned that into "Incorrect OTP". The user then sees the code they are
  | holding in their hand rejected, retries, burns every attempt, and
  | nothing anywhere says the server is missing an environment variable.
  |
  | Letting it propagate means the caller can answer 500 "server is
  | misconfigured" instead of blaming the user for the server's problem.
  */

  const candidate = hashOtp(otp);

  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(storedHash, "hex");

  /*
  | timingSafeEqual throws on a length mismatch, which would itself be a
  | timing signal. Both sides are SHA-256 digests so this only differs if
  | the stored value is corrupt or from an older format - in which case the
  | answer is simply "no".
  */

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};

/*
| Never log a live OTP in full. During development you need to see it; in
| production a code in the logs is a code anyone with log access can use.
*/

export const maskOtp = (otp: string): string =>
  `${otp.slice(0, 2)}${"*".repeat(Math.max(otp.length - 2, 0))}`;
