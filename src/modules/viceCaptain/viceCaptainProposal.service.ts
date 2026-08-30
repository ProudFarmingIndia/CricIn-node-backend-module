import mongoose from "mongoose";

import ViceCaptainProposal from "./viceCaptainProposal.model";
import Team from "../teams/team.model";
import Player from "../players/player.model";

import { assertIsOwnerOrCaptain } from "../teams/team.service";

import * as NotificationService from "../notifications/notification.service";

import {
  sendViceCaptainProposedNotification,
  sendViceCaptainAssignedNotification,
  sendViceCaptainRejectedNotification,
  sendViceCaptainCancelledNotification,
} from "../notifications/notification.helper";

/*
|--------------------------------------------------------------------------
| Propose Vice-Captain
|--------------------------------------------------------------------------
|
| Only owner/captain can propose - this is intentionally NOT covered by
| viceCaptainRights, since a vice-captain granting the role to someone
| else (possibly themselves) would be a privilege escalation.
|
*/

export const proposeViceCaptain = async (
  userId: string,
  teamId: string,
  playerId: string,
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertIsOwnerOrCaptain(team, userId);

  const proposer = await Player.findOne({ userId });

  if (!proposer) {
    throw new Error("Please complete your player profile first.");
  }

  if (team.viceCaptainId) {
    throw new Error(
      "This team already has a vice-captain. Remove them first.",
    );
  }

  if (team.captainId && team.captainId.equals(playerId)) {
    throw new Error("The captain cannot also be the vice-captain.");
  }

  if (!team.players.some((id) => id.equals(playerId))) {
    throw new Error("Only current squad members can be proposed.");
  }

  const existing = await ViceCaptainProposal.findOne({
    teamId,
    status: "PENDING",
  }).populate("playerId");

  if (existing && String((existing.playerId as any)._id) === String(playerId)) {
    throw new Error(
      `${(existing.playerId as any).playerName} already has a pending proposal - waiting for their response.`,
    );
  }

  if (existing) {
    const previousCandidate = existing.playerId as any;

    existing.status = "CANCELLED";
    existing.respondedAt = new Date();
    await existing.save();

    try {
      if (previousCandidate?.userId) {
        await sendViceCaptainCancelledNotification({
          receiverId: previousCandidate.userId.toString(),
          actorId: userId,
          proposalId: existing._id.toString(),
          teamId: team._id.toString(),
          teamName: team.teamName,
        });
      }
    } catch (notificationError) {
      console.error(
        "Failed to send vice-captain-cancelled notification:",
        notificationError,
      );
    }
  }

  const player = await Player.findById(playerId).populate("userId");

  if (!player) {
    throw new Error("Player not found.");
  }

  const proposal = await ViceCaptainProposal.create({
    teamId,
    playerId,
    proposedBy: proposer._id,
  });

  try {
    await sendViceCaptainProposedNotification({
      receiverId: (player.userId as any)._id.toString(),
      actorId: userId,
      proposalId: proposal._id.toString(),
      teamId: team._id.toString(),
      teamName: team.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send vice-captain-proposed notification:",
      notificationError,
    );
  }

  return await ViceCaptainProposal.findById(proposal._id)
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: { path: "userId" },
    })
    .populate({
      path: "proposedBy",
      populate: { path: "userId" },
    });
};

/*
|--------------------------------------------------------------------------
| My Proposals (Received)
|--------------------------------------------------------------------------
*/

export const getMyProposals = async (userId: string) => {
  const player = await Player.findOne({ userId });

  if (!player) {
    throw new Error("Player profile not found.");
  }

  return await ViceCaptainProposal.find({
    playerId: player._id,
    status: "PENDING",
  })
    .populate("teamId")
    .populate({
      path: "proposedBy",
      populate: { path: "userId" },
    })
    .sort({ createdAt: -1 });
};

/*
|--------------------------------------------------------------------------
| Get Team's Pending Proposal (Captain/Owner Side)
|--------------------------------------------------------------------------
*/

export const getTeamProposal = async (userId: string, teamId: string) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertIsOwnerOrCaptain(team, userId);

  return await ViceCaptainProposal.findOne({
    teamId,
    status: "PENDING",
  })
    .populate({
      path: "playerId",
      populate: { path: "userId" },
    })
    .populate({
      path: "proposedBy",
      populate: { path: "userId" },
    });
};

/*
|--------------------------------------------------------------------------
| Accept Proposal
|--------------------------------------------------------------------------
*/

export const acceptProposal = async (
  userId: string,
  proposalId: string,
) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const proposal = await ViceCaptainProposal.findById(proposalId)
      .session(session)
      .populate("teamId")
      .populate({
        path: "playerId",
        populate: { path: "userId" },
      });

    if (!proposal) {
      throw new Error("Proposal not found.");
    }

    if (proposal.status !== "PENDING") {
      throw new Error("This proposal has already been responded to.");
    }

    /*
    |--------------------------------------------------------------------------
    | Verify The Accepting User IS The Proposed Player
    |--------------------------------------------------------------------------
    */

    const actor = await Player.findOne({ userId }).session(session);

    if (!actor || !actor._id.equals((proposal.playerId as any)._id)) {
      throw new Error("Only the proposed player can respond to this.");
    }

    const team = await Team.findById(proposal.teamId).session(session);

    if (!team) {
      throw new Error("Team not found.");
    }

    proposal.status = "ACCEPTED";
    proposal.respondedAt = new Date();
    await proposal.save({ session });

    team.viceCaptainId = (proposal.playerId as any)._id;
    await team.save({ session });

    await session.commitTransaction();
    session.endSession();

    /*
    |--------------------------------------------------------------------------
    | Notifications (Best-Effort, Outside The Transaction)
    |--------------------------------------------------------------------------
    */

    try {
      await sendViceCaptainAssignedNotification({
        receiverId: ((proposal.playerId as any).userId as any)._id.toString(),
        actorId: team.userId.toString(),
        teamId: team._id.toString(),
        teamName: team.teamName,
      });

      await NotificationService.createNotification({
        receiverId: team.userId.toString(),
        actorId: ((proposal.playerId as any).userId as any)._id.toString(),
        type: "VICE_CAPTAIN_ASSIGNED",
        title: "Proposal Accepted",
        message: `${(proposal.playerId as any).playerName} accepted and is now Vice-Captain of ${team.teamName}.`,
        data: {
          teamId: team._id,
        },
      });
    } catch (notificationError) {
      console.error(
        "Failed to send vice-captain-accepted notifications:",
        notificationError,
      );
    }

    return await ViceCaptainProposal.findById(proposal._id)
      .populate("teamId")
      .populate({
        path: "playerId",
        populate: { path: "userId" },
      })
      .populate({
        path: "proposedBy",
        populate: { path: "userId" },
      });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    session.endSession();

    throw error;
  }
};

/*
|--------------------------------------------------------------------------
| Reject Proposal
|--------------------------------------------------------------------------
*/

export const rejectProposal = async (userId: string, proposalId: string) => {
  const proposal = await ViceCaptainProposal.findById(proposalId)
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: { path: "userId" },
    });

  if (!proposal) {
    throw new Error("Proposal not found.");
  }

  if (proposal.status !== "PENDING") {
    throw new Error("This proposal has already been responded to.");
  }

  const actor = await Player.findOne({ userId });

  if (!actor || !actor._id.equals((proposal.playerId as any)._id)) {
    throw new Error("Only the proposed player can respond to this.");
  }

  proposal.status = "REJECTED";
  proposal.respondedAt = new Date();
  await proposal.save();

  const team = proposal.teamId as any;

  try {
    await sendViceCaptainRejectedNotification({
      receiverId: team.userId.toString(),
      actorId: userId,
      proposalId: proposal._id.toString(),
      teamId: team._id.toString(),
      playerName: (proposal.playerId as any).playerName,
      teamName: team.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send vice-captain-rejected notification:",
      notificationError,
    );
  }

  return await ViceCaptainProposal.findById(proposal._id)
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: { path: "userId" },
    });
};

/*
|--------------------------------------------------------------------------
| Cancel Proposal (By Captain/Owner)
|--------------------------------------------------------------------------
*/

export const cancelProposal = async (userId: string, proposalId: string) => {
  const proposal = await ViceCaptainProposal.findById(proposalId)
    .populate("teamId")
    .populate("playerId");

  if (!proposal) {
    throw new Error("Proposal not found.");
  }

  if (proposal.status !== "PENDING") {
    throw new Error("Only a pending proposal can be cancelled.");
  }

  const team = proposal.teamId as any;
  const candidate = proposal.playerId as any;

  await assertIsOwnerOrCaptain(team, userId);

  proposal.status = "CANCELLED";
  proposal.respondedAt = new Date();
  await proposal.save();

  try {
    if (candidate?.userId) {
      await sendViceCaptainCancelledNotification({
        receiverId: candidate.userId.toString(),
        actorId: userId,
        proposalId: proposal._id.toString(),
        teamId: team._id.toString(),
        teamName: team.teamName,
      });
    }
  } catch (notificationError) {
    console.error(
      "Failed to send vice-captain-cancelled notification:",
      notificationError,
    );
  }

  return proposal;
};