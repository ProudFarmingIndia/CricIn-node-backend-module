import TeamReview from "./teamReview.model";
import Team from "../teams/team.model";
import Match from "../matches/match.model";
import Player from "../players/player.model";

import { assertCanEditTeam } from "../teams/team.service";

import { sendTeamReviewReceivedNotification } from "../notifications/notification.helper";

/*
|--------------------------------------------------------------------------
| Recompute Team Rating
|--------------------------------------------------------------------------
*/

const recomputeTeamRating = async (teamId: string) => {
  const reviews = await TeamReview.find({ teamId }).select("rating");

  const reviewCount = reviews.length;

  const rating =
    reviewCount === 0
      ? 0
      : Number(
          (
            reviews.reduce((sum, review) => sum + review.rating, 0) /
            reviewCount
          ).toFixed(2),
        );

  await Team.findByIdAndUpdate(teamId, { rating, reviewCount });
};

/*
|--------------------------------------------------------------------------
| Create Review
|--------------------------------------------------------------------------
|
| Only reviewable after a completed match between the two teams, if a
| specific match is referenced - prevents reviewing a team you've never
| actually played, and one review per match per reviewing team.
|
*/

export const createReview = async (
  userId: string,
  payload: {
    teamId: string;
    reviewedByTeamId: string;
    matchId?: string;
    rating: number;
    comment?: string;
  },
) => {
  const { teamId, reviewedByTeamId, matchId, rating, comment } = payload;

  if (String(teamId) === String(reviewedByTeamId)) {
    throw new Error("A team cannot review itself.");
  }

  if (!rating || rating < 1 || rating > 5) {
    throw new Error("Rating must be between 1 and 5.");
  }

  const reviewedByTeam = await Team.findById(reviewedByTeamId);

  if (!reviewedByTeam) {
    throw new Error("Your team was not found.");
  }

  await assertCanEditTeam(reviewedByTeam, userId);

  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team being reviewed was not found.");
  }

  if (matchId) {
    const match = await Match.findById(matchId);

    if (!match) {
      throw new Error("Match not found.");
    }

    const teamsInMatch = [String(match.teamA), String(match.teamB)];

    if (
      !teamsInMatch.includes(String(teamId)) ||
      !teamsInMatch.includes(String(reviewedByTeamId))
    ) {
      throw new Error("This match wasn't played between these two teams.");
    }

    if (match.status !== "completed") {
      throw new Error("You can only review a team after a completed match.");
    }

    const existing = await TeamReview.findOne({
      teamId,
      reviewedByTeamId,
      matchId,
    });

    if (existing) {
      throw new Error("You've already reviewed this team for this match.");
    }
  }

  const reviewer = await Player.findOne({ userId });

  if (!reviewer) {
    throw new Error("Please complete your player profile first.");
  }

  const review = await TeamReview.create({
    teamId,
    reviewedByTeamId,
    reviewedByPlayer: reviewer._id,
    matchId: matchId || null,
    rating,
    comment: comment || "",
  });

  await recomputeTeamRating(teamId);

  try {
    await sendTeamReviewReceivedNotification({
      receiverId: team.userId.toString(),
      actorId: userId,
      teamId: team._id.toString(),
      reviewerTeamName: reviewedByTeam.teamName,
      rating,
    });
  } catch (notificationError) {
    console.error("Failed to send team-review notification:", notificationError);
  }

  return review;
};

/*
|--------------------------------------------------------------------------
| Get Reviews For A Team
|--------------------------------------------------------------------------
*/

export const getTeamReviews = async (teamId: string) => {
  return await TeamReview.find({ teamId })
    .populate("reviewedByTeamId", "teamName logo")
    .populate("reviewedByPlayer", "playerName profileImage")
    .sort({ createdAt: -1 });
};