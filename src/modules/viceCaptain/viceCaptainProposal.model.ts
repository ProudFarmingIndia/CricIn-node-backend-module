import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Vice-Captain Proposal
|--------------------------------------------------------------------------
|
| Granting the vice-captain role requires the target player's approval -
| this is the record of that approval workflow, structurally identical
| to TeamInvitation (see teamInvitations/invitation.model.ts) because
| it's the same shape of problem: propose -> pending -> accept/reject.
|
*/

const viceCaptainProposalSchema = new mongoose.Schema(
  {
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Proposed Player
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
    | Proposed By (Captain / Owner)
    |--------------------------------------------------------------------------
    */

    proposedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"],
      default: "PENDING",
    },

    respondedAt: {
      type: Date,
      default: null,
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

viceCaptainProposalSchema.index({
  teamId: 1,
  status: 1,
});

viceCaptainProposalSchema.index({
  playerId: 1,
  status: 1,
});

const ViceCaptainProposal = mongoose.model(
  "ViceCaptainProposal",
  viceCaptainProposalSchema,
);

export default ViceCaptainProposal;
