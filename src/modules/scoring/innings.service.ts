import Innings from "./innings.model";
import Match from "../matches/match.model";
import { assertCanScore } from "./scoring.service";
import { assertCanEditTeam } from "../teams/team.service";

/*
|--------------------------------------------------------------------------
| Innings
|--------------------------------------------------------------------------
|
| AUTHORISATION
|
| Every function in scoring.service.ts guards on assertCanScore. These three
| did not, and they are reachable through authenticated routes - so any
| logged-in user who knew an inningsId could PUT /scoring/innings/:id/end
| and complete somebody else's innings. The real scorer's next delivery then
| failed with "This innings has already ended", and nothing in the module
| could reopen it.
|
| createInnings had the same hole in the other direction: an arbitrary
| matchId and inningsNumber from any logged-in user.
|
*/

export const createInnings = async (payload: any, userId?: string) => {
  if (!payload?.matchId) {
    throw new Error("A match is required to start an innings.");
  }

  /*
  | Only someone who can manage one of the two teams may open an innings on
  | their match. userId is optional so an internal caller (the start-match
  | flow, which has already checked) is not forced to re-check.
  */

  if (userId) {
    const match = await Match.findById(payload.matchId)
      .populate("teamA")
      .populate("teamB");

    if (!match) {
      throw new Error("Match not found.");
    }

    const allowed = await Promise.all([
      assertCanEditTeam(match.teamA, userId).then(
        () => true,
        () => false,
      ),
      assertCanEditTeam(match.teamB, userId).then(
        () => true,
        () => false,
      ),
    ]);

    const isScorer =
      match.scorerUserId && String(match.scorerUserId) === String(userId);

    const isInviteSender =
      match.inviteSenderUserId &&
      String(match.inviteSenderUserId) === String(userId);

    if (!allowed[0] && !allowed[1] && !isScorer && !isInviteSender) {
      throw new Error("You are not authorized to start this innings.");
    }
  }

  /*
  | Idempotent: if an innings already exists for this match + number, return
  | it instead of creating a duplicate (a double-tap, or a retry after a
  | wrong PIN in the start-scoring flow).
  */

  const existing = await Innings.findOne({
    matchId: payload.matchId,
    inningsNumber: payload.inningsNumber,
  });

  if (existing) {
    return existing;
  }

  return await Innings.create(payload);
};

export const getInningsById = async (inningsId: string) => {
  return await Innings.findById(inningsId)
    .populate("matchId")
    .populate("battingTeam")
    .populate("bowlingTeam");
};

export const endInnings = async (inningsId: string, userId?: string) => {
  if (userId) {
    // Throws unless this user is the match's scorer.
    await assertCanScore(inningsId, userId);
  }

  const innings = await Innings.findById(inningsId);

  if (!innings) {
    throw new Error("Innings not found.");
  }

  /*
  | Ending an already-ended innings is a no-op rather than an error: the
  | client can reach this twice (the innings-break screen on a re-focus,
  | or a retry after a dropped response) and a second call should not be
  | an error the scorer has to read.
  */

  if (innings.isCompleted) {
    return innings;
  }

  return await Innings.findByIdAndUpdate(
    inningsId,
    {
      isCompleted: true,
      completedAt: new Date(),
    },
    {
      new: true,
    },
  );
};
