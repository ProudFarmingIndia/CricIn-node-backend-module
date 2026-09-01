import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Team Blocked Date
|--------------------------------------------------------------------------
|
| Captain (or vice-captain with canEditTeam) manually marks a date as
| unavailable, independent of any actual scheduled match - e.g. a
| holiday, ground unavailable, squad not ready.
|
| A team's real "booked" dates (from confirmed matches) are NOT stored
| here - those are derived live from the Match collection. This only
| covers the manual, no-match-involved blocks.
|
*/

const teamBlockedDateSchema = new mongoose.Schema(
  {
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Date
    |--------------------------------------------------------------------------
    |
    | Stored normalized to midnight UTC of the calendar day being blocked,
    | so lookups are a simple equality check rather than a range query.
    |
    */

    date: {
      type: Date,
      required: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

teamBlockedDateSchema.index(
  {
    teamId: 1,
    date: 1,
  },
  {
    unique: true,
  },
);

const TeamBlockedDate = mongoose.model(
  "TeamBlockedDate",
  teamBlockedDateSchema,
);

export default TeamBlockedDate;