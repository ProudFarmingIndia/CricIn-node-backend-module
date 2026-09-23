import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| groundBlackout.model.ts
|
| Description:
| Time the owner has taken off the market - maintenance, a private booking
| taken over the phone, a monsoon week, a wedding on the outfield.
|
| WHY NOT JUST STORE A FAKE BOOKING
|
| It was tempting: a blackout behaves exactly like a confirmed booking as
| far as the clash check is concerned, so reusing GroundBooking would have
| cost nothing to write.
|
| It would have cost plenty to live with. Every earnings total, every
| "bookings this month", every reliability percentage would have had to
| remember to exclude it, and the first one that forgot would quietly
| report a ground earning money from its own maintenance day. One missed
| filter in one aggregate, and the owner's numbers are wrong with nothing
| to show why.
|
| A separate collection cannot be counted by mistake.
|
| WHOLE DAYS AND PART DAYS
|
| `allDay` exists rather than making the owner enter 00:00-23:59, because
| "closed Monday for repairs" is the common case and a calendar tap should
| be enough. When it is false the start and end times are used, which is
| the "a school has the ground 2-4 on Thursday" case.
|
|--------------------------------------------------------------------------
*/

const groundBlackoutSchema = new mongoose.Schema(
  {
    groundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ground",
      required: true,
      index: true,
    },

    /*
    | Null means the whole ground - every pitch and every net. That is what
    | an owner means when they tap a date and say "closed", and making them
    | block six units one at a time would guarantee they miss one.
    */
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroundUnit",
      default: null,
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    date: { type: Date, required: true, index: true },

    allDay: { type: Boolean, default: true },

    /* Used only when allDay is false. Wall-clock, like the unit's hours. */
    startTime: { type: String, default: "" },

    endTime: { type: String, default: "" },

    reason: { type: String, default: "", maxlength: 200 },
  },
  { timestamps: true },
);

/* The availability check reads this range for a date. */
groundBlackoutSchema.index({ groundId: 1, date: 1 });

const GroundBlackout = mongoose.model("GroundBlackout", groundBlackoutSchema);

export default GroundBlackout;
