import { getIO } from "../../socket/socket";
import Scoring from "./scoring.model";
import Innings from "./innings.model";
import Match from "../matches/match.model";
import Player from "../players/player.model";
import { assertCanEditTeam } from "../teams/team.service";
import { finalizeMatchFromInnings } from "../matches/match.service";
import { recomputePlayerStatsForMatch } from "../players/player.stats.service";
import { recomputeTeamStatsForMatch } from "../teams/team.stats.service";

/*
|--------------------------------------------------------------------------
| Add Ball
|--------------------------------------------------------------------------
|
| The single place that turns one delivery into: a Scoring record (with
| server-computed over/ball numbering - the frontend never sends these),
| the innings totals update, and the resulting striker/non-striker/
| bowler state. Returns { ball, innings, overCompleted } - every caller
| on the frontend (LiveScoringScreen, WagonWheelModal, WicketDismissalModal)
| depends on exactly this shape.
|
*/

const NON_LEGAL_EXTRAS = ["wide", "noBall"];

/*
| Runs that never belong to the batter.
|
| A wide is the bowler's fault and a bye or leg bye came off the pad or the
| keeper - none of them are runs the batter scored. Runs off the bat on a
| no-ball DO count to the batter, which is why noBall is absent here.
*/

const NOT_BATTER_RUNS = ["wide", "bye", "legBye"];

/*
| Dismissals the bowler is not credited with.
|
| This used to be decided by the CLIENT sending bowlerCredit: false. Every
| other rule in this module is enforced on the server, and a client that
| forgot the flag handed the bowler a wicket for a run out. It is derived
| here now; an explicit false from the client is still honoured.
*/

const NO_BOWLER_CREDIT = [
  "runout",
  "run out",
  "retired",
  "retiredhurt",
  "retired hurt",
  "obstructing",
  "obstructingthefield",
  "obstructing the field",
  "handledball",
  "handled the ball",
  "hitballtwice",
  "timedout",
  "timed out",
];

const bowlerIsCredited = (wicketType: any, explicit: any) => {
  if (explicit === false) return false;

  const type = String(wicketType || "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "");

  return !NO_BOWLER_CREDIT.includes(type);
};

/*
| A safe integer from whatever the client sent.
|
| `payload.runs` used to be used raw. A string "1" turned the wide penalty
| into string concatenation - "1" + 1 = "11" - and Mongoose then cast that
| to the number 11, so a wide for a single added eleven runs to the innings.
*/

/*
|--------------------------------------------------------------------------
| Things That Are Not Deliveries
|--------------------------------------------------------------------------
|
| Two events reach this module that are NOT balls: a batter retiring, and
| penalty runs. They both go through addBall on purpose rather than through
| endpoints of their own, because everything addBall already gets right
| applies to them unchanged - authorisation, the innings-completed guard,
| the crease snapshot, the socket emit, and above all UNDO, which restores
| totals, wickets, both batters and the bowler from the stored row without
| knowing or caring what kind of row it is.
|
| What they must NOT inherit is the delivery arithmetic: neither advances
| the over, neither is bowled by anyone, and neither rotates the strike.
|
| RETIRED (Law 25.4)
|   retiredHurt - injury or illness. NOT a dismissal: no wicket falls, and
|                 the batter may come back when the next wicket does. Stored
|                 with isWicket false, which is also what keeps him in the
|                 incoming-batter list on the client.
|   retiredOut  - retired for any other reason and not returning. This IS a
|                 dismissal and costs a wicket, but no bowler is credited.
|
| PENALTY RUNS (Law 41)
|   Five runs to the batting side for an offence by the fielding side -
|   illegal fielding, deliberate distraction, damaging the pitch, ball
|   tampering. They belong to the TEAM: no batter faced them, no bowler
|   conceded them, and no ball was bowled.
|
*/

const normaliseType = (value: any) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

const RETIREMENT_TYPES = new Set(["retiredhurt", "retiredout", "retired"]);

const PENALTY_EXTRA = "penalty";

const DEFAULT_PENALTY_RUNS = 5;

const toRuns = (value: any) => {
  const n = Number(value);

  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

const canEditTeam = async (team: any, userId: string): Promise<boolean> => {
  try {
    await assertCanEditTeam(team, userId);
    return true;
  } catch {
    return false;
  }
};

export const assertCanScore = async (
  inningsId: string,
  userId: string,

  /*
  | allowCompletedMatch exists for undo, and only for undo.
  |
  | The server finalises the match on the ball that ends the second innings,
  | so the moment that ball lands the match is `completed`. A scorer who
  | mis-tapped that ball then hit Undo and got "Match not live." - the guard
  | rejected the one action that could put the mistake right, and the match
  | was frozen on a wrong result with no way back.
  |
  | Everything else keeps the old rule: no scoring on a match that is not
  | live.
  */

  options?: { allowCompletedMatch?: boolean },
) => {
  const innings = await Innings.findById(inningsId);
  if (!innings) throw new Error("Innings not found.");

  const match = await Match.findById(innings.matchId);
  if (!match) throw new Error("Match not found.");

  const stateAllowed =
    match.status === "live" ||
    (options?.allowCompletedMatch === true && match.status === "completed");

  if (!stateAllowed) throw new Error("Match not live.");

  const senderId = match.inviteSenderUserId || match.userId;
  const isInviteSender = senderId && String(senderId) === String(userId);
  const isTransferredScorer =
    match.scorerUserId && String(match.scorerUserId) === String(userId);

  if (!isInviteSender && !isTransferredScorer) {
    throw new Error("Only the captain who sent the match invite can score.");
  }

  return match;
};

export const addBall = async (payload: any, userId: string) => {
  // Single fetch — assertCanScore already loads the innings
  const match = await assertCanScore(payload.inningsId, userId);

  const innings = await Innings.findById(payload.inningsId);
  if (!innings) {
    throw new Error("Innings not found.");
  }
  if (innings.isCompleted) {
    throw new Error("This innings has already ended.");
  }

  const extraType = payload.extraType || null;

  const wicketTypeKey = normaliseType(payload.wicketType);

  const isRetirement = RETIREMENT_TYPES.has(wicketTypeKey);

  const isRetiredOut = wicketTypeKey === "retiredout";

  const isPenalty = extraType === PENALTY_EXTRA;

  const isDelivery = !isRetirement && !isPenalty;

  /*
  | A retirement and a penalty are not bowled, so they cannot be legal
  | deliveries and must not advance the over.
  */

  const isLegalDelivery = isDelivery && !NON_LEGAL_EXTRAS.includes(extraType);

  const pickedRuns = toRuns(payload.runs);

  /*
  | A retirement scores nothing. A penalty is a fixed award to the team -
  | five by the Law, but taken from the payload so a competition playing a
  | different number is not fought with.
  */

  const teamRuns = isRetirement
    ? 0
    : isPenalty
      ? pickedRuns || DEFAULT_PENALTY_RUNS
      : NON_LEGAL_EXTRAS.includes(extraType)
        ? pickedRuns + 1
        : pickedRuns;

  /*
  | Whether a wicket actually falls.
  |
  | retiredHurt is the case this exists for: the client sends it through the
  | dismissal sheet, so `isWicket` arrives true, but no wicket has fallen and
  | incrementing would end the innings a batter early. retiredOut does cost a
  | wicket. Everything else is whatever the client said.
  */

  const countsAsWicket = isRetirement ? isRetiredOut : !!payload.isWicket;

  /*
  | What the BATTER scored, as opposed to what the team scored.
  |
  | These are different numbers and the difference was being ignored: the
  | ball stored only `runs`, and the batting scorecard excluded byes and leg
  | byes but not wides - so two runs run off a wide were added to the
  | batter's total. The innings said 3, the scorecard said 5.
  |
  | Computed once here and stored, so every consumer reads the same answer
  | instead of each re-deriving it and disagreeing.
  */

  const batsmanRuns =
    !isDelivery || NOT_BATTER_RUNS.includes(extraType) ? 0 : pickedRuns;

  const priorLegalBalls = innings.balls;
  const overNumber = Math.floor(priorLegalBalls / 6);
  const ballInOver = (priorLegalBalls % 6) + 1;

  const strikerIdBefore = innings.currentStrikerId;
  const nonStrikerIdBefore = innings.currentNonStrikerId;

  /*
  | Recorded so undo can put it back. Undo restored the totals and both
  | batters but not the bowler, so undoing the first ball of an over left
  | the innings pointing at the NEW bowler with a ball that no longer
  | existed against his name.
  */

  const bowlerIdBefore = innings.currentBowlerId;

  /*
  |--------------------------------------------------------------------------
  | Innings Limits
  |--------------------------------------------------------------------------
  |
  | Nothing on the server used to stop a delivery: not the overs limit, not
  | all out, not a completed chase. A 20-over match would happily accept a
  | 121st legal ball, and an 11-a-side innings an 11th wicket.
  |
  | The client checks these too, but the client can be behind, retried, or
  | simply a different client - so the innings ends where the laws say it
  | ends, here.
  */

  const totalOvers = match.overs || 20;

  if (isLegalDelivery && priorLegalBalls >= totalOvers * 6) {
    throw new Error(
      `The innings is over - all ${totalOvers} overs have been bowled.`,
    );
  }

  const battingSquad =
    String(innings.battingTeam) === String(match.teamA)
      ? match.teamASquad || []
      : match.teamBSquad || [];

  /*
  | Ten wickets in an eleven-a-side innings. Derived from the squad rather
  | than hard-coded, because this app plays sides of other sizes.
  */

  const maxWickets = Math.max(1, (battingSquad.length || 11) - 1);

  if (countsAsWicket && innings.wickets >= maxWickets) {
    throw new Error("The innings is over - the side is already all out.");
  }

  /*
  |--------------------------------------------------------------------------
  | Commentary
  |--------------------------------------------------------------------------
  |
  | Rewritten. The old version produced "1 run at 3.3" - no bowler, no
  | batsman, and no mention of the shot or the direction, even though the
  | app asks the scorer for both on every scoring shot. The client then
  | prefixed a hardcoded "Bowler to Batsman", which is exactly what was on
  | screen.
  |
  | The format follows the one every cricket follower already reads:
  |
  |     Bowler to Batsman, FOUR, cover drive through Cover
  |
  | Names are looked up once per ball rather than per line. They are
  | resolved defensively - a local player, a deleted profile or a ball
  | recorded without a bowler all fall back to a neutral word instead of
  | printing "undefined" into permanent match commentary.
  |
  */

  const [batsmanDoc, bowlerDoc, retiringDoc] = await Promise.all([
    payload.batsmanId
      ? Player.findById(payload.batsmanId).select("playerName")
      : null,
    payload.bowlerId
      ? Player.findById(payload.bowlerId).select("playerName")
      : null,

    /*
    | A retirement names the batter who LEFT, which is dismissedPlayerId -
    | the scorer picks which of the two is walking off, and it is often the
    | non-striker.
    */
    isRetirement && payload.dismissedPlayerId
      ? Player.findById(payload.dismissedPlayerId).select("playerName")
      : null,
  ]);

  const batsmanName = batsmanDoc?.playerName || "the batter";

  const bowlerName = bowlerDoc?.playerName || "the bowler";

  const retiringName = retiringDoc?.playerName || "";

  const buildCommentary = (data: any) => {
    /*
    | Neither of these was bowled, so neither reads "X to Y". They are
    | announcements, and the commentary should sound like one.
    */

    if (isRetirement) {
      const who = retiringName || batsmanName;

      return isRetiredOut
        ? `${who} retired out`
        : `${who} retired hurt`;
    }

    if (isPenalty) {
      const reason = String(payload.penaltyReason || "").trim();

      return `${teamRuns} penalty runs to the batting side${
        reason ? ` — ${reason}` : ""
      }`;
    }

    const opener = `${bowlerName} to ${batsmanName}`;

    /*
    | The descriptive tail: shot played and where it went. Either half can
    | be missing - the scorer can skip the wagon wheel, and extras never
    | reach the shot picker at all - so each is only added when present.
    */

    const shot = (data.shotType || "").trim();

    const region = (data.wagonWheel?.region || "").trim();

    const tail = [
      shot ? shot.toLowerCase() : "",
      region ? `through ${region}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const withTail = (head: string) => (tail ? `${head}, ${tail}` : head);

    if (data.isWicket) {
      // The dismissal itself is the story; the shot is a footnote.
      return `${opener}, OUT! ${data.wicketType || "Dismissed"}`;
    }

    if (data.extraType === "wide") {
      return `${opener}, WIDE${data.runs ? ` + ${data.runs}` : ""}`;
    }

    if (data.extraType === "noBall") {
      return `${opener}, NO BALL${data.runs ? ` + ${data.runs}` : ""}`;
    }

    if (data.extraType === "bye") {
      return `${opener}, ${data.runs} bye${data.runs !== 1 ? "s" : ""}`;
    }

    if (data.extraType === "legBye") {
      return `${opener}, ${data.runs} leg bye${data.runs !== 1 ? "s" : ""}`;
    }

    if (data.runs === 0) {
      return withTail(`${opener}, no run`);
    }

    if (data.runs === 4) {
      return withTail(`${opener}, FOUR`);
    }

    if (data.runs === 6) {
      return withTail(`${opener}, SIX`);
    }

    return withTail(
      `${opener}, ${data.runs} run${data.runs !== 1 ? "s" : ""}`,
    );
  };

  const ball = await Scoring.create({
    ...payload,

    /*
    |--------------------------------------------------------------------------
    | matchId Comes From The Innings, Not The Client
    |--------------------------------------------------------------------------
    |
    | It used to arrive only in the spread above, and when the client sent it
    | as undefined every delivery died on:
    |
    |     Scoring validation failed: matchId: Path `matchId` is required.
    |
    | That is exactly what happened after a scorer came back from the wagon
    | wheel or the dismissal sheet: those screens return to LiveScoringScreen
    | with no params, React Navigation 6 REPLACES params rather than merging
    | them, and matchId was the last thing on that screen still being read
    | straight out of route.params. Wide, No Ball, Bye, Leg Bye and Wicket all
    | went through it, so from the second ball onwards the scoring pad looked
    | alive and recorded nothing.
    |
    | The screen has been fixed to hold its own matchId. This is the other
    | half: the innings ALREADY knows which match it belongs to, so there is
    | no reason for the server to depend on the client for it. A payload that
    | forgets matchId - this client, an older build, a retry - can no longer
    | stall an innings.
    |
    | inningsId is pinned the same way. assertCanScore has already resolved
    | this exact innings; taking its _id rules out a payload that names one
    | innings in the guard and another in the record.
    */

    matchId: payload.matchId || innings.matchId,
    inningsId: innings._id,

    over: overNumber,
    ball: ballInOver,
    isLegalDelivery,
    teamRuns,
    strikerIdBefore,
    nonStrikerIdBefore,

    /*
    | Explicit rather than relying on the spread: these arrive nested from
    | the client and are new to the schema, so spelling them out makes it
    | obvious they are meant to persist.
    */
    shotType: isDelivery ? payload.shotType || "" : "",

    batsmanRuns,

    /*
    | The stored isWicket is what UNDO reads to decide whether to give a
    | wicket back, and what the client reads to decide who may bat again.
    | Both answers are the same one: countsAsWicket.
    |
    | A retired-hurt batter therefore stays in the incoming-batter list and
    | can return at the next fall of a wicket, with no separate resume
    | workflow anywhere - which is exactly how Law 25.4 works.
    */

    isWicket: countsAsWicket,

    // Derived on the server so a client that forgets the flag cannot hand
    // the bowler a wicket for a run out.
    bowlerCredit:
      isDelivery && payload.isWicket
        ? bowlerIsCredited(payload.wicketType, payload.bowlerCredit)
        : !isDelivery
          ? false
          : true,

    /*
    | Nobody bowled a retirement or a penalty, so no bowler owns the row.
    | Leaving the bowler on it would put a delivery in his over and charge
    | him five runs he did not concede.
    */

    bowlerId: isDelivery ? payload.bowlerId || null : null,

    penaltyReason: isPenalty ? payload.penaltyReason || "" : "",

    bowlerIdBefore,

    wagonWheel: {
      angle: payload.wagonWheel?.angle ?? null,
      distance: payload.wagonWheel?.distance ?? null,
      region: payload.wagonWheel?.region || "",
    },

    commentaryText: buildCommentary(payload),
  });

  const newLegalBalls = priorLegalBalls + (isLegalDelivery ? 1 : 0);
  const overCompleted =
    isLegalDelivery && newLegalBalls > 0 && newLegalBalls % 6 === 0;

  /*
  |--------------------------------------------------------------------------
  | Strike Rotation
  |--------------------------------------------------------------------------
  */

  /*
  | Three things happen, in this order, and each is independent of the
  | others:
  |
  |   1. RUNS RUN. An odd number of completed runs leaves the batters at
  |      opposite ends. This applies to every kind of delivery - a single
  |      off the bat, a bye, a leg bye, runs taken off a wide.
  |
  |   2. A BATTER IS REPLACED. Whichever end the dismissed batter is
  |      standing at after the running gets the new man.
  |
  |   3. THE OVER ENDS. The bowling switches ends, so the batters swap
  |      again.
  |
  | It used to be an if/else: the odd-run swap sat in the `else` of the
  | wicket branch, so a run completed on a wicket ball never rotated the
  | strike at all. A single taken before the non-striker was run out left
  | the wrong batter facing, and every following delivery was recorded
  | against him.
  |
  | The replacement is applied AFTER the running for the same reason - the
  | dismissed batter has to be found where he actually ended up, not where
  | he started.
  */

  let currentStrikerId = strikerIdBefore;
  let currentNonStrikerId = nonStrikerIdBefore;

  const swapEnds = () => {
    const swap = currentStrikerId;
    currentStrikerId = currentNonStrikerId;
    currentNonStrikerId = swap;
  };

  /*
  | 1. Runs run.
  |
  | Guarded on isDelivery: penalty runs are five - an ODD number - and
  | without this the batters would change ends for an award nobody ran.
  */
  if (isDelivery && pickedRuns % 2 === 1) swapEnds();

  /*
  | 2. The departing batter is replaced at whichever end he is on.
  |
  | Retirements come through here too. A retired batter leaves the crease
  | exactly like a dismissed one - the only difference is whether a wicket
  | was counted above.
  */
  if (countsAsWicket || isRetirement) {
    const dismissedId = String(
      payload.dismissedPlayerId || payload.batsmanId || "",
    );

    /*
    | No incoming batter yet means the end is VACANT, not still occupied by
    | the man who just got out.
    |
    | Leaving him there was a real bug: setNextBatsman fills whichever end
    | is empty, so with the dismissed striker still in place it wrote the
    | new batter over the not-out partner instead - and that partner
    | vanished from the innings entirely.
    */

    const incomingId = payload.nextBatsmanId || null;

    if (currentStrikerId && String(currentStrikerId) === dismissedId) {
      currentStrikerId = incomingId;
    } else if (
      currentNonStrikerId &&
      String(currentNonStrikerId) === dismissedId
    ) {
      currentNonStrikerId = incomingId;
    }
  }

  // 3. Ends change over.
  if (overCompleted) swapEnds();

  const updateDoc: any = {
    $inc: {
      totalRuns: teamRuns,
      balls: isLegalDelivery ? 1 : 0,
      wickets: countsAsWicket ? 1 : 0,

      /*
      | `overs` is declared on the innings and was never written by
      | anything, so it sat at 0 for the whole match while every reader
      | derived overs from `balls`. GET /scoring/innings/:id returns the
      | raw document, so that endpoint reported 0 overs after ten.
      |
      | Kept in step here rather than removed, because it is the field an
      | innings query would naturally sort or filter on.
      */
      overs: overCompleted ? 1 : 0,
    },
    currentStrikerId,
    currentNonStrikerId,
  };

  /*
  | Not for a penalty or a retirement: nobody bowled, so the bowler at the
  | end of the over is still whoever it was.
  */
  if (payload.bowlerId && isDelivery) {
    updateDoc.currentBowlerId = payload.bowlerId;
  }

  const updatedInnings = await Innings.findByIdAndUpdate(
    payload.inningsId,
    updateDoc,
    { new: true },
  );

  /*
  |--------------------------------------------------------------------------
  | Did That End The Innings?
  |--------------------------------------------------------------------------
  |
  | Reported rather than acted on: the client drives the innings-break and
  | match-result screens, and silently completing the innings here would
  | pull the rug from under a scorer who still has an undo to make.
  |
  | But it IS computed on the server, from the freshly incremented totals,
  | so the client no longer has to work it out from route params it may
  | have lost.
  */

  const ballsAfter = updatedInnings?.balls ?? priorLegalBalls;

  const wicketsAfter = updatedInnings?.wickets ?? innings.wickets;

  const runsAfter = updatedInnings?.totalRuns ?? innings.totalRuns;

  const oversExhausted = ballsAfter >= totalOvers * 6;

  const allOut = wicketsAfter >= maxWickets;

  let targetReached = false;

  if (innings.inningsNumber === 2) {
    const first = await Innings.findOne({
      matchId: innings.matchId,
      inningsNumber: 1,
    });

    if (first) targetReached = runsAfter > first.totalRuns;
  }

  const inningsComplete = oversExhausted || allOut || targetReached;

  /*
  |--------------------------------------------------------------------------
  | The Server Ends The Innings
  |--------------------------------------------------------------------------
  |
  | This used to be REPORTED and left to the client to act on, and that one
  | decision is behind most of the ways a match got stuck.
  |
  | LiveScoringScreen called endInnings and never checked the result. The
  | hook resolves { success: false } instead of throwing, so a network blip
  | on the last ball of the first innings left isCompleted false while the
  | scorer walked on to the second. From then on the live card resolved
  | "the innings that is not completed" to the FIRST one - so reopening the
  | app dropped the scorer back into a finished innings with no target, and
  | every ball they recorded inflated the first-innings total that decides
  | whether the chase has been won.
  |
  | Ending it here makes the state of the innings a fact about the innings,
  | not a side effect of a screen that may never run. Undo re-opens it - see
  | undoLastBall.
  */

  if (inningsComplete && !innings.isCompleted) {
    await Innings.findByIdAndUpdate(payload.inningsId, {
      isCompleted: true,
      completedAt: new Date(),
    });
  }

  /*
  | And when it was the SECOND innings, the match itself is over. Deciding
  | that here rather than on the result screen is what makes a tie, a level
  | all-out, and a scorer who closes the app on the winning run all come out
  | right - see finalizeMatchFromInnings in match.service.ts.
  */

  let matchCompleted = false;

  if (inningsComplete && innings.inningsNumber === 2) {
    try {
      await finalizeMatchFromInnings(String(innings.matchId));
      matchCompleted = true;
    } catch (error: any) {
      // Never fail the delivery over the result write; it can be retried.
      console.error("[addBall] finalizeMatchFromInnings failed:", error?.message);
    }
  }

  const populatedInnings = await Innings.findById(payload.inningsId)
    .populate("currentStrikerId")
    .populate("currentNonStrikerId")
    .populate("currentBowlerId");

  getIO().emit("score:update", { ball, innings: populatedInnings });

  return {
    ball,
    innings: populatedInnings,
    overCompleted,

    inningsComplete,
    oversExhausted,
    allOut,
    targetReached,
    maxWickets,
    totalOvers,

    // The client uses this to go to the result rather than the innings break.
    matchCompleted,
    inningsNumber: innings.inningsNumber,
  };
};

/*
|--------------------------------------------------------------------------
| Undo Last Ball
|--------------------------------------------------------------------------
*/

export const undoLastBall = async (inningsId: string, userId: string) => {
  /*
  | Undo is allowed on a match the server has just finalised - see the note
  | on assertCanScore. Without it, the ball that ends the match is the one
  | ball that can never be taken back.
  */

  const match = await assertCanScore(inningsId, userId, {
    allowCompletedMatch: true,
  });

  /*
  | `_id` breaks the tie.
  |
  | Sorting on createdAt alone is not deterministic: Mongoose timestamps are
  | millisecond-precision, so two deliveries recorded in the same
  | millisecond - exactly what a double-tap produces - sort arbitrarily, and
  | undo could delete the EARLIER ball while the later one survived. ObjectIds
  | are monotonic within a process, so they order what the clock cannot.
  */

  const lastBall = await Scoring.findOne({ inningsId }).sort({
    createdAt: -1,
    _id: -1,
  });

  if (!lastBall) {
    throw new Error("There's nothing to undo.");
  }

  await Scoring.findByIdAndDelete(lastBall._id);

  /*
  | Whether removing this ball also un-completes an over, so `overs` is
  | wound back with everything else.
  */

  const ballsBefore = (await Innings.findById(inningsId))?.balls ?? 0;

  const uncompletedAnOver =
    lastBall.isLegalDelivery && ballsBefore > 0 && ballsBefore % 6 === 0;

  const updatedInnings = await Innings.findByIdAndUpdate(
    inningsId,
    {
      $inc: {
        totalRuns: -(lastBall.teamRuns || 0),
        balls: lastBall.isLegalDelivery ? -1 : 0,
        wickets: lastBall.isWicket ? -1 : 0,
        overs: uncompletedAnOver ? -1 : 0,
      },
      currentStrikerId: lastBall.strikerIdBefore,
      currentNonStrikerId: lastBall.nonStrikerIdBefore,

      /*
      | The bowler is restored too.
      |
      | Undo put the batters back but not the bowler, so undoing the first
      | ball of an over left the innings pointing at the new bowler for a
      | ball that no longer existed - his figures showed a delivery that had
      | been deleted, and the scorer was never re-prompted to pick.
      |
      | Older balls have no bowlerIdBefore recorded, so the current bowler
      | is kept rather than blanked.
      */
      ...(lastBall.bowlerIdBefore
        ? { currentBowlerId: lastBall.bowlerIdBefore }
        : {}),

      /*
      | Undoing the delivery that ENDED the innings re-opens it.
      |
      | The server now completes an innings automatically on the last ball,
      | so without this an undo would leave a closed innings that refuses
      | every further delivery - and the scorer correcting a mis-tapped
      | final wicket would have no way back in.
      */
      isCompleted: false,
      completedAt: null,
    },
    { new: true },
  );

  /*
  |--------------------------------------------------------------------------
  | Un-finishing A Match
  |--------------------------------------------------------------------------
  |
  | The innings above has just been re-opened. If the ball being undone was
  | the one that ENDED the match, the match itself is sitting on `completed`
  | with a result and an end time - and every following delivery would be
  | refused with "Match not live." while the scoring pad still looked live.
  |
  | Putting the match back to live is the only consistent answer: the result
  | was derived from a ball that no longer exists. finalizeMatchFromInnings
  | writes it again, from scratch, on whatever ball ends the match next.
  |
  | winnerTeam, result and endTime are cleared with it so nothing keeps
  | showing a verdict for a game that is running again.
  */

  if (match.status === "completed") {
    await Match.findByIdAndUpdate(match._id, {
      status: "live",
      winnerTeam: null,
      result: "",
      endTime: null,
    });

    /*
    | The match is live again, so it must stop counting toward anybody's
    | career figures until it finishes for real. Recomputing rather than
    | subtracting means this is simply true again, with no arithmetic to get
    | wrong - the match is no longer in the completed set, so it no longer
    | contributes.
    */

    void recomputePlayerStatsForMatch(match._id);

    // The teams' record has to go back too - this match is unfinished again.
    void recomputeTeamStatsForMatch(match._id);
  }

  // FIX: same as addBall — return a populated innings so the frontend
  // keeps showing player names after an undo.
  const populatedInnings = await Innings.findById(inningsId)
    .populate("currentStrikerId")
    .populate("currentNonStrikerId")
    .populate("currentBowlerId");

  return {
    innings: populatedInnings,
    undoneBall: lastBall,
  };
};

/*
|--------------------------------------------------------------------------
| Set Next Bowler
|--------------------------------------------------------------------------
*/

export const setNextBowler = async (
  inningsId: string,
  playerId: string,
  userId: string,
) => {
  // Validate inputs early for clearer errors
  if (!inningsId) {
    throw new Error("setNextBowler: missing inningsId");
  }
  if (!playerId) {
    throw new Error("setNextBowler: missing playerId");
  }

  // Authorization check (will throw if not allowed)
  await assertCanScore(inningsId, userId);

  // Update and return a populated innings document so callers get player objects
  const innings = await Innings.findByIdAndUpdate(
    inningsId,
    {
      currentBowlerId: playerId,
    },
    {
      new: true,
    },
  )
    .populate("currentStrikerId")
    .populate("currentNonStrikerId")
    .populate("currentBowlerId");

  if (!innings) {
    throw new Error(`Innings not found for id=${inningsId}`);
  }

  // Notify connected clients (best-effort)
  try {
    getIO().emit("score:update", { innings });
  } catch (e) {
    console.warn("setNextBowler: socket emit raw error:", e);
  }

  return innings;
};

/*
|--------------------------------------------------------------------------
| Set Next Batsman
|--------------------------------------------------------------------------
*/

export const setNextBatsman = async (
  inningsId: string,
  playerId: string,
  userId: string,
) => {
  await assertCanScore(inningsId, userId);

  const innings = await Innings.findById(inningsId);

  if (!innings) {
    throw new Error("Innings not found.");
  }

  /*
  | Fill whichever end is vacant.
  |
  | This works now that addBall clears the dismissed batter's end instead of
  | leaving him standing there - previously the striker's end was never
  | empty, so a dismissed striker's replacement was written over the not-out
  | partner at the other end.
  |
  | If both ends somehow hold a player, the striker's end is replaced: it is
  | the end a new batter takes in every dismissal except a run out at the
  | bowler's end, and overwriting the man on strike is at least visible to
  | the scorer immediately.
  */

  const field = !innings.currentStrikerId
    ? "currentStrikerId"
    : !innings.currentNonStrikerId
      ? "currentNonStrikerId"
      : "currentStrikerId";

  return await Innings.findByIdAndUpdate(
    inningsId,
    {
      [field]: playerId,
    },
    {
      new: true,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Get Scorecard
|--------------------------------------------------------------------------
*/

export const getScorecard = async (inningsId: string) => {
  const innings = await Innings.findById(inningsId)
    .populate("currentStrikerId")
    .populate("currentNonStrikerId")
    .populate("currentBowlerId");

  /*
  | Balls come back with their batsman, bowler, dismissed player and
  | fielder populated.
  |
  | They used to be raw ObjectIds, which forced the client to look every
  | name up in the squad lists it happened to have loaded. Anyone missing
  | from those lists resolved to "Select Player" and the commentary line
  | silently fell back to the old, name-less stored text - which is why
  | some deliveries read "SIX! at 3.2" while their neighbours read properly.
  |
  | Carrying the names on the ball makes the line correct regardless of
  | what the client has loaded, and works for balls recorded long ago.
  */

  const balls = await Scoring.find({ inningsId })
    .populate("batsmanId", "playerName")
    .populate("bowlerId", "playerName")
    .populate("dismissedPlayerId", "playerName")
    .populate("fielderId", "playerName")
    .sort({ over: 1, ball: 1, createdAt: 1 });

  return { innings, balls };
};
