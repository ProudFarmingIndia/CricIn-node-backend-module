import mongoose from "mongoose";

import {
  BOOKING_STATUSES,
  BOOKING_PURPOSES,
  DELAY_FAULTS,
} from "./ground.constants";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| groundBooking.model.ts
|
| Description:
| One slot, on one unit, held for one person.
|
| THE MONEY QUESTION, ANSWERED ONCE
|
| Nothing here moves money. There is no gateway, no wallet and no escrow:
| the player pays the owner at the ground, the way they already do.
|
| That is a deliberate choice, not a gap. An automatic penalty needs
| somebody to collect it, and with no card on file the app cannot. A
| penalty it cannot collect is a number on a screen that nobody pays, and
| the first time that happens the app looks broken. Worse, a penalty needs
| somebody to decide fault, and "was it the team or the ground" is exactly
| the argument nobody wants an app to arbitrate.
|
| So this document does what an app actually can do reliably: it keeps the
| facts. Who booked, what was agreed, when each side actually turned up,
| what that adds up to. The total is presented at the ground when cash
| changes hands, and the reputation numbers it feeds are visible on every
| future booking - which turns out to be the stronger lever anyway.
|
| When a gateway arrives, the amounts below are already correct and
| already itemised. Nothing here has to change.
|
| WHY THE TIMES ARE FULL TIMESTAMPS
|
| GroundUnit stores hours as "06:00" because a ground opens at six every
| day. A booking is a specific six o'clock on a specific date, so it
| stores real Dates - and every clash check, reminder and overtime
| calculation compares timestamps rather than parsing strings.
|
|--------------------------------------------------------------------------
*/

const groundBookingSchema = new mongoose.Schema(
  {
    groundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ground",
      required: true,
      index: true,
    },

    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroundUnit",
      required: true,
      index: true,
    },

    /* Copied down so an owner's whole book is one indexed query. */
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    bookedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
    | The team this was booked for, when there is one. Optional because a
    | net session is often four friends and no team at all.
    */
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    purpose: {
      type: String,
      enum: BOOKING_PURPOSES,
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | The match, if there is one
    |--------------------------------------------------------------------------
    |
    | Optional on purpose, and this is the part that makes the whole flow
    | work. Three things can happen at this slot:
    |
    |   an existing match is attached to it
    |   a new match is created from it
    |   nothing - it is a net session or a knock-about, and forcing a match
    |   to exist would be inventing data
    |
    | When it IS set, the owner's booking card shows both team names, the
    | format and the overs - which is the whole reason a ground owner wants
    | this app rather than a phone call. And because it is a reference
    | rather than a copy, a match that is later rescheduled or cancelled
    | shows up on the owner's screen without anybody re-notifying them.
    */
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | When
    |--------------------------------------------------------------------------
    */

    /* Midnight of the booking's local date - what the calendar groups by. */
    date: { type: Date, required: true, index: true },

    startTime: { type: Date, required: true },

    endTime: { type: Date, required: true },

    /*
    | Which of the unit's match blocks this came from, so the owner's
    | screen can say "Morning 6-9" rather than re-deriving it from two
    | timestamps. Null for a net booking, which has no blocks.
    */
    blockId: { type: mongoose.Schema.Types.ObjectId, default: null },

    /*
    |--------------------------------------------------------------------------
    | Flexibility and the counter-offer
    |--------------------------------------------------------------------------
    |
    | The player says how much they can move; the owner can then propose a
    | different time inside that. Today this conversation happens on
    | WhatsApp and leaves no record, so when the two sides remember
    | different times there is nothing to check. Here the final agreed time
    | is the one on the booking, and both of them saw it.
    |
    | The counter is stored rather than applied immediately because it is
    | an OFFER - the slot is not moved until the player accepts. Writing it
    | straight onto startTime would mean a player who declines has already
    | lost their original time.
    */

    flexibilityMinutes: {
      type: Number,
      enum: [0, 30, 60],
      default: 0,
    },

    note: { type: String, default: "", maxlength: 300 },

    counterOffer: {
      startTime: { type: Date, default: null },
      endTime: { type: Date, default: null },
      message: { type: String, default: "" },
      offeredAt: { type: Date, default: null },
    },

    /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    */

    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "requested",
      index: true,
    },

    /*
    | An unanswered request releases the slot rather than holding it
    | forever. Without this a ground owner who stops using the app silently
    | freezes every slot anybody ever asked for.
    */
    expiresAt: { type: Date, default: null },

    respondedAt: { type: Date, default: null },

    rejectionReason: { type: String, default: "" },

    cancelledBy: {
      type: String,
      enum: ["", "player", "owner", "system"],
      default: "",
    },

    cancelReason: { type: String, default: "" },

    cancelledAt: { type: Date, default: null },

    /* Whether the cancellation beat the ground's cutoff. */
    cancelledWithinPolicy: { type: Boolean, default: true },

    /*
    |--------------------------------------------------------------------------
    | What actually happened
    |--------------------------------------------------------------------------
    |
    | Two taps, two timestamps. The owner marks arrival, the player marks
    | the end. Everything below - who was late, whether overtime is owed,
    | both sides' reliability - falls out of these two numbers.
    |
    | Nobody is asked whose fault anything was. See the note on delayFault.
    */

    checkInAt: { type: Date, default: null },

    checkOutAt: { type: Date, default: null },

    /* Minutes past startTime that play actually began. */
    delayMinutes: { type: Number, default: 0 },

    /*
    |--------------------------------------------------------------------------
    | Who caused the delay - decided by arithmetic, not by a person
    |--------------------------------------------------------------------------
    |
    |   none    inside the ground's grace period, or no delay at all
    |   team    the slot was ready and the side turned up late
    |   ground  the previous booking on this unit checked out after this
    |           one was due to start
    |
    | That last case is the one worth the trouble. The system already knows
    | the previous booking's check-out time, so when a team is kept waiting
    | by the side before them, nobody has to claim it and nobody has to be
    | believed. The affected booking gets its lost minutes added to its end
    | time and is charged no overtime; the booking that overran is billed
    | for its own.
    |
    | The money still settles between each side and the GROUND, never
    | between two teams. Team A owes the ground for overtime; the ground
    | makes it right with Team B, in extra time or a credit of its own
    | choosing. Moving cash between two strangers is a marketplace, with
    | everything that implies - and it is not needed to solve this.
    */

    delayFault: {
      type: String,
      enum: DELAY_FAULTS,
      default: "none",
    },

    /* Minutes the end time was pushed out to make good a ground-side delay. */
    compensationMinutes: { type: Number, default: 0 },

    /* Minutes played past endTime that the player agreed to pay for. */
    overtimeMinutes: { type: Number, default: 0 },

    /*
    |--------------------------------------------------------------------------
    | The bill
    |--------------------------------------------------------------------------
    |
    | Computed at booking time and frozen. A rate change next month must
    | not silently rewrite what somebody agreed to pay today, and a slot
    | whose price moves between request and arrival is how a ground loses a
    | customer.
    */

    amount: { type: Number, required: true, min: 0 },

    overtimeAmount: { type: Number, default: 0, min: 0 },

    totalAmount: { type: Number, default: 0, min: 0 },

    /*
    | Cash at the ground, so this is the owner ticking it off rather than a
    | gateway callback. It exists now so the owner's earnings screen can
    | separate "played" from "paid", and so a gateway later has somewhere
    | to write.
    */
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "waived"],
      default: "unpaid",
    },

    paidAt: { type: Date, default: null },

    /* Set once a review exists, so the app stops asking. */
    isReviewed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
|
| The first one is the clash check and it runs on every single availability
| lookup: "on this unit, on this date, what is already held". Everything
| else in the feature is fast or slow depending on it.
*/

groundBookingSchema.index({ unitId: 1, date: 1, status: 1 });

groundBookingSchema.index({ ownerId: 1, status: 1, startTime: -1 });

groundBookingSchema.index({ bookedBy: 1, startTime: -1 });

groundBookingSchema.index({ groundId: 1, startTime: -1 });

/* Drives the job that expires unanswered requests. */
groundBookingSchema.index({ status: 1, expiresAt: 1 });

const GroundBooking = mongoose.model("GroundBooking", groundBookingSchema);

export default GroundBooking;
