import mongoose from "mongoose";

import {
  FACILITY_KEYS,
  PITCH_TYPE_KEYS,
  GROUND_DEFAULTS,
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
| ground.model.ts
|
| Description:
| A cricket ground, as its owner lists it.
|
| WHAT CHANGED AND WHY
|
| The old schema stored `latitude` and `longitude` as two plain numbers.
| That is enough to show a pin and nothing else: "grounds within 5 km"
| cannot be asked of the database at all, so it would have meant loading
| every ground in the country and measuring distances in JavaScript. At a
| few hundred grounds that is already slow, and it gets worse every time
| somebody signs up.
|
| Mongo answers that question natively, but only through a GeoJSON Point
| with a 2dsphere index - hence `location`. The two old fields are kept and
| written alongside it so nothing that already reads them breaks, but the
| index and every distance query use `location`.
|
| WHAT LIVES HERE AND WHAT DOES NOT
|
| This document is the ground as a PLACE: where it is, what it has, what
| it costs to deal with, how good it turned out to be.
|
| What is bookable - pitches and nets, their hours and their rates - lives
| in GroundUnit, one document each. A ground with two pitches and four
| nets has six of them, each with its own timings and price, and a booking
| points at exactly one. Folding that into an array here would mean every
| clash check re-reading the whole ground document and every price change
| rewriting it.
|
| RATINGS ARE STORED, NOT COUNTED ON READ
|
| The aggregate at the bottom is denormalised on purpose. Discovery sorts
| by rating, by hygiene and by reliability, and a sort cannot run on a
| number that has to be computed from another collection first. Every
| field is recalculated in one place - groundReview.service.recalculate -
| so there is exactly one writer.
|
|--------------------------------------------------------------------------
*/

const groundSchema = new mongoose.Schema(
  {
    /*
    | The owner. Named `userId` rather than `ownerId` because that is what
    | the original schema called it and matches, tournaments and series all
    | already store ground references - renaming it would be a migration
    | for no gain.
    */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    groundName: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },

    /*
    |--------------------------------------------------------------------------
    | Where it is
    |--------------------------------------------------------------------------
    |
    | `area` is the one people actually search by in Indian cities - Sector
    | 62, Indirapuram, Kondapur - and it is almost never the same as the
    | city. Without it a user in Noida searching "Sector 62" gets every
    | ground in Noida.
    */

    address: { type: String, default: "" },

    area: { type: String, default: "", trim: true, index: true },

    landmark: { type: String, default: "" },

    city: { type: String, default: "", trim: true, index: true },

    state: { type: String, default: "", trim: true },

    pincode: { type: String, default: "" },

    /*
    | GeoJSON, in [longitude, latitude] order - which is the opposite of
    | how everybody says it out loud, and the single most common way to
    | get this wrong. A ground with the pair swapped lands in the sea off
    | Somalia and quietly never appears in any search.
    |
    | Left undefined until the owner drops a pin. A 2dsphere index simply
    | skips documents that have no value, so an unpinned ground costs
    | nothing and is excluded from distance search - which is correct, not
    | a bug: we genuinely do not know where it is.
    */

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: undefined,
      },

      coordinates: {
        type: [Number],
        default: undefined,
      },
    },

    /* Kept in step with `location` for anything still reading them. */

    latitude: { type: Number, default: null },

    longitude: { type: Number, default: null },

    /*
    |--------------------------------------------------------------------------
    | Contact
    |--------------------------------------------------------------------------
    |
    | Released to a player only once their booking is confirmed - see
    | groundBooking.service. Before that the ground is reachable through
    | the app and not by phone, or the booking flow is pointless.
    */

    contactPerson: { type: String, default: "" },

    contactNumber: { type: String, default: "" },

    /*
    |--------------------------------------------------------------------------
    | What it is like
    |--------------------------------------------------------------------------
    */

    photos: { type: [String], default: [] },

    /* Cover photo for the discovery card; falls back to photos[0]. */
    image: { type: String, default: "" },

    pitchTypes: {
      type: [String],
      enum: PITCH_TYPE_KEYS,
      default: [],
    },

    totalPitches: { type: Number, default: 1, min: 0 },

    totalNets: { type: Number, default: 0, min: 0 },

    /*
    | Boundary in yards. Optional, but it is the second question every
    | captain asks after the pitch type.
    */
    boundaryYards: { type: Number, default: null },

    facilities: {
      type: [String],
      enum: FACILITY_KEYS,
      default: [],
    },

    /*
    | Floodlights is also in `facilities`, and is duplicated here because
    | it is the one facility that gets filtered on its own ("show me
    | grounds I can play at after work") and a dedicated boolean indexes
    | far better than an array membership test.
    */
    hasFloodlights: { type: Boolean, default: false, index: true },

    rules: { type: String, default: "", maxlength: 1000 },

    /*
    |--------------------------------------------------------------------------
    | Policies
    |--------------------------------------------------------------------------
    |
    | Every one of these is per-ground rather than global. A busy municipal
    | ground with a waiting list wants a 15-minute buffer and a hard
    | cancellation window; a weekend-only society ground can afford 45
    | minutes and be relaxed about it. One global number would be wrong for
    | both.
    |
    | See GROUND_DEFAULTS for why the defaults are what they are.
    */

    bufferMatchMinutes: {
      type: Number,
      default: GROUND_DEFAULTS.bufferMatchMinutes,
      min: 0,
      max: 120,
    },

    bufferNetMinutes: {
      type: Number,
      default: GROUND_DEFAULTS.bufferNetMinutes,
      min: 0,
      max: 60,
    },

    graceMinutes: {
      type: Number,
      default: GROUND_DEFAULTS.graceMinutes,
      min: 0,
      max: 60,
    },

    overtimeMultiplier: {
      type: Number,
      default: GROUND_DEFAULTS.overtimeMultiplier,
      min: 1,
      max: 3,
    },

    cancellationCutoffHours: {
      type: Number,
      default: GROUND_DEFAULTS.cancellationCutoffHours,
      min: 0,
      max: 72,
    },

    requestExpiryHours: {
      type: Number,
      default: GROUND_DEFAULTS.requestExpiryHours,
      min: 1,
      max: 72,
    },

    /*
    | Instant booking skips the owner's approval entirely. Off by default -
    | an owner should opt in once they trust the flow, not discover that
    | strangers have been booking their Sunday mornings unsupervised.
    */
    instantBooking: { type: Boolean, default: false },

    /*
    |--------------------------------------------------------------------------
    | What the owner promises
    |--------------------------------------------------------------------------
    |
    | This is what "promise fulfilled" is measured against. The owner ticks
    | what they are committing to; after the game the players are asked,
    | for those items only, whether it was actually there.
    |
    | Stored as its own list rather than reusing `facilities` because the
    | two mean different things: facilities is "we have parking", a promise
    | is "we guarantee parking for your booking". A ground can have a
    | canteen and not promise it will be open at 6 AM.
    */

    promises: {
      type: [String],
      enum: FACILITY_KEYS,
      default: [],
    },

    /*
    |--------------------------------------------------------------------------
    | Reputation - all denormalised, all written by one function
    |--------------------------------------------------------------------------
    */

    rating: {
      overall: { type: Number, default: 0, min: 0, max: 5 },
      pitch: { type: Number, default: 0, min: 0, max: 5 },
      hygiene: { type: Number, default: 0, min: 0, max: 5 },
      facilities: { type: Number, default: 0, min: 0, max: 5 },
      valueForMoney: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },

    /*
    | Share of reviews where the players said the ground delivered what it
    | had promised. 0-100. This is the number the "promises fulfilled"
    | filter reads.
    */
    promiseScore: { type: Number, default: 0, min: 0, max: 100 },

    /*
    |--------------------------------------------------------------------------
    | Reliability
    |--------------------------------------------------------------------------
    |
    | Counted from check-ins, never self-reported. `lateStarts` only counts
    | the ones the timestamps blamed on the GROUND - a team turning up late
    | is the team's record, not the ground's.
    |
    | This is what replaced cash penalties. A penalty needs somebody to
    | collect it and somebody to adjudicate it; a number on the profile
    | that both sides can see needs neither, and it is visible on every
    | future booking rather than once.
    */

    stats: {
      totalBookings: { type: Number, default: 0 },
      completedBookings: { type: Number, default: 0 },
      cancelledByOwner: { type: Number, default: 0 },
      lateStarts: { type: Number, default: 0 },

      /* Requests answered vs received, and how fast, in minutes. */
      requestsReceived: { type: Number, default: 0 },
      requestsAnswered: { type: Number, default: 0 },
      avgResponseMinutes: { type: Number, default: 0 },
    },

    /*
    |--------------------------------------------------------------------------
    | State
    |--------------------------------------------------------------------------
    |
    | `draft` until the owner has given it a location and at least one
    | bookable unit - a ground with no pitch and no pin cannot be found or
    | booked, and listing it would only produce dead ends. ground.service
    | promotes it to `active` the moment both exist.
    |
    | `paused` is the owner's own switch for the off-season or repairs. It
    | keeps the listing and its history, and takes it out of discovery.
    */

    status: {
      type: String,
      enum: ["draft", "active", "paused"],
      default: "draft",
      index: true,
    },

    /*
    | Set by an admin, never by the owner. Grounds are live without it -
    | gating every listing behind manual review would stall the feature at
    | launch - but the badge is what a user looks for once there are enough
    | listings for fakes to be worth anybody's time.
    */
    isVerified: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
|
| The 2dsphere is the one that matters: it turns "within 5 km, sorted by
| distance" into a single indexed query instead of a full scan plus
| in-memory maths.
|
| The compound one backs the non-geo path - a user who refuses location
| permission and picks their city from a dropdown - so that route is not
| a collection scan either.
*/

groundSchema.index({ location: "2dsphere" });

groundSchema.index({ status: 1, city: 1, area: 1 });

groundSchema.index({ status: 1, "rating.overall": -1 });

/*
| Free-text search over the name, area and city, so one search box can
| answer "Sector 62", "DPS" and "Noida" without three separate queries.
*/

groundSchema.index({ groundName: "text", area: "text", city: "text" });

/*
|--------------------------------------------------------------------------
| Keep the two coordinate shapes in step
|--------------------------------------------------------------------------
|
| Whichever one is written, the other follows. Without this the day
| somebody updates a ground through the old lat/lng fields it silently
| drops out of every distance search, and nothing anywhere reports an
| error.
|
| NO `next` PARAMETER - THIS IS A MONGOOSE 9 REQUIREMENT, NOT A STYLE CHOICE
|
| Mongoose 8 handed pre-save hooks a callback:
|
|     pre("save", function (next) { ...; next(); })
|
| Mongoose 9 removed it. The signature is now
|
|     (this: HydratedDocument, opts: SaveOptions) => void | Promise<void>
|
| so the FIRST argument is the save options object, not a function. Writing
| the old form does two things: TypeScript fails to match any `pre`
| overload, and - far worse - at runtime `next` is bound to that options
| object, so `next()` throws "next is not a function" on every single save.
| A hook written the old way does not degrade, it breaks every write to this
| collection.
|
| Returning normally is what tells mongoose the hook is done. Throwing, or
| returning a rejected promise, is how a hook aborts the save.
*/

groundSchema.pre("save", function () {
  const doc: any = this;

  const hasPoint =
    Array.isArray(doc.location?.coordinates) &&
    doc.location.coordinates.length === 2;

  if (hasPoint) {
    doc.longitude = doc.location.coordinates[0];
    doc.latitude = doc.location.coordinates[1];
  } else if (
    typeof doc.latitude === "number" &&
    typeof doc.longitude === "number"
  ) {
    doc.location = {
      type: "Point",
      coordinates: [doc.longitude, doc.latitude],
    };
  }
});

const Ground = mongoose.model("Ground", groundSchema);

export default Ground;
