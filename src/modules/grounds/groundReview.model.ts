import mongoose from "mongoose";

import { FACILITY_KEYS } from "./ground.constants";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| groundReview.model.ts
|
| Description:
| What the players thought, once they had actually played there.
|
| WHY A REVIEW IS TIED TO A BOOKING
|
| `bookingId` is required and unique. A review cannot exist without a
| completed booking behind it, and a booking can carry exactly one.
|
| That single constraint does the work that a whole moderation system
| would otherwise have to: nobody can review a ground they never went to,
| a rival owner cannot leave ten one-star reviews, and a happy customer
| cannot be asked to leave five. The database refuses it rather than a
| person having to spot it.
|
| WHY FIVE SCORES AND NOT ONE
|
| "4 stars" tells a captain nothing about the decision they are making.
| The questions people actually ask before booking are specific - is the
| pitch any good, are the toilets usable, is it worth the money - and they
| trade off against each other. A cheap ground with a rough pitch and a
| clean one that costs double are both the right answer to somebody.
|
| Discovery sorts on these individually, which is why they are separate
| numbers and not a paragraph.
|
| PROMISES
|
| The one field here that is not a rating. The owner lists what they are
| committing to - floodlights working, parking available, water there -
| and after the game the players are asked about those items ONLY. Not
| "rate the facilities", but "the ground said there would be floodlights;
| were there".
|
| It is a much harder question to be vague about, and it produces the
| number that matters most to somebody choosing between two grounds that
| both claim everything.
|
|--------------------------------------------------------------------------
*/

const groundReviewSchema = new mongoose.Schema(
  {
    groundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ground",
      required: true,
      index: true,
    },

    /*
    | The proof of attendance. Unique, so one session produces at most one
    | review - see the note above.
    */
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroundBooking",
      required: true,
      unique: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* Shown on the review so other captains can weigh it. */
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | The scores
    |--------------------------------------------------------------------------
    |
    | Only `overall` is required. Asking for five numbers before anybody
    | can say anything is how a review form gets abandoned; the other four
    | are offered and skipped freely, and the averages simply ignore the
    | blanks.
    */

    overall: { type: Number, required: true, min: 1, max: 5 },

    pitch: { type: Number, default: null, min: 1, max: 5 },

    hygiene: { type: Number, default: null, min: 1, max: 5 },

    facilities: { type: Number, default: null, min: 1, max: 5 },

    valueForMoney: { type: Number, default: null, min: 1, max: 5 },

    /*
    |--------------------------------------------------------------------------
    | Promises
    |--------------------------------------------------------------------------
    |
    | `promisesChecked` is the list the ground had committed to, copied
    | onto the review at the moment it was written. `promisesKept` is the
    | subset that was actually there.
    |
    | The list is copied rather than read live from the ground because an
    | owner who quietly drops "floodlights" from their promises next month
    | must not retroactively turn an old failure into a pass. A review has
    | to keep meaning what it meant on the day.
    */

    promisesChecked: {
      type: [String],
      enum: FACILITY_KEYS,
      default: [],
    },

    promisesKept: {
      type: [String],
      enum: FACILITY_KEYS,
      default: [],
    },

    comment: { type: String, default: "", maxlength: 600 },

    photos: { type: [String], default: [] },

    /*
    | The owner gets one reply. Not a thread - a ground and a customer
    | arguing in public under a review helps nobody, and one reply is
    | enough to say "sorry, the lights were being repaired".
    */
    ownerReply: { type: String, default: "", maxlength: 400 },

    ownerRepliedAt: { type: Date, default: null },

    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/* The ground's review list, newest first. */
groundReviewSchema.index({ groundId: 1, createdAt: -1 });

const GroundReview = mongoose.model("GroundReview", groundReviewSchema);

export default GroundReview;
