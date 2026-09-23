import mongoose from "mongoose";

import { UNIT_TYPES, PITCH_TYPE_KEYS } from "./ground.constants";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| groundUnit.model.ts
|
| Description:
| One bookable thing at a ground: a pitch, or a net.
|
| WHY THIS IS A SEPARATE COLLECTION
|
| A ground is a place. What you actually book is a slot on ONE pitch or
| ONE net, and a ground can have two pitches and four nets, each with its
| own opening hours and its own price. Two matches can run at the same
| time on the two pitches without clashing, and six people can be in the
| nets while a match is on.
|
| Holding that in an array on the ground document would mean every clash
| check reads the whole ground - photos, rules, policies and all - and
| every rate change rewrites it. Worse, the clash check itself becomes an
| array scan inside a document rather than an indexed query, and
| "is 6-9 AM free on Pitch 1 on the 12th" is the single hottest question
| in the whole feature.
|
| HOW PRICE IS DECIDED
|
| Match units carry named blocks the owner defines - 6-9 AM, 6-9 PM - each
| with a weekday and a weekend rate. Nets carry an hourly rate instead,
| because nobody books a net for three hours and the owner does not care
| which hour you take.
|
| That split is not a preference, it is how these two things are actually
| sold. Forcing nets into fixed blocks would leave a ground selling 3-hour
| net sessions nobody wants; forcing matches into hourly booking would let
| somebody take 7:30-9:30 and strand the half hour either side.
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Opening hours, one row per weekday
|--------------------------------------------------------------------------
|
| Times are "HH:mm" strings in the ground's own local time, deliberately
| not Dates. A ground opens at six in the morning every day of the year;
| storing that as a timestamp would drag in a date it does not have and a
| timezone it does not care about. The date only exists when somebody
| books, and that is where the two get combined.
*/

const hoursSchema = new mongoose.Schema(
  {
    /* 0 = Sunday, matching JavaScript's getDay(). */
    day: { type: Number, required: true, min: 0, max: 6 },

    open: { type: String, default: "06:00" },

    close: { type: String, default: "22:00" },

    /* A weekly rest day, without deleting the row and losing the hours. */
    closed: { type: Boolean, default: false },
  },
  { _id: false },
);

/*
|--------------------------------------------------------------------------
| A match block
|--------------------------------------------------------------------------
|
| The owner carves the day up themselves rather than the app guessing.
| They know that 6-9 AM is the session everyone wants, that nobody books
| noon in May, and that the lights make the evening worth double.
*/

const blockSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },

    start: { type: String, required: true }, /* "06:00" */

    end: { type: String, required: true }, /* "09:00" */

    weekdayRate: { type: Number, required: true, min: 0 },

    /*
    | Saturday and Sunday cost more at nearly every ground. Left null means
    | "same as weekday" rather than free.
    */
    weekendRate: { type: Number, default: null, min: 0 },

    /*
    | Marks the block as needing the lights. Used to hide evening blocks
    | automatically at a ground with no floodlights, rather than relying on
    | the owner to remember not to create them.
    */
    needsFloodlights: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const groundUnitSchema = new mongoose.Schema(
  {
    groundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ground",
      required: true,
      index: true,
    },

    /*
    | The owner, copied down from the ground.
    |
    | Denormalised so that "may this user touch this unit" and "show me
    | every booking across all my grounds" are one query each instead of a
    | join. It is set once at creation and never changes - a ground does
    | not change hands mid-season, and if it ever did, that is a deliberate
    | migration rather than a field somebody edits.
    */
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true }, /* "Pitch 1" */

    unitType: {
      type: String,
      enum: UNIT_TYPES,
      required: true,
    },

    pitchType: {
      type: String,
      enum: [...PITCH_TYPE_KEYS, ""],
      default: "",
    },

    hasFloodlights: { type: Boolean, default: false },

    /*
    | Seven rows, one per weekday, created for every unit at setup. Always
    | seven - a missing row would have to mean either "closed" or "use the
    | default", and code that has to guess which is code that gets it
    | wrong on a Tuesday.
    */
    weeklyHours: {
      type: [hoursSchema],
      default: () =>
        Array.from({ length: 7 }, (_unused, day) => ({
          day,
          open: "06:00",
          close: "22:00",
          closed: false,
        })),
    },

    /*
    |--------------------------------------------------------------------------
    | Pricing - match units
    |--------------------------------------------------------------------------
    */

    matchBlocks: { type: [blockSchema], default: [] },

    /*
    |--------------------------------------------------------------------------
    | Pricing - net units
    |--------------------------------------------------------------------------
    */

    hourlyRate: { type: Number, default: 0, min: 0 },

    weekendHourlyRate: { type: Number, default: null, min: 0 },

    minHours: { type: Number, default: 1, min: 1 },

    maxHours: { type: Number, default: 4, min: 1 },

    /*
    | Taken out of service without deleting it, so its bookings and their
    | history survive. Deleting a unit that has a season of bookings behind
    | it would orphan all of them.
    */
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

/*
| The index the availability check runs on: every active unit of a ground,
| in one lookup.
*/

groundUnitSchema.index({ groundId: 1, isActive: 1, unitType: 1 });

const GroundUnit = mongoose.model("GroundUnit", groundUnitSchema);

export default GroundUnit;
