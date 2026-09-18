import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| User
|--------------------------------------------------------------------------
|
| The OTP fields grew because the previous three could not answer the two
| questions the login flow actually asks:
|
|   HOW MANY TIMES HAS THIS NUMBER BEEN GUESSED AT? Without a counter, a
|   six-digit code can be brute-forced - a million tries sounds like a lot
|   until you realise nothing was stopping them being made.
|
|   HOW MANY OTPs HAS THIS NUMBER ALREADY BEEN SENT? Without a window, the
|   /auth/send-otp endpoint is a public button that spends money. Every tap
|   is an SMS you pay MSG91 for, and nobody has to be logged in to tap it.
|
| `otp` now holds a HASH, never the code itself - see utils/otp.ts.
|
*/

const userSchema = new mongoose.Schema(
  {
    /*
    | The national number only - ten digits for India, no country code, no
    | spaces. This is what every existing row already contains, so nothing
    | needs migrating.
    */

    phone: {
      type: String,
      required: true,
      unique: true,
    },

    /*
    | Which country's rules that number was validated against. Defaults to
    | India, which is what every row created before this field existed is.
    |
    | Stored rather than re-derived because numbering plans overlap: the
    | same ten digits can be valid in more than one country, and when a
    | second country is switched on, we need to know which one this user
    | signed up under to dial them correctly.
    */

    countryCode: {
      type: String,
      default: "IN",
      uppercase: true,
      trim: true,
    },

    fullName: {
      type: String,
      default: "",
    },

    profileImage: {
      type: String,
      default: "",
    },

    role: {
      type: String,
      enum: [
        "user",
        "player",
        "captain",
        "ground_owner",
        "shop_owner",
        "admin",
      ],
      default: "user",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    /*
    |----------------------------------------------------------------------
    | OTP
    |----------------------------------------------------------------------
    |
    | `otp` is an HMAC-SHA256 hex digest of the code, NOT the code. The
    | field name is unchanged so nothing else in the codebase breaks, but
    | anything that tried to read a live code out of it will simply fail to
    | match - which is the intended outcome.
    |
    | `select: false` keeps it out of every query that does not explicitly
    | ask for it, so a user object cannot carry the hash into a response by
    | accident.
    */

    otp: {
      type: String,
      default: null,
      select: false,
    },

    otpExpiry: {
      type: Date,
      default: null,
      select: false,
    },

    /*
    | Wrong guesses against the CURRENT code. Reset when a new OTP is sent,
    | and the code is destroyed when this passes the cap - so an attacker
    | gets a fixed, small number of tries at each code rather than an
    | unlimited number at one that never changes.
    */

    otpAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    /*
    |----------------------------------------------------------------------
    | Send Throttling
    |----------------------------------------------------------------------
    |
    | A rolling window per number. `otpWindowStartedAt` marks when the
    | current window opened and `otpSendCount` how many have gone out in it;
    | once the window ages past its length it resets on the next request.
    |
    | Kept on the User document rather than in memory because Render
    | restarts, sleeps and redeploys constantly on the free plan - an
    | in-memory counter would forget every limit each time the instance
    | woke, which is exactly when someone hammering the endpoint would get
    | through.
    */

    otpSendCount: {
      type: Number,
      default: 0,
      select: false,
    },

    otpWindowStartedAt: {
      type: Date,
      default: null,
      select: false,
    },

    lastOtpSentAt: {
      type: Date,
      default: null,
      select: false,
    },

    /*
    | Sends today, for a daily ceiling on top of the rolling window. A
    | window alone lets someone send three every fifteen minutes forever.
    */

    otpDailyCount: {
      type: Number,
      default: 0,
      select: false,
    },

    otpDayStartedAt: {
      type: Date,
      default: null,
      select: false,
    },

    lastLoginAt: { type: Date, default: null },

    expoPushToken: { type: String, default: null },
  },
  {
    timestamps: true,

    /*
    | Belt and braces alongside `select: false`. Even a query that asked for
    | everything with .select("+otp") cannot serialise the hash or the
    | throttling counters into an API response.
    */

    toJSON: {
      transform: (_doc, ret: any) => {
        delete ret.otp;
        delete ret.otpExpiry;
        delete ret.otpAttempts;
        delete ret.otpSendCount;
        delete ret.otpWindowStartedAt;
        delete ret.otpDailyCount;
        delete ret.otpDayStartedAt;
        delete ret.lastOtpSentAt;
        return ret;
      },
    },
  },
);

const User = mongoose.model("User", userSchema);

export default User;
