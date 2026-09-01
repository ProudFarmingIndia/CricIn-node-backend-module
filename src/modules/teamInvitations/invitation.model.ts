import mongoose from "mongoose";

const invitationSchema = new mongoose.Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Team
    |--------------------------------------------------------------------------
    */

    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Invited Player
    |--------------------------------------------------------------------------
    */

    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Invited By (Captain / Owner)
    |--------------------------------------------------------------------------
    */

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Invitation Status
    |--------------------------------------------------------------------------
    */

    status: {
      type: String,
      enum: [
        "PENDING",
        "ACCEPTED",
        "REJECTED",
        "CANCELLED",
        "EXPIRED",
      ],
      default: "PENDING",
    },

    /*
    |--------------------------------------------------------------------------
    | Optional Message
    |--------------------------------------------------------------------------
    */

    message: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },

    /*
    |--------------------------------------------------------------------------
    | Responded Time
    |--------------------------------------------------------------------------
    */

    respondedAt: {
      type: Date,
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Expiration
    |--------------------------------------------------------------------------
    */

    expiresAt: {
      type: Date,
      default: () =>
        new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ), // 7 Days
    },
  },
  {
    timestamps: true,
  }
);

/*
|--------------------------------------------------------------------------
| Compound Index
|--------------------------------------------------------------------------
| Prevent duplicate pending invitations
*/

invitationSchema.index({
  teamId: 1,
  playerId: 1,
  status: 1,
});

/*
|--------------------------------------------------------------------------
| Player Pending Invitations
|--------------------------------------------------------------------------
*/

invitationSchema.index({
  playerId: 1,
  status: 1,
});

/*
|--------------------------------------------------------------------------
| Team Invitations
|--------------------------------------------------------------------------
*/

invitationSchema.index({
  teamId: 1,
});

/*
|--------------------------------------------------------------------------
| Invited By
|--------------------------------------------------------------------------
*/

invitationSchema.index({
  invitedBy: 1,
});

const TeamInvitation = mongoose.model(
  "TeamInvitation",
  invitationSchema
);

export default TeamInvitation;