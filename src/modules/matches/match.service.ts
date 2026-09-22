import { getIO } from "../../socket/socket";
import Match from "./match.model";
import Innings from "../scoring/innings.model";
import Scoring from "../scoring/scoring.model";
import Team from "../teams/team.model";
import Player from "../players/player.model";
import mongoose from "mongoose";

import { assertCanEditTeam } from "../teams/team.service";
import { recomputePlayerStatsForMatch } from "../players/player.stats.service";
import { recomputeTeamStatsForMatch } from "../teams/team.stats.service";

import {
  sendMatchConfirmationRequiredNotification,
  sendMatchConfirmedNotification,
  sendMatchConfirmationRejectedNotification,
  sendMatchPinSharedNotification,
} from "../notifications/notification.helper";

/*
| Follower fan-out. Every function here swallows its own errors, so none of
| these calls can fail a match transition - see follow.fanout.ts.
*/

import {
  notifyFollowersMatchLive,
  notifyFollowersMatchResult,
  notifyFollowersPlayerOfTheMatch,
} from "../follows/follow.fanout";

/*
| Tournament points table + bracket progression. Imported here because
| finalizing a match is the single moment a tournament advances.
*/

import { recomputeStandingsForMatch } from "../tournaments/standings.service";
import { recomputeScorelineForMatch } from "../series/series.service";

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

const canEditTeam = async (team: any, userId: string): Promise<boolean> => {
  try {
    await assertCanEditTeam(team, userId);
    return true;
  } catch {
    return false;
  }
};

/*
|--------------------------------------------------------------------------
| Is This User The Scorer?
|--------------------------------------------------------------------------
|
| The one rule, in one place, so the match feed and the match details
| screen cannot disagree about who sees a SCORE NOW button.
|
| It mirrors assertCanScore exactly: the stored scorer owns it, and the
| invite-sender fallback applies only to matches that went live before
| scorerUserId was being recorded.
|
| Sent to the client as `isScorer` so no screen has to re-derive it from
| three id fields and get it subtly wrong - which is what every one of
| them was doing.
*/

const isMatchScorer = (match: any, userId?: string): boolean => {
  if (!userId) return false;

  if (match?.scorerUserId) {
    return String(match.scorerUserId) === String(userId);
  }

  const senderId = match?.inviteSenderUserId || match?.userId;

  return !!senderId && String(senderId) === String(userId);
};

const canManageTeam = async (team: any, userId: string): Promise<boolean> => {
  try {
    await assertCanEditTeam(team, userId);
    return true;
  } catch {
    return false;
  }
};

/*
|--------------------------------------------------------------------------
| Is this a fixture somebody else organised?
|--------------------------------------------------------------------------
|
| A match belongs to one of two worlds and they have different rules about
| who may start it:
|
|   CHALLENGE MATCH   two teams agreed to play each other. There is no
|                     third party. Either captain starts it, and the PIN
|                     from the other side is the proof both are present.
|
|   ORGANISED FIXTURE part of a tournament or a series. Somebody ELSE
|                     decided this match exists, when it is played and who
|                     plays it. The organizer - or whoever they handed the
|                     scoring to - starts it. The captains do not.
|
| The distinction is simply whether the match is linked to a tournament or
| a series, because that link is what says a third party owns the schedule.
*/

const isOrganizedFixture = (match: any): boolean =>
  !!(match?.tournamentId || match?.seriesId);

/*
|--------------------------------------------------------------------------
| Who may start this match
|--------------------------------------------------------------------------
|
| ONE function, called by BOTH the read that draws the button and the write
| that starts the match. They were separate before and drifted: the screen
| showed Start Match to a tournament team's captain, they tapped it, and
| the server let them - so a group-stage fixture could be started by one
| side while the organizer was still setting up.
|
| For an organised fixture the captains are deliberately excluded. Not
| because they are untrusted, but because the schedule is not theirs: a
| captain starting a fixture early puts a live match on the tournament's
| points table that the organizer never sanctioned, and the result counts.
|
| What the captains still hold is the PIN. The organizer manages neither
| side, so requiredPinSides asks them for BOTH - the match cannot begin
| until each captain has handed their code over in person. Control of the
| schedule and proof that both teams are present are different questions,
| and each stays with the person who should answer it.
|
| Note the scorer branch covers the organizer for a normal fixture
| (fixtures are created with scorerUserId set to the organizer) AND the
| person they reassigned it to with assignMatchScorer. `match.userId` is
| checked as well so a fixture created before scorerUserId was recorded is
| still startable by its organizer.
*/

const canStartMatch = (
  match: any,
  userId: string | undefined,
  managesTeamA: boolean,
  managesTeamB: boolean,
): boolean => {
  if (!userId) return false;

  const isOwner = String(match?.userId || "") === String(userId);

  if (isOrganizedFixture(match)) {
    return isOwner || isMatchScorer(match, userId);
  }

  return (
    managesTeamA ||
    managesTeamB ||
    isOwner ||
    isMatchScorer(match, userId) ||
    String(match?.inviteSenderUserId || "") === String(userId)
  );
};

/*
|--------------------------------------------------------------------------
| Which PINs does this person have to produce?
|--------------------------------------------------------------------------
|
| ONE rule, in ONE place: a PIN is required for each of the two teams the
| starter does NOT manage.
|
|   manages both     no PIN - they own both sides, there is nobody to
|                    prove anything to
|   manages one      the opponent's PIN
|   manages neither  BOTH PINs, one from each captain
|
| The third case is the tournament and series organizer. They are the
| match's scorer by default and manage neither side, so starting a match
| means collecting a PIN from each captain - which is exactly right. An
| organizer who could start a fixture alone could start it while one team
| was still travelling.
|
| WHY THIS IS EXPORTED AND CALLED FROM getMatchById TOO
| The screen that collects the PINs and the gate that checks them have to
| agree perfectly. Derived separately they will drift, and the failure is
| silent and horrible: the app asks for one PIN, the server demands two,
| and the organizer stands at the ground reading "Incorrect PIN for Team A"
| while holding a PIN that is completely correct.
|
| So the UI does not re-derive the rule. It renders whatever this returns.
|
*/

export const requiredPinSides = (
  match: any,
  managesTeamA: boolean,
  managesTeamB: boolean,
) => {
  const sides: { side: "teamA" | "teamB"; teamName: string; hasPin: boolean }[] =
    [];

  if (!managesTeamA) {
    sides.push({
      side: "teamA",
      teamName: match?.teamA?.teamName || "Team A",
      /*
      | A match with no PIN stored for that side cannot be gated on one -
      | the gate skips it, so the UI must not ask for it either. This is
      | true of matches created before PINs existed, and of a side whose
      | PIN was already spent.
      */
      hasPin: !!match?.teamAPin,
    });
  }

  if (!managesTeamB) {
    sides.push({
      side: "teamB",
      teamName: match?.teamB?.teamName || "Team B",
      hasPin: !!match?.teamBPin,
    });
  }

  return sides.filter((s) => s.hasPin);
};

/*
|--------------------------------------------------------------------------
| Create Match
|--------------------------------------------------------------------------
*/

export const createMatch = async (userId: string, payload: any) => {
  return await Match.create({
    ...payload,
    userId,
    inviteSenderUserId: userId,
    teamAPin: Math.floor(1000 + Math.random() * 9000).toString(),
    teamBPin: Math.floor(1000 + Math.random() * 9000).toString(),
  });
};

/*
|--------------------------------------------------------------------------
| "My Matches" (Creator Only)
|--------------------------------------------------------------------------
*/

export const getMatches = async (userId: string) => {
  return await Match.find({ userId })
    .populate("teamA")
    .populate("teamB")
    .populate("tossWinner");
};

/*
|--------------------------------------------------------------------------
| Get Match By ID (with canManage / matchPin / isInviteSender)
|--------------------------------------------------------------------------
*/

export const getMatchById = async (matchId: string, userId?: string) => {
  const match = await Match.findById(matchId)
    .populate({ path: "teamA", populate: { path: "players" } })
    .populate({ path: "teamB", populate: { path: "players" } })
    .populate("tossWinner")
    // So the Live tab can name the Player of the Match once it is set.
    .populate("playerOfTheMatch", "playerName profileImage playerType")
    .populate("winnerTeam", "teamName shortName logo")
    .populate("teamASquad", "playerName playerType userId")
    .populate("teamBSquad", "playerName playerType userId");

  if (!match) return null;

  let canManage = false;
  let matchPin: string | null | undefined;
  let isInviteSender = false;

  /*
  | Per-side management, sent to the client as well as `canManage`.
  |
  | `canManage` is "manages EITHER team", which is the wrong question for
  | two things the app has to decide: which PINs to ask for, and whether
  | to show a Start Match button at all.
  */

  let managesTeamA = false;
  let managesTeamB = false;

  /* Which PINs this user must produce - see requiredPinSides. */
  let pinsRequired: ReturnType<typeof requiredPinSides> = [];

  if (userId) {
    managesTeamA = await canEditTeam(match.teamA, userId);
    managesTeamB = await canEditTeam(match.teamB, userId);
    canManage = managesTeamA || managesTeamB;

    if (match.status === "upcoming") {
      pinsRequired = requiredPinSides(match, managesTeamA, managesTeamB);
    }

    /*
    | Only while the match is still waiting to start. Once it is live,
    | completed or cancelled the PIN is spent (startMatch nulls both), and
    | this also hides the PIN on matches that went live before that change.
    */

    if (canManage && match.status === "upcoming") {
      matchPin = managesTeamA ? match.teamAPin : match.teamBPin;
    }

    isInviteSender = !!(
      match.inviteSenderUserId &&
      String(match.inviteSenderUserId) === String(userId)
    );
  }

  /*
  | Both raw PINs used to ride out on every response inside this spread.
  | Anyone who could open the match - including the opposing captain, who is
  | the exact person the PIN is meant to prove something to - could read the
  | other side's PIN out of the payload and start the match without ever
  | asking for it.
  |
  | `matchPin` above is the only PIN that leaves the server, and it is that
  | user's OWN side's PIN, only before the match starts.
  */

  const { teamAPin: _a, teamBPin: _b, ...obj } = match.toObject() as any;

  const isScorer = isMatchScorer(match, userId);

  return {
    ...obj,
    canManage,
    managesTeamA,
    managesTeamB,
    matchPin,
    isInviteSender,

    /*
    | Whether THIS user is the one scoring. Drives the SCORE NOW button.
    */
    isScorer,

    /*
    |--------------------------------------------------------------------------
    | Who may START this match
    |--------------------------------------------------------------------------
    |
    | The app gated its Start Match button on `canManage` - "captain of one
    | of the two teams". That is not the rule startMatch enforces, and the
    | gap had one specific victim: the TOURNAMENT AND SERIES ORGANIZER.
    |
    | An organizer is the fixture's scorer by default and captains neither
    | side, so `canManage` was false and the button never rendered. They
    | could open their own tournament's match and had no way to begin it.
    |
    | This mirrors startMatch's authorisation exactly - the SAME function
    | decides both, so the button and the guard cannot disagree.
    |
    | On a TOURNAMENT or SERIES fixture the captains are excluded: the
    | organizer owns the schedule, and a captain starting a fixture on
    | their own puts a result on somebody else's points table. See
    | canStartMatch. What the organizer still has to do is produce both
    | captains' PINs - see pinsRequired - which is the correct amount of
    | friction, not a wall.
    */
    canStart:
      match.status === "upcoming" &&
      canStartMatch(match, userId, managesTeamA, managesTeamB),

    /*
    | So the screen can say WHY there is no button rather than just not
    | drawing one. A captain opening their tournament fixture should read
    | "the organizer starts this match", not wonder what is broken.
    */
    isOrganizedFixture: isOrganizedFixture(match),

    /*
    | Exactly which PINs to collect, with the team names to label the
    | inputs. Empty when none are needed. The screen renders this list
    | rather than working the rule out for itself, so what is asked for and
    | what is checked can never disagree.
    */
    pinsRequired,
  };
};

/*
|--------------------------------------------------------------------------
| Ownership Guard (Creator-only operations: delete, complete)
|--------------------------------------------------------------------------
*/

const assertIsMatchOwner = async (matchId: string, userId: string) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new Error("Match not found.");
  }

  console.log("assertIsMatchOwner → match.userId:", String(match.userId));
  console.log("assertIsMatchOwner → userId param:", userId);

  if (!match.userId || String(match.userId) !== String(userId)) {
    throw new Error("You are not authorized to modify this match.");
  }

  return match;
};

/*
|--------------------------------------------------------------------------
| Update Match  —  ✅ NOW USES canManageTeam (either captain)
|--------------------------------------------------------------------------
|
| Either captain can update match setup (squads, toss, etc.).
| Consistent with resetMatchSetup and startMatch.
| PROTECTED_FIELDS still prevents anyone from overwriting status,
| userId, PINs, winnerTeam, result, startTime, endTime.
|
*/

const PROTECTED_FIELDS = [
  "userId",
  "status",
  "confirmationStatus",
  "confirmationRequiredFrom",
  "teamAPin",
  "teamBPin",
  "winnerTeam",
  "result",
  "startTime",
  "endTime",
];

export const updateMatch = async (
  userId: string,
  matchId: string,
  payload: any,
) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const managesTeamA = await canManageTeam(match.teamA, userId);
  const managesTeamB = await canManageTeam(match.teamB, userId);

  if (!managesTeamA && !managesTeamB) {
    throw new Error("You are not authorized to modify this match.");
  }

  const safePayload = { ...payload };

  PROTECTED_FIELDS.forEach((field) => {
    delete safePayload[field];
  });

  return await Match.findByIdAndUpdate(matchId, safePayload, {
    new: true,
  });
};

/*
|--------------------------------------------------------------------------
| Delete Match (Creator-only)
|--------------------------------------------------------------------------
*/

export const deleteMatch = async (userId: string, matchId: string) => {
  await assertIsMatchOwner(matchId, userId);
  return await Match.findByIdAndDelete(matchId);
};

/*
|--------------------------------------------------------------------------
| Reset Match Setup (upcoming only, either captain)
|--------------------------------------------------------------------------
*/

export const resetMatchSetup = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const canManage =
    (await canEditTeam(match.teamA, userId)) ||
    (await canEditTeam(match.teamB, userId));

  if (!canManage) {
    throw new Error("You are not authorized to reset this match setup.");
  }

  if (match.status === "live" || match.status === "completed") {
    throw new Error("A live or completed match cannot be reset.");
  }

  match.teamASquad = [];
  match.teamBSquad = [];
  match.tossWinner = null;
  match.tossDecision = null;

  await match.save();

  await Innings.deleteMany({ matchId: match._id });
  await Scoring.deleteMany({ matchId: match._id });

  return match;
};

/*
|--------------------------------------------------------------------------
| Start Match (Opponent-PIN-gated, either captain)
|--------------------------------------------------------------------------
*/

export const startMatch = async (
  userId: string,
  matchId: string,
  pin?: string,
  pins?: { teamA?: string; teamB?: string },

  /*
  | The whole match setup - both playing XIs and the toss - applied HERE,
  | in the same write that takes the match live, and only after the PIN
  | has been accepted.
  |
  | The three setup screens used to save as they went: Squad Selection
  | wrote both squads, Toss wrote the result, each on its own request and
  | each before any PIN existed. So a captain who set everything up and
  | then mistyped the PIN left their squads and their toss on the match
  | anyway - and the opposing captain, starting fresh later, was handed
  | somebody else's abandoned setup with no way to tell.
  |
  | Passing it through the PIN gate makes the whole thing one decision:
  | either the match starts with this setup, or nothing was written at all.
  */
  setup?: {
    teamASquad?: string[];
    teamBSquad?: string[];
    tossWinner?: string;
    tossDecision?: string;
  },
) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const managesTeamA = await canEditTeam(match.teamA, userId);
  const managesTeamB = await canEditTeam(match.teamB, userId);

  /*
  |--------------------------------------------------------------------------
  | Who May Start
  |--------------------------------------------------------------------------
  |
  | This used to require managing one of the two teams, full stop. That
  | rules out a neutral scorer - somebody recording a match between two
  | teams they have nothing to do with - which is the whole point of Quick
  | Score.
  |
  | A neutral scorer is allowed here ONLY because the match already exists,
  | and for a neutral scorer a match only comes into existence after both
  | captains approved the scoring request. The consent was collected before
  | this point; what is checked below is the PIN, which is a different
  | question - not "did you agree" but "are you here, now".
  |
  */

  /*
  | The SAME function that decided whether to draw the button. Hiding a
  | control is not a permission check - a captain of a tournament team
  | could previously call this endpoint directly and start the fixture even
  | once the button was gone from their screen.
  */

  if (!canStartMatch(match, userId, managesTeamA, managesTeamB)) {
    throw new Error(
      isOrganizedFixture(match)
        ? "Only the organizer (or the scorer they assigned) can start this match."
        : "You are not authorized to start this match.",
    );
  }

  if (match.status === "live") {
    return match;
  }

  if (match.status !== "upcoming") {
    throw new Error("This match cannot be started from its current state.");
  }

  /*
  |--------------------------------------------------------------------------
  | PIN Gate
  |--------------------------------------------------------------------------
  |
  | One rule: a PIN is required for each of the two teams the starter does
  | NOT manage.
  |
  |   manages both    -> no PIN (they own both sides; nobody to prove
  |                      anything to)
  |   manages one     -> the opponent's PIN. Unchanged behaviour, and what
  |                      the Add Match flow has always done.
  |   manages neither -> both PINs, one from each captain.
  |
  | `pin` is kept for the single-PIN callers that already exist; `pins`
  | carries the pair. Checking both teams in one loop means the two-PIN
  | case cannot accidentally accept one correct PIN and ignore the other.
  |
  */

  /*
  | Built by requiredPinSides - the SAME function getMatchById calls to
  | tell the app which inputs to draw. One rule, one place: the screen
  | cannot ask for one PIN while the gate demands two.
  */

  const required = requiredPinSides(match, managesTeamA, managesTeamB);

  for (const entry of required) {
    const expected =
      entry.side === "teamA" ? match.teamAPin : match.teamBPin;

    /*
    | `pins` carries the pair and is what the app sends now. `pin` is kept
    | for the single-PIN callers that already exist: when the starter
    | manages one side there is only one PIN to give, and the old flat
    | field is still a correct way to give it.
    |
    | It is deliberately NOT accepted when the starter manages neither
    | side. One value cannot satisfy two different PINs, and letting it
    | try would mean a lucky collision could open the gate on half the
    | proof.
    */

    const given =
      pins?.[entry.side] ??
      (required.length === 1 ? pin : undefined);

    if (given !== expected) {
      throw new Error(
        `Incorrect PIN for ${entry.teamName}. Ask that team's captain for their PIN.`,
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Who Is Scoring This Match
  |--------------------------------------------------------------------------
  |
  | Whoever starts it. This was never recorded, and everything downstream
  | went wrong because of it.
  |
  | scorerUserId stayed null through every start, so assertCanScore fell
  | back to "the captain who sent the invite" - which is backwards in the
  | common case. If the ACCEPTING captain started the match, they could not
  | record a single ball ("Only the captain who sent the match invite can
  | score"), while the captain who sent the invite and did nothing could.
  |
  | It also left both captains looking at a SCORE NOW button for a match
  | only one of them is actually scoring.
  |
  | Set once, on the transition to live: the first captain to get through
  | the PIN gate owns the scoring. It is not overwritten if it is already
  | set - a scoring request approved in the Quick Score flow names its
  | scorer up front, and transferScoring hands it to somebody else later.
  */

  const update: any = { status: "live", startTime: new Date() };

  if (!match.scorerUserId) {
    update.scorerUserId = userId;
  }

  /*
  |--------------------------------------------------------------------------
  | The PINs Are Spent
  |--------------------------------------------------------------------------
  |
  | A PIN exists to answer one question, once: "are both captains here and
  | do they agree to start?" The moment the match is live that question has
  | been answered and the PIN has no job left - the early return above means
  | it can never gate a second start of this match.
  |
  | Leaving them stored meant both captains kept staring at a Match PIN card
  | on the match screen, a PIN chip on the home feed and a PIN in their
  | notifications for a game already being scored. It reads like something
  | still to be done, and it is a live secret sitting in the UI and in the
  | database for no reason.
  |
  | Cleared for BOTH sides, not just the starter's: they are two halves of
  | the same gate and the gate is now open.
  |
  | getMatchById and the list builders also stop returning matchPin once a
  | match leaves `upcoming`, which covers matches that went live before this
  | change and still have their PINs on the document.
  */

  update.teamAPin = null;
  update.teamBPin = null;

  /*
  | The setup joins the same update, so it lands atomically with the status.
  | Each field is applied only if it was actually sent - a caller that
  | already saved the setup some other way is not forced to resend it.
  */

  if (setup?.teamASquad?.length) update.teamASquad = setup.teamASquad;
  if (setup?.teamBSquad?.length) update.teamBSquad = setup.teamBSquad;
  if (setup?.tossWinner) update.tossWinner = setup.tossWinner;
  if (setup?.tossDecision) update.tossDecision = setup.tossDecision;

  const started = await Match.findByIdAndUpdate(matchId, update, {
    new: true,
  });

  /*
  | Tell everyone following either team that the match is live.
  |
  | Placed after the status write and deliberately not awaited-into the
  | return value: the captain starting the match should not wait on a
  | fan-out to a few hundred followers before the scoring screen opens.
  |
  | The early return above for an already-live match matters here - without
  | it, a captain tapping Start twice would fan out twice.
  */

  void notifyFollowersMatchLive(started);

  return started;
};

/*
|--------------------------------------------------------------------------
| Finalize A Match From Its Innings
|--------------------------------------------------------------------------
|
| Called by addBall the moment the second innings ends. The result was
| previously worked out on MatchResultScreen and written from there, which
| left four holes:
|
|   A TIE WAS NEVER SAVED. The screen printed "Match tied" and skipped the
|   write entirely, because it guarded on having a winner. The match stayed
|   `live` forever, sitting in the live feed and never reaching Recent.
|
|   A TRANSFERRED SCORER COULD NOT SAVE IT. updateMatchResult authorises on
|   captaincy, but scoring can be handed to any squad player. Their write
|   was rejected 400 and the screen only console.error'd it - so the scorer
|   saw a result that had not been recorded.
|
|   THE MARGIN ASSUMED ELEVEN A SIDE. It read `10 - wickets`, so an
|   eight-a-side match reported the wrong margin and fanned that out to
|   every follower.
|
|   CLOSING THE APP ON THE WINNING RUN LOST THE RESULT, because the only
|   writer was a screen that had not been reached yet.
|
| Deciding it here, from the innings themselves, fixes all four at once.
| It is idempotent: a match already completed is returned untouched.
|
*/

/*
|--------------------------------------------------------------------------
| Player Of The Match
|--------------------------------------------------------------------------
|
| There is no Law for this award - it is an adjudicator's judgment, which is
| why no cricket rulebook defines it. What follows is therefore a stated
| policy, not a rule, and it is written out so that a scorer who disagrees
| with a pick can at least see the reasoning rather than guess at it.
|
| The policy: an impact score per player, built only from what actually
| happened on the field, and the highest wins.
|
|   BATTING   1 per run, plus 1 per four and 2 per six on top - a boundary
|             is worth more than the same runs nudged around. A strike-rate
|             bonus applies only from 10 balls, because a 12-ball 20 is not
|             evidence of anything.
|
|   BOWLING   25 per wicket - a wicket is the most valuable single act in
|             cricket and the weights say so - plus an economy bonus per
|             over below six an over, and 8 per maiden.
|
|   FIELDING  8 for a catch, a stumping or a run-out. Small, because the
|             data cannot tell a regulation catch from a blinder, and
|             over-weighting it would hand the award to a busy keeper.
|
|   WINNING   The whole score is multiplied by 1.25 for the winning side.
|             Almost every real award goes to a winner, and a losing
|             centurion beating a winning all-rounder reads as wrong to
|             everyone watching. Not applied to a tie.
|
| Ties in the score break on wickets, then runs, then player id, so the
| same match always produces the same answer.
|
| The returned `line` is the stat line the award card shows - "82 (41) &
| 2/24". A name with no numbers under it invites exactly the argument the
| card is meant to settle.
|
*/

const computePlayerOfTheMatch = async (
  matchId: string,
  winnerTeam: any,
): Promise<{ playerId: any; line: string } | null> => {
  const balls = await Scoring.find({ matchId }).lean();

  if (balls.length === 0) return null;

  const innings = await Innings.find({ matchId }).lean();

  const battingTeamByInnings = new Map(
    innings.map((i: any) => [String(i._id), String(i.battingTeam)]),
  );

  type Row = {
    runs: number;
    ballsFaced: number;
    fours: number;
    sixes: number;
    wickets: number;
    runsConceded: number;
    ballsBowled: number;
    catches: number;
    teamId: string;
  };

  const rows = new Map<string, Row>();

  const row = (id: any, teamId: string): Row => {
    const key = String(id);

    if (!rows.has(key)) {
      rows.set(key, {
        runs: 0,
        ballsFaced: 0,
        fours: 0,
        sixes: 0,
        wickets: 0,
        runsConceded: 0,
        ballsBowled: 0,
        catches: 0,
        teamId,
      });
    }

    const found = rows.get(key)!;

    // The first team seen wins; a player only ever plays for one side here.
    if (!found.teamId && teamId) found.teamId = teamId;

    return found;
  };

  for (const ball of balls as any[]) {
    const battingTeam = battingTeamByInnings.get(String(ball.inningsId)) || "";

    const bowlingTeam =
      innings.find((i: any) => String(i._id) === String(ball.inningsId))
        ?.bowlingTeam || "";

    // ── Batting ──────────────────────────────────────────────────────
    if (ball.batsmanId) {
      const r = row(ball.batsmanId, battingTeam);

      r.runs += ball.batsmanRuns ?? 0;

      /*
      | Balls faced excludes wides, and excludes the rows that are not
      | deliveries at all - a retirement and a penalty are recorded with
      | no batsmanId, so they never reach here in the first place.
      */
      if (ball.extraType !== "wide" && ball.isLegalDelivery !== false) {
        r.ballsFaced += 1;
      }

      if ((ball.batsmanRuns ?? 0) === 4) r.fours += 1;
      if ((ball.batsmanRuns ?? 0) === 6) r.sixes += 1;
    }

    // ── Bowling ──────────────────────────────────────────────────────
    if (ball.bowlerId) {
      const r = row(ball.bowlerId, String(bowlingTeam));

      if (ball.isLegalDelivery !== false) r.ballsBowled += 1;

      r.runsConceded += ball.teamRuns ?? 0;

      if (ball.isWicket && ball.bowlerCredit !== false) r.wickets += 1;
    }

    // ── Fielding ─────────────────────────────────────────────────────
    if (ball.isWicket && ball.fielderId) {
      row(ball.fielderId, String(bowlingTeam)).catches += 1;
    }
  }

  let best: { playerId: any; line: string; score: number; r: Row } | null =
    null;

  for (const [playerId, r] of rows) {
    let score = r.runs + r.fours + r.sixes * 2;

    if (r.ballsFaced >= 10) {
      const strikeRate = (r.runs / r.ballsFaced) * 100;
      score += (strikeRate - 100) / 5;
    }

    score += r.wickets * 25;

    if (r.ballsBowled >= 6) {
      const economy = (r.runsConceded / r.ballsBowled) * 6;
      score += Math.max(0, 6 - economy) * (r.ballsBowled / 6);
    }

    score += r.catches * 8;

    if (winnerTeam && r.teamId && r.teamId === String(winnerTeam)) {
      score *= 1.25;
    }

    const batLine =
      r.ballsFaced > 0 ? `${r.runs} (${r.ballsFaced})` : "";

    const bowlLine =
      r.ballsBowled > 0
        ? `${r.wickets}/${r.runsConceded} (${Math.floor(r.ballsBowled / 6)}.${
            r.ballsBowled % 6
          })`
        : "";

    const line = [batLine, bowlLine].filter(Boolean).join(" & ");

    const better =
      !best ||
      score > best.score ||
      (score === best.score && r.wickets > best.r.wickets) ||
      (score === best.score &&
        r.wickets === best.r.wickets &&
        r.runs > best.r.runs) ||
      (score === best.score &&
        r.wickets === best.r.wickets &&
        r.runs === best.r.runs &&
        String(playerId) < String(best.playerId));

    if (better) best = { playerId, line, score, r };
  }

  // A player who did nothing measurable is not an award winner.
  if (!best || best.score <= 0 || !best.line) return null;

  return { playerId: best.playerId, line: best.line };
};

export const finalizeMatchFromInnings = async (matchId: string) => {
  const match = await Match.findById(matchId).populate("teamA").populate("teamB");

  if (!match) throw new Error("Match not found.");

  if (match.status === "completed") return match;

  const innings = await Innings.find({ matchId }).sort({ inningsNumber: 1 });

  const first = innings.find((i: any) => i.inningsNumber === 1);
  const second = innings.find((i: any) => i.inningsNumber === 2);

  if (!first || !second) {
    throw new Error("Both innings are required to complete a match.");
  }

  const firstRuns = first.totalRuns || 0;
  const secondRuns = second.totalRuns || 0;

  const battingTeamOf = (inn: any) => String(inn.battingTeam);

  const chasingTeamId = battingTeamOf(second);
  const defendingTeamId = battingTeamOf(first);

  const teamName = (id: string) =>
    String((match.teamA as any)?._id) === String(id)
      ? (match.teamA as any)?.teamName || "Team A"
      : (match.teamB as any)?.teamName || "Team B";

  /*
  | Wickets in hand uses the CHASING side's actual squad, not a hard-coded
  | ten. An eight-a-side match has seven wickets to give.
  */

  const chasingSquad =
    String((match.teamA as any)?._id) === String(chasingTeamId)
      ? match.teamASquad || []
      : match.teamBSquad || [];

  const maxWickets = Math.max(1, (chasingSquad.length || 11) - 1);

  const wicketsInHand = Math.max(0, maxWickets - (second.wickets || 0));

  let winnerTeam: string | null = null;
  let result: string;

  if (secondRuns > firstRuns) {
    winnerTeam = chasingTeamId;
    result = `${teamName(chasingTeamId)} won by ${wicketsInHand} wicket${
      wicketsInHand === 1 ? "" : "s"
    }`;
  } else if (firstRuns > secondRuns) {
    winnerTeam = defendingTeamId;

    const margin = firstRuns - secondRuns;

    result = `${teamName(defendingTeamId)} won by ${margin} run${
      margin === 1 ? "" : "s"
    }`;
  } else {
    // A tie is a real result, and it is recorded like one.
    result = "Match tied";
  }

  const update: any = {
    status: "completed",
    endTime: new Date(),
    result,
  };

  if (winnerTeam) update.winnerTeam = winnerTeam;

  /*
  | The award is decided here, in the same write that decides the result,
  | because it depends on who won - and because a match that finishes
  | without one leaves an empty card on the Live tab forever. Nothing wrote
  | playerOfTheMatch before this; the field and its card both existed and
  | waited on a value that never came.
  */

  const award = await computePlayerOfTheMatch(matchId, winnerTeam);

  if (award) {
    update.playerOfTheMatch = award.playerId;
    update.playerOfTheMatchStats = award.line;
  }

  const completed = await Match.findByIdAndUpdate(matchId, update, {
    new: true,
  });

  // Both innings are closed, so nothing can be scored into a finished match.
  await Innings.updateMany(
    { matchId, isCompleted: { $ne: true } },
    { isCompleted: true, completedAt: new Date() },
  );

  /*
  |--------------------------------------------------------------------------
  | Career Statistics
  |--------------------------------------------------------------------------
  |
  | The one moment a completed match is allowed to move anybody's profile
  | figures. Nothing during the match touches them, which is the whole rule:
  | Player.stats only ever reflects matches that have finished.
  |
  | Recomputed from ball data rather than added to, because this function can
  | run twice on the same match - undoing the ball that ended it reopens the
  | match, and the next ball finalises it again. An incremental update would
  | count that match twice with no way to tell afterwards.
  |
  | Not awaited, and it cannot throw: the result is what matters here, and a
  | statistics write must never be able to stop a match being marked
  | completed. If it fails, the next profile read recomputes anyway.
  */

  void recomputePlayerStatsForMatch(matchId);

  // Played / won / lost / drawn, on the same rule and at the same moment.
  void recomputeTeamStatsForMatch(matchId);

  void notifyFollowersMatchResult(completed, String(match.userId || ""));

  /*
  | Tournament standings, on the same rule and at the same moment.
  |
  | Fire-and-forget for exactly the reason the two calls above are: the
  | RESULT is what matters here, and a points-table write must never be
  | able to stop a match being marked complete. It is a no-op on any match
  | that is not part of a tournament, and it recomputes the whole table
  | rather than adding to it, so running it twice is harmless.
  |
  | It also advances the bracket - a completed semi-final is what fills in
  | the Final's teams.
  */

  void recomputeStandingsForMatch(matchId);

  /*
  | The series equivalent. Same fire-and-forget contract, same no-op on a
  | match that belongs to no series, and same recompute-never-increment
  | reasoning: a scorer undoes balls, a result can flip during a
  | correction, and a drifted scoreline never tells you it has drifted.
  |
  | This is also what flips a series to "completed" once its last match is
  | played, and what records the moment one side went beyond reach.
  */

  void recomputeScorelineForMatch(matchId);

  return completed;
};

/*
|--------------------------------------------------------------------------
| Verify Match PIN
|--------------------------------------------------------------------------
*/

export const verifyMatchPin = async (
  userId: string,
  matchId: string,
  pin: string,
) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new Error("Match not found.");
  }

  const managesTeamA = await canEditTeam(match.teamA, userId);
  const managesTeamB = await canEditTeam(match.teamB, userId);

  if (!managesTeamA && !managesTeamB) {
    throw new Error("You are not authorized to verify this match PIN.");
  }

  const requiredPin = managesTeamA ? match.teamBPin : match.teamAPin;

  if (!requiredPin) {
    return { valid: true };
  }

  return { valid: requiredPin === pin };
};

/*
|--------------------------------------------------------------------------
| Complete Match (Creator-only)
|--------------------------------------------------------------------------
*/

/*
| Finish a match, working the result out from its innings.
|
| Two things changed here.
|
| AUTHORISATION. It required the match OWNER. But scoring can be handed to
| any squad player, and it is that person who is standing there when the
| last ball is bowled - so the one person most likely to need this was the
| one refused. The scorer and either captain are now accepted.
|
| WHAT IT DOES. It used to flip the status and nothing else, leaving
| `result` empty and `winnerTeam` unset. It now goes through
| finalizeMatchFromInnings, so a match completed this way is indistinguish-
| able from one completed automatically on the winning run.
*/

export const completeMatch = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const allowed =
    isMatchScorer(match, userId) ||
    String(match.userId) === String(userId) ||
    (await canEditTeam(match.teamA, userId)) ||
    (await canEditTeam(match.teamB, userId));

  if (!allowed) {
    throw new Error("You are not authorized to complete this match.");
  }

  try {
    return await finalizeMatchFromInnings(matchId);
  } catch {
    /*
    | Both innings are needed to derive a result. Without them - an
    | abandoned match, say - the status still moves, but no result is
    | invented.
    */
    return await Match.findByIdAndUpdate(
      matchId,
      { status: "completed", endTime: new Date() },
      { new: true },
    );
  }
};

/*
|--------------------------------------------------------------------------
| Update Match Result (either captain)
|--------------------------------------------------------------------------
*/

export const updateMatchResult = async (
  userId: string,
  matchId: string,
  winnerTeam: string,
  result: string,
  playerOfTheMatch?: string,
) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const canManage =
    (await canEditTeam(match.teamA, userId)) ||
    (await canEditTeam(match.teamB, userId));

  if (!canManage) {
    throw new Error("You are not authorized to set the result for this match.");
  }

  /*
  | Whether the result was ALREADY recorded, captured before the write.
  |
  | Saving a result is not naturally a once-only action - a captain can
  | correct a typo in the result text, or set the Player of the Match
  | afterwards. Without this check each correction would fan out to every
  | follower again, so followers would be told about the same match two or
  | three times.
  */

  const alreadyCompleted = match.status === "completed" && !!match.winnerTeam;

  const previousPlayerOfTheMatch = match.playerOfTheMatch
    ? String(match.playerOfTheMatch)
    : null;

  const update: Record<string, any> = {
    winnerTeam,
    result,
    status: "completed",
    endTime: new Date(),
  };

  /*
  | Only written when supplied, so an edit that just fixes the result text
  | does not wipe an award that was already recorded.
  */

  if (playerOfTheMatch) {
    update.playerOfTheMatch = playerOfTheMatch;
  }

  const updated = await Match.findByIdAndUpdate(matchId, update, {
    new: true,
  });

  /*
  |--------------------------------------------------------------------------
  | Follower Fan-Out
  |--------------------------------------------------------------------------
  */

  if (!alreadyCompleted) {
    void notifyFollowersMatchResult(updated, userId);
  }

  /*
  | This is the OTHER way a match reaches "completed" - a captain saving the
  | result by hand rather than the second innings ending. Career figures have
  | to move here too, or a match completed this way would never appear in
  | anybody's profile.
  |
  | Also correct on an edit of an already-completed match: recomputing is
  | idempotent, so re-saving a result does not double anything.
  */

  void recomputePlayerStatsForMatch(matchId);

  // Played / won / lost / drawn, on the same rule and at the same moment.
  void recomputeTeamStatsForMatch(matchId);

  /*
  | The award fans out the first time it is set - including when it is
  | added later to a match whose result was already saved, which is why
  | this is checked separately from alreadyCompleted.
  */

  if (playerOfTheMatch && playerOfTheMatch !== previousPlayerOfTheMatch) {
    void notifyFollowersPlayerOfTheMatch(updated, playerOfTheMatch, userId);
  }

  return updated;
};

/*
|--------------------------------------------------------------------------
| Summary / Live / Scorecards
|--------------------------------------------------------------------------
*/

export const getMatchSummary = async (matchId: string) => {
  const innings = await Innings.find({ matchId });

  return innings.map((i) => ({
    inningsNumber: i.inningsNumber,
    runs: i.totalRuns,
    wickets: i.wickets,
    overs: `${Math.floor(i.balls / 6)}.${i.balls % 6}`,
  }));
};

/*
| The live payload used to be four numbers: runs, wickets, overs, run rate.
|
| That is a score, not a live page. It could not say WHICH side was batting,
| which innings it was, who was at the crease, who was bowling, or what the
| chase needed - so the Live tab could only draw two grey stat boxes.
|
| Everything added here is already in the database; it was simply never
| sent. The batter and bowler figures come from that innings' deliveries,
| the same source the scorecard uses, so the two always agree.
*/

export const getLiveMatch = async (matchId: string) => {
  const innings = await Innings.findOne({ matchId, isCompleted: false })
    .populate("currentStrikerId", "playerName")
    .populate("currentNonStrikerId", "playerName")
    .populate("currentBowlerId", "playerName");

  if (!innings) {
    throw new Error("No active innings found");
  }

  const balls = await Scoring.find({ inningsId: innings._id });

  const battingFigures = (playerId: any) => {
    if (!playerId) return { runs: 0, balls: 0 };

    const id = String(playerId);

    const faced = balls.filter((b: any) => String(b.batsmanId) === id);

    return {
      /*
      | Byes, leg byes and wides are the team's, not the batter's - counting
      | them here would inflate a not-out score against the scorecard's.
      | batsmanRuns already encodes that rule; the fallback applies it to
      | balls recorded before the field existed.
      */
      runs: faced.reduce(
        (sum: number, b: any) =>
          sum +
          (b.batsmanRuns ??
            (b.extraType === "bye" ||
            b.extraType === "legBye" ||
            b.extraType === "wide"
              ? 0
              : b.runs || 0)),
        0,
      ),

      // A wide is not a ball faced.
      balls: faced.filter((b: any) => b.extraType !== "wide").length,
    };
  };

  const bowlingFigures = (playerId: any) => {
    if (!playerId) return { overs: "0.0", runs: 0, wickets: 0 };

    const id = String(playerId);

    const bowled = balls.filter((b: any) => String(b.bowlerId) === id);

    const legal = bowled.filter((b: any) => b.isLegalDelivery !== false).length;

    return {
      overs: `${Math.floor(legal / 6)}.${legal % 6}`,
      runs: bowled.reduce(
        (sum: number, b: any) => sum + (b.teamRuns ?? b.runs ?? 0),
        0,
      ),
      // Run-outs are not the bowler's wicket.
      wickets: bowled.filter(
        (b: any) => b.isWicket && b.bowlerCredit !== false,
      ).length,
    };
  };

  const withFigures = (player: any, figures: any) =>
    player?._id
      ? { _id: player._id, playerName: player.playerName, ...figures }
      : null;

  /*
  | The target only exists in a second innings, and only once the first is
  | on record - so it is looked up rather than assumed.
  */

  let target: number | undefined;

  if (innings.inningsNumber === 2) {
    const first = await Innings.findOne({ matchId, inningsNumber: 1 });

    if (first) target = first.totalRuns + 1;
  }

  const striker: any = innings.currentStrikerId;
  const nonStriker: any = innings.currentNonStrikerId;
  const bowler: any = innings.currentBowlerId;

  return {
    inningsId: innings._id,
    inningsNumber: innings.inningsNumber,

    battingTeamId: innings.battingTeam,
    bowlingTeamId: innings.bowlingTeam,

    runs: innings.totalRuns,
    wickets: innings.wickets,
    balls: innings.balls,
    overs: `${Math.floor(innings.balls / 6)}.${innings.balls % 6}`,
    runRate:
      innings.balls > 0
        ? (innings.totalRuns / (innings.balls / 6)).toFixed(2)
        : "0",

    target,

    currentStriker: withFigures(striker, battingFigures(striker?._id)),
    currentNonStriker: withFigures(
      nonStriker,
      battingFigures(nonStriker?._id),
    ),
    currentBowler: withFigures(bowler, bowlingFigures(bowler?._id)),
  };
};

export const getBowlingScorecard = async (matchId: string) => {
  const balls = await Scoring.find({ matchId }).populate("bowlerId");

  const scorecard: any = {};

  balls.forEach((ball) => {
    if (!ball.bowlerId) return;

    const id = ball.bowlerId._id.toString();

    if (!scorecard[id]) {
      scorecard[id] = {
        player: ball.bowlerId,
        wickets: 0,
        runsConceded: 0,
        balls: 0,
      };
    }

    scorecard[id].balls++;
    scorecard[id].runsConceded += ball.runs;

    if (ball.isWicket) scorecard[id].wickets++;
  });

  return Object.values(scorecard);
};

export const getFallOfWickets = async (matchId: string) => {
  const wickets = await Scoring.find({ matchId, isWicket: true })
    .populate("dismissedPlayerId", "playerName")
    .sort({ createdAt: 1 });

  return wickets.map((wicket, index) => ({
    wicketNumber: index + 1,
    player: wicket.dismissedPlayerId,
    over: wicket.over,
    ball: wicket.ball,
    wicketType: wicket.wicketType,
  }));
};

export const getBattingScorecard = async (matchId: string) => {
  const balls = await Scoring.find({ matchId }).populate("batsmanId", "playerName");

  const scorecard: any = {};

  balls.forEach((ball: any) => {
    if (!ball.batsmanId) return;

    const playerId = ball.batsmanId._id.toString();

    if (!scorecard[playerId]) {
      scorecard[playerId] = {
        playerId,
        playerName: ball.batsmanId.playerName,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
      };
    }

    scorecard[playerId].runs += ball.runs;
    scorecard[playerId].balls += 1;

    if (ball.runs === 4) scorecard[playerId].fours += 1;
    if (ball.runs === 6) scorecard[playerId].sixes += 1;
  });

  return Object.values(scorecard).map((player: any) => ({
    ...player,
    strikeRate:
      player.balls > 0 ? ((player.runs / player.balls) * 100).toFixed(2) : "0.00",
  }));
};

export const getFullScorecard = async (matchId: string) => {
  const summary = await getMatchSummary(matchId);
  const batting = await getBattingScorecard(matchId);
  const bowling = await getBowlingScorecard(matchId);
  const fow = await getFallOfWickets(matchId);

  return { summary, batting, bowling, fow };
};

/*
|--------------------------------------------------------------------------
| Over-by-Over
|--------------------------------------------------------------------------
*/

export const getOverByOver = async (matchId: string) => {
  const balls = await Scoring.find({ matchId })
    .populate("batsmanId", "playerName")
    .populate("bowlerId", "playerName")
    .populate("fielderId", "playerName")
    .sort({ over: 1, ball: 1, createdAt: 1 });

  /*
  | The innings number lives on Innings, NOT on a ball.
  |
  | This function used to read `ball.inningsNumber`, which is always
  | undefined - so every over fell back to innings 1 and the second
  | innings' over 3 was merged into the first innings' over 3, silently
  | doubling its runs and its ball list.
  |
  | One lookup keyed by inningsId puts each ball in the right innings.
  */

  const inningsList = await Innings.find({ matchId })
    .select("_id inningsNumber battingTeam")
    .populate("battingTeam", "teamName teamLogo");

  const inningsById = new Map(
    inningsList.map((i: any) => [String(i._id), i]),
  );

  const oversMap: any = {};

  balls.forEach((ball: any) => {
    const innings = inningsById.get(String(ball.inningsId));

    const inningsNumber = innings?.inningsNumber || 1;

    const key = `${inningsNumber}-${ball.over}`;

    if (!oversMap[key]) {
      oversMap[key] = {
        inningsNumber,
        battingTeamName: innings?.battingTeam?.teamName || null,
        over: ball.over,
        bowler: null,
        balls: [],
        runs: 0,
        wickets: 0,
      };
    }

    // The bowler is the same for the whole over - named once, on the over.
    if (!oversMap[key].bowler && ball.bowlerId?.playerName) {
      oversMap[key].bowler = ball.bowlerId.playerName;
    }

    const runs = ball.teamRuns ?? ball.runs ?? 0;

    /*
    | This used to return six fields: ball, runs, isWicket, extraType and
    | the two names. Everything the commentary is made of - the shot, the
    | direction, the dismissal, the stored line - was dropped here, which
    | is why the match's Live tab rendered a badge with an empty sentence
    | beside it while the scoring pad showed the full text.
    |
    | The client rebuilds the sentence from these fields rather than
    | printing commentaryText, so a ball recorded before the shot fields
    | existed still reads with the right names.
    */

    oversMap[key].balls.push({
      _id: ball._id,
      over: ball.over,
      ball: ball.ball,
      runs,
      batRuns: ball.runs ?? 0,
      isWicket: !!ball.isWicket,
      wicketType: ball.wicketType || null,
      extraType: ball.extraType || null,
      isLegalDelivery: ball.isLegalDelivery !== false,
      batsman: ball.batsmanId?.playerName || null,
      bowler: ball.bowlerId?.playerName || null,
      fielder: ball.fielderId?.playerName || null,
      shotType: ball.shotType || "",
      wagonWheel: {
        angle: ball.wagonWheel?.angle ?? null,
        distance: ball.wagonWheel?.distance ?? null,
        region: ball.wagonWheel?.region || "",
      },
      commentaryText: ball.commentaryText || "",
      createdAt: ball.createdAt,
    });

    oversMap[key].runs += runs;
    if (ball.isWicket) oversMap[key].wickets += 1;
  });

  return Object.values(oversMap).sort(
    (a: any, b: any) => a.inningsNumber - b.inningsNumber || a.over - b.over,
  );
};

/*
|--------------------------------------------------------------------------
| Match Feed - Live / Upcoming / Recent
|--------------------------------------------------------------------------
*/

const getManagedTeamIds = async (userId: string): Promise<string[]> => {
  const player = await Player.findOne({ userId });

  const query: any[] = [{ userId }];

  if (player) {
    query.push({ players: player._id });
  }

  const teams = await Team.find({ $or: query }).select("_id");

  return teams.map((team) => String(team._id));
};

const attachCurrentInnings = async (matches: any[], viewerId?: string) => {
  if (matches.length === 0) {
    return [];
  }

  const matchIds = matches.map((match) => match._id);

  const allInnings = await Innings.find({
    matchId: { $in: matchIds },
  });

  const inningsByMatchId = new Map<string, any[]>();
  allInnings.forEach((innings) => {
    const key = String(innings.matchId);
    if (!inningsByMatchId.has(key)) inningsByMatchId.set(key, []);
    inningsByMatchId.get(key)!.push(innings);
  });

  return matches.map((match) => {
    const inns = inningsByMatchId.get(String(match._id)) || [];
    const active = inns.find((i) => !i.isCompleted);
    const first = inns.find((i) => i.inningsNumber === 1);
    const second = inns.find((i) => i.inningsNumber === 2);

    /*
    | THE INNINGS BREAK.
    |
    | currentInnings is "the innings that is not finished", which between
    | innings is nothing at all. So the moment the first innings ended, every
    | card that could open the scoring screen passed inningsId: undefined -
    | and a scorer who closed the app at the break had no route back to it
    | from anywhere in the app. The match simply could not proceed.
    |
    | Saying so explicitly lets the client send them to the innings break
    | instead of to a scoring pad that cannot record anything.
    */

    const awaitingSecondInnings =
      match.status === "live" && !active && !!first && !second;

    const target =
      active && active.inningsNumber === 2 && first
        ? first.totalRuns + 1
        : undefined;

    let battingSquad: any[] = [];
    let bowlingSquad: any[] = [];
    if (active) {
      const battingTeamId = String(active.battingTeam);
      const isTeamABatting = String(match.teamA?._id) === battingTeamId;
      battingSquad = isTeamABatting ? match.teamASquad || [] : match.teamBSquad || [];
      bowlingSquad = isTeamABatting ? match.teamBSquad || [] : match.teamASquad || [];
    }

    // Raw PINs never leave the server - see getMatchById.
    const { teamAPin: _a, teamBPin: _b, ...plain } = match.toObject() as any;

    return {
      ...plain,

      // Same flag the details screen gets - see isMatchScorer.
      isScorer: isMatchScorer(match, viewerId),

      awaitingSecondInnings,

      /*
      | The finished first innings, so the client can reopen the break with
      | its squads and the target already known.
      */
      completedInnings: awaitingSecondInnings && first
        ? {
            inningsId: first._id,
            inningsNumber: 1,
            runs: first.totalRuns,
            wickets: first.wickets,
            battingTeamId: first.battingTeam,
            bowlingTeamId: first.bowlingTeam,
            target: (first.totalRuns || 0) + 1,
          }
        : null,

      /*
      |--------------------------------------------------------------------
      | The First Innings - Always, Not Only During The Break
      |--------------------------------------------------------------------
      |
      | `completedInnings` above is deliberately null once the chase begins:
      | it exists to route a scorer INTO the innings break, and a break that
      | is over is not a destination.
      |
      | But the first innings' score is still the most important number on a
      | second-innings card. Without it the live card read:
      |
      |     National Capital Region     (nothing at all)
      |     Ajay choudhary Team         15/0   1.0 ov
      |     Needs 342 more to win
      |
      | The side being chased had no score against its name, so the card
      | showed a target with nothing to explain where it came from - and the
      | team that had just batted looked like it had not batted at all.
      |
      | This is a separate field rather than a widened `completedInnings`
      | precisely so that routing meaning stays untouched: LiveScoringScreen
      | reads `awaitingSecondInnings && completedInnings` to decide whether
      | to send the scorer to the innings break, and must keep getting null
      | once the chase is under way.
      |
      | `isCompleted` travels with it because a first innings that is still
      | being bowled is the live one - the client shows it as the current
      | score, not as a finished total.
      */

      firstInnings: first
        ? {
            inningsId: first._id,
            inningsNumber: 1,
            runs: first.totalRuns,
            wickets: first.wickets,
            overs: `${Math.floor(first.balls / 6)}.${first.balls % 6}`,
            battingTeamId: first.battingTeam,
            bowlingTeamId: first.bowlingTeam,
            isCompleted: !!first.isCompleted,
          }
        : null,

      /*
      |--------------------------------------------------------------------
      | Every Innings, For A Finished Match
      |--------------------------------------------------------------------
      |
      | A recent-result card showed two team names, a tick beside the
      | winner and a line of prose - "Nav Chetna society won by 6 wickets" -
      | and no scores at all. The one thing a cricket follower looks for on
      | a finished match, the two totals, was the one thing missing.
      |
      | firstInnings above answers a different question (what is being
      | chased, right now). This answers "how did the game go", so it
      | carries both sides in innings order and does not care which is
      | live.
      */

      inningsSummaries: inns
        .slice()
        .sort((a: any, b: any) => a.inningsNumber - b.inningsNumber)
        .map((i: any) => ({
          inningsId: i._id,
          inningsNumber: i.inningsNumber,
          runs: i.totalRuns,
          wickets: i.wickets,
          overs: `${Math.floor(i.balls / 6)}.${i.balls % 6}`,
          battingTeamId: i.battingTeam,
          bowlingTeamId: i.bowlingTeam,
          isCompleted: !!i.isCompleted,
        })),

      currentInnings: active
        ? {
            inningsId: active._id,
            inningsNumber: active.inningsNumber,
            runs: active.totalRuns,
            wickets: active.wickets,
            overs: `${Math.floor(active.balls / 6)}.${active.balls % 6}`,
            runRate:
              active.balls > 0
                ? (active.totalRuns / (active.balls / 6)).toFixed(2)
                : "0",

            /*
            | Which side the score belongs to. The payload carried the
            | batting SQUAD but not the batting TEAM, so a client showing a
            | live card had no way to put "58/1" against the team actually
            | batting - it could only show the score floating between the
            | two names.
            */
            battingTeamId: active.battingTeam,

            bowlingTeamId: active.bowlingTeam,

            battingSquad,
            bowlingSquad,
            target,
          }
        : null,
    };
  });
};

export const getLiveMatches = async (userId: string) => {
  const teamIds = await getManagedTeamIds(userId);

  /*
  |--------------------------------------------------------------------------
  | The scorer is not always in one of the teams
  |--------------------------------------------------------------------------
  |
  | This asked one question - "is a team I manage playing?" - and a TOURNAMENT
  | OR SERIES ORGANIZER is the answer's blind spot. They run the fixture and
  | captain neither side, so their own live matches came back empty:
  |
  |   nothing on Home under Live
  |   nothing to resume from after leaving the scoring pad
  |
  | ...which is how a scorer ended up with a match live on the ground and no
  | route back to it anywhere in the app.
  |
  | The three added clauses are the same identities isMatchScorer already
  | recognises, so a match this person can score is a match they can find.
  */

  const matches = await Match.find({
    status: "live",
    $or: [
      { teamA: { $in: teamIds } },
      { teamB: { $in: teamIds } },
      { scorerUserId: userId },
      { userId },
      { inviteSenderUserId: userId },
    ],
  })
    .populate("teamA")
    .populate("teamB")
    .populate("teamASquad", "playerName playerType")
    .populate("teamBSquad", "playerName playerType")
    .sort({ startTime: -1 });

  // viewerId, so each live card knows whether THIS user is its scorer.
  return await attachCurrentInnings(matches, userId);
};

export const getUpcomingMatches = async (userId: string) => {
  const teamIds = await getManagedTeamIds(userId);

  const matches = await Match.find({
    status: "upcoming",
    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  })
    .populate("teamA")
    .populate("teamB")
    .sort({ scheduledStartTime: 1, createdAt: 1 });

  const result: any[] = [];

  for (const match of matches) {
    const managesTeamA = await canEditTeam(match.teamA, userId);
    const managesTeamB = await canEditTeam(match.teamB, userId);
    const canManage = managesTeamA || managesTeamB;

    const isInviteSender = !!(
      match.inviteSenderUserId &&
      String(match.inviteSenderUserId) === String(userId)
    );

    // Raw PINs never leave the server - see getMatchById.
    const obj = match.toObject() as any;
    const { teamAPin: _a, teamBPin: _b, ...plain } = obj;

    result.push({
      ...plain,
      canManage,
      isInviteSender,
      isScorer: isMatchScorer(match, userId),
      // Same rule as getMatchById: a PIN is only shown before the start.
      matchPin:
        canManage && obj.status === "upcoming"
          ? managesTeamA
            ? obj.teamAPin
            : obj.teamBPin
          : undefined,
    });
  }

  return result;
};

export const getRecentMatches = async (userId: string, limit: number) => {
  const teamIds = await getManagedTeamIds(userId);

  const cappedLimit = Math.min(Math.max(limit || 20, 1), 50);

  const matches = await Match.find({
    status: "completed",
    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  })
    .populate("teamA")
    .populate("teamB")
    .populate("winnerTeam")
    // So a recent card can name the award winner without a second request.
    .populate("playerOfTheMatch", "playerName profileImage playerType")
    .sort({ endTime: -1 })
    .limit(cappedLimit);

  /*
  | Routed through attachCurrentInnings, which the live and upcoming feeds
  | already use. It is what puts `inningsSummaries` on the payload, and it
  | is why a recent card can now print both totals instead of two bare team
  | names and a sentence.
  */

  return await attachCurrentInnings(matches, userId);
};

/*
|--------------------------------------------------------------------------
| Scorecard By Innings
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Full Scorecard, Per Innings
|--------------------------------------------------------------------------
|
| Extended to carry everything a printed scorecard shows, because the
| previous payload had only names and totals - no dismissals, no extras
| breakdown, no fall of wickets, no maidens - so the client could render a
| list of numbers but not an actual scorecard.
|
| Every added figure is derived from the same single pass over the balls
| that was already happening; nothing here costs an extra query.
|
*/

export const getScorecardByInnings = async (matchId: string) => {
  const match = await Match.findById(matchId)
    .populate("teamA", "teamName shortName")
    .populate("teamB", "teamName shortName")
    .populate("teamASquad", "playerName")
    .populate("teamBSquad", "playerName");

  const inningsList = await Innings.find({ matchId }).sort({ inningsNumber: 1 });

  const results = [];

  for (const innings of inningsList) {
    const balls = await Scoring.find({ inningsId: innings._id })
      .populate("batsmanId", "playerName")
      .populate("bowlerId", "playerName")
      .populate("dismissedPlayerId", "playerName")
      .populate("fielderId", "playerName")
      .sort({ over: 1, ball: 1, createdAt: 1 });

    const battingMap: any = {};
    const bowlingMap: any = {};

    /*
    | Extras are split by type because a scorecard states them separately -
    | "b 0, lb 0, w 3, nb 0" - and because only some of them count against
    | the bowler.
    */
    const extras = { byes: 0, legByes: 0, wides: 0, noBalls: 0, total: 0 };

    const fallOfWickets: any[] = [];

    // Per (bowler, over) run totals, to count maidens after the pass.
    const overRuns: Record<string, { runs: number; legal: number }> = {};

    let runningRuns = 0;

    let runningWickets = 0;

    balls.forEach((ball: any) => {
      const ballTeamRuns = ball.teamRuns ?? ball.runs ?? 0;

      runningRuns += ballTeamRuns;

      if (ball.extraType === "bye") extras.byes += ball.runs || 0;
      if (ball.extraType === "legBye") extras.legByes += ball.runs || 0;
      if (ball.extraType === "wide") extras.wides += (ball.runs || 0) + 1;
      if (ball.extraType === "noBall") extras.noBalls += 1;

      if (ball.bowlerId) {
        const key = `${ball.bowlerId._id}-${ball.over}`;

        if (!overRuns[key]) {
          overRuns[key] = { runs: 0, legal: 0 };
        }

        overRuns[key].runs += ballTeamRuns;

        if (ball.isLegalDelivery !== false) {
          overRuns[key].legal += 1;
        }
      }

      if (ball.isWicket) {
        runningWickets += 1;

        fallOfWickets.push({
          wicket: runningWickets,
          playerName:
            ball.dismissedPlayerId?.playerName ||
            ball.batsmanId?.playerName ||
            "Unknown",
          score: `${runningRuns}-${runningWickets}`,
          over: `${ball.over}.${ball.ball}`,
        });
      }

      if (ball.batsmanId) {
        const id = ball.batsmanId._id.toString();

        if (!battingMap[id]) {
          battingMap[id] = {
            playerId: id,
            playerName: ball.batsmanId.playerName,
            runs: 0,
            balls: 0,
            fours: 0,
            sixes: 0,
            dismissal: "not out",
            isOut: false,
          };
        }

        /*
        | batsmanRuns is what the batter actually scored - the server works
        | it out when the ball is recorded.
        |
        | This used to add `ball.runs` while excluding only byes and leg
        | byes, so runs RUN off a wide were credited to the batter as though
        | he had hit them: the innings total said 3 and the batting card plus
        | extras said 5.
        |
        | The fallback keeps balls recorded before batsmanRuns existed
        | reading correctly - by applying the same rule they were missing.
        */

        const notBatterRuns =
          ball.extraType === "bye" ||
          ball.extraType === "legBye" ||
          ball.extraType === "wide";

        const batterRuns =
          ball.batsmanRuns ?? (notBatterRuns ? 0 : ball.runs || 0);

        battingMap[id].runs += batterRuns;

        // Only a boundary off the bat is a four or a six on the card.
        if (batterRuns === 4) battingMap[id].fours += 1;
        if (batterRuns === 6) battingMap[id].sixes += 1;

        if (ball.extraType !== "wide") {
          battingMap[id].balls += 1;
        }
      }

      /*
      | The dismissal is attached to the batsman who was OUT, which is not
      | always the striker - on a run out it can be the non-striker. That is
      | why dismissedPlayerId exists and why it is preferred here.
      */
      if (ball.isWicket) {
        const outId = String(
          ball.dismissedPlayerId?._id || ball.batsmanId?._id || "",
        );

        if (outId && battingMap[outId]) {
          const type = (ball.wicketType || "").toLowerCase();

          const fielder = ball.fielderId?.playerName;

          const bowler = ball.bowlerId?.playerName;

          let text = ball.wicketType || "out";

          if (type.includes("caught") && fielder && bowler) {
            text = `c ${fielder} b ${bowler}`;
          } else if (type.includes("bowled") && bowler) {
            text = `b ${bowler}`;
          } else if (type.includes("lbw") && bowler) {
            text = `lbw b ${bowler}`;
          } else if (type.includes("stump") && fielder && bowler) {
            text = `st ${fielder} b ${bowler}`;
          } else if (type.includes("run") && fielder) {
            text = `run out (${fielder})`;
          }

          battingMap[outId].dismissal = text;

          battingMap[outId].isOut = true;
        }
      }

      if (ball.bowlerId) {
        const id = ball.bowlerId._id.toString();

        if (!bowlingMap[id]) {
          bowlingMap[id] = {
            playerId: id,
            playerName: ball.bowlerId.playerName,
            legalBalls: 0,
            runsConceded: 0,
            wickets: 0,
          };
        }

        if (ball.isLegalDelivery !== false) {
          bowlingMap[id].legalBalls += 1;
        }

        bowlingMap[id].runsConceded += ball.teamRuns ?? ball.runs;

        /*
        | A run out is not the bowler's wicket. Counting raw isWicket here
        | credited it to whoever happened to be bowling.
        */
        if (ball.isWicket && ball.bowlerCredit !== false) {
          bowlingMap[id].wickets += 1;
        }
      }
    });

    const batting = Object.values(battingMap).map((p: any) => ({
      ...p,
      strikeRate: p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(2) : "0.00",
    }));

    const bowling = Object.values(bowlingMap).map((p: any) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      overs: `${Math.floor(p.legalBalls / 6)}.${p.legalBalls % 6}`,
      runsConceded: p.runsConceded,
      wickets: p.wickets,
      economy:
        p.legalBalls > 0
          ? (p.runsConceded / (p.legalBalls / 6)).toFixed(2)
          : "0.00",
    }));

    extras.total =
      extras.byes + extras.legByes + extras.wides + extras.noBalls;

    /*
    | A maiden is a completed over (six legal deliveries) that conceded
    | nothing. Partial overs at the end of an innings are not maidens.
    */
    const maidensByBowler: Record<string, number> = {};

    Object.entries(overRuns).forEach(([key, value]) => {
      if (value.runs === 0 && value.legal === 6) {
        const bowlerId = key.split("-")[0];

        maidensByBowler[bowlerId] = (maidensByBowler[bowlerId] || 0) + 1;
      }
    });

    const bowlingWithMaidens = bowling.map((b: any) => ({
      ...b,
      maidens: maidensByBowler[b.playerId] || 0,
    }));

    /*
    | Team names, so the client does not have to resolve two ObjectIds
    | against the match it may not have loaded.
    */
    const teamA: any = match?.teamA;

    const teamB: any = match?.teamB;

    const isTeamABatting =
      String(innings.battingTeam) === String(teamA?._id);

    const battingTeamName = isTeamABatting ? teamA?.teamName : teamB?.teamName;

    const bowlingTeamName = isTeamABatting ? teamB?.teamName : teamA?.teamName;

    /*
    | Anyone in the batting squad who never faced a ball. Only meaningful
    | when a squad was actually picked.
    */
    const battingSquad: any[] = isTeamABatting
      ? (match?.teamASquad as any[]) || []
      : (match?.teamBSquad as any[]) || [];

    const battedIds = new Set(Object.keys(battingMap));

    const didNotBat = battingSquad
      .filter((p: any) => !battedIds.has(String(p._id)))
      .map((p: any) => p.playerName);

    results.push({
      inningsId: innings._id,
      inningsNumber: innings.inningsNumber,
      battingTeam: innings.battingTeam,
      bowlingTeam: innings.bowlingTeam,
      battingTeamName: battingTeamName || "",
      bowlingTeamName: bowlingTeamName || "",
      totalRuns: innings.totalRuns,
      wickets: innings.wickets,
      overs: `${Math.floor(innings.balls / 6)}.${innings.balls % 6}`,
      runRate:
        innings.balls > 0
          ? (innings.totalRuns / (innings.balls / 6)).toFixed(2)
          : "0.00",
      isCompleted: innings.isCompleted,
      batting,
      bowling: bowlingWithMaidens,
      extras,
      fallOfWickets,
      didNotBat,
    });
  }

  return results;
};

/*
|--------------------------------------------------------------------------
| Partnerships
|--------------------------------------------------------------------------
*/

export const getPartnerships = async (matchId: string) => {
  const inningsList = await Innings.find({ matchId }).sort({ inningsNumber: 1 });

  const results = [];

  for (const innings of inningsList) {
    const balls = await Scoring.find({ inningsId: innings._id })
      .populate("strikerIdBefore", "playerName")
      .populate("nonStrikerIdBefore", "playerName")
      .sort({ createdAt: 1 });

    const partnerships: any[] = [];
    let current: any = null;

    balls.forEach((ball: any) => {
      const striker = ball.strikerIdBefore;
      const nonStriker = ball.nonStrikerIdBefore;

      if (!striker || !nonStriker) return;

      const pairKey = [String(striker._id), String(nonStriker._id)]
        .sort()
        .join("-");

      if (!current || current.pairKey !== pairKey) {
        current = {
          pairKey,
          batsmen: [
            { playerId: String(striker._id), playerName: striker.playerName },
            { playerId: String(nonStriker._id), playerName: nonStriker.playerName },
          ],
          runs: 0,
          balls: 0,
        };

        partnerships.push(current);
      }

      current.runs += ball.teamRuns || 0;

      if (ball.isLegalDelivery !== false) {
        current.balls += 1;
      }
    });

    results.push({
      inningsId: innings._id,
      inningsNumber: innings.inningsNumber,
      partnerships: partnerships.map(({ pairKey, ...rest }) => rest),
    });
  }

  return results;
};

/*
|--------------------------------------------------------------------------
| Match Confirmation Gate
|--------------------------------------------------------------------------
*/

export const requestMatchConfirmation = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  if (String(match.userId) !== String(userId)) {
    throw new Error("Only the match creator can request confirmation.");
  }

  const teamA = match.teamA as any;
  const teamB = match.teamB as any;

  const [ownsTeamA, ownsTeamB] = await Promise.all([
    canManageTeam(teamA, userId),
    canManageTeam(teamB, userId),
  ]);

  if ((ownsTeamA && ownsTeamB) || match.confirmationStatus === "confirmed") {
    return match;
  }

  if (!ownsTeamA && !ownsTeamB) {
    throw new Error(
      "You must manage at least one of the two teams to request confirmation.",
    );
  }

  const otherTeam = ownsTeamA ? teamB : teamA;
  const ownedTeam = ownsTeamA ? teamA : teamB;

  match.confirmationStatus = "pending" as any;
  match.confirmationRequiredFrom = otherTeam._id;

  await match.save();

  try {
    await sendMatchConfirmationRequiredNotification({
      receiverId: otherTeam.userId.toString(),
      actorId: userId,
      matchId: match._id.toString(),
      teamId: otherTeam._id.toString(),
      creatorTeamName: ownedTeam.teamName,
    });

    const ownPin = ownsTeamA ? match.teamAPin : match.teamBPin;
    if (ownPin) {
      await sendMatchPinSharedNotification({
        receiverId: otherTeam.userId.toString(),
        actorId: userId,
        matchId: match._id.toString(),
        teamId: otherTeam._id.toString(),
        pin: ownPin,
        creatorTeamName: ownedTeam.teamName,
      });
    }
  } catch (notificationError) {
    console.error(
      "Failed to send match-confirmation-required notification:",
      notificationError,
    );
  }

  return match;
};

const resolveConfirmingTeam = async (match: any, userId: string) => {
  if (
    match.confirmationStatus !== "pending" ||
    !match.confirmationRequiredFrom
  ) {
    throw new Error("This match is not awaiting confirmation.");
  }

  const team = await Team.findById(match.confirmationRequiredFrom);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertCanEditTeam(team, userId);

  return team;
};

export const confirmMatchRequest = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new Error("Match not found.");
  }

  const confirmingTeam = await resolveConfirmingTeam(match, userId);

  match.confirmationStatus = "confirmed" as any;
  await match.save();

  try {
    await sendMatchConfirmedNotification({
      receiverId: match.userId.toString(),
      actorId: userId,
      matchId: match._id.toString(),
      confirmingTeamName: confirmingTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-confirmed notification:",
      notificationError,
    );
  }

  return match;
};

export const rejectMatchConfirmation = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new Error("Match not found.");
  }

  const rejectingTeam = await resolveConfirmingTeam(match, userId);

  match.confirmationStatus = "rejected" as any;
  match.status = "cancelled" as any;

  await match.save();

  await Innings.deleteMany({ matchId: match._id });

  try {
    await sendMatchConfirmationRejectedNotification({
      receiverId: match.userId.toString(),
      actorId: userId,
      matchId: match._id.toString(),
      rejectingTeamName: rejectingTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-confirmation-rejected notification:",
      notificationError,
    );
  }

  return match;
};

/*
|--------------------------------------------------------------------------
| Transfer Scoring
|--------------------------------------------------------------------------
*/

export const transferScoring = async (
  userId: string,
  matchId: string,
  targetUserId: string,
) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) throw new Error("Match not found.");
  if (match.status !== "live")
    throw new Error("Only a live match can be transferred.");

  const senderId = match.inviteSenderUserId || match.userId;
  const isInviteSender = senderId && String(senderId) === String(userId);
  const isCurrentScorer =
    match.scorerUserId && String(match.scorerUserId) === String(userId);

  if (!isInviteSender && !isCurrentScorer) {
    throw new Error(
      "Only the captain who sent the match invite can transfer scoring.",
    );
  }

  const target = await Player.findOne({ userId: targetUserId });
  if (!target) throw new Error("Target scorer not found.");

  /*
  |--------------------------------------------------------------------------
  | Both Teams Must Exist
  |--------------------------------------------------------------------------
  |
  | teamA/teamB are only required once a match leaves `draft` - a match
  | created by "Go Live" before any details were entered legitimately has
  | neither. The live-status check above already rules that out in
  | practice, but reading ._id off them without saying so is a crash
  | waiting on the one code path that reaches here with a half-filled
  | match.
  |
  | Stated explicitly so the failure is a sentence the captain can act on
  | rather than "Cannot read properties of null".
  |
  */

  if (!match.teamA || !match.teamB) {
    throw new Error(
      "Both teams must be set on this match before scoring can be transferred.",
    );
  }

  const teamAId = String(match.teamA._id);
  const teamBId = String(match.teamB._id);
  const inA = (target.teams || []).some((t: any) => String(t) === teamAId);
  const inB = (target.teams || []).some((t: any) => String(t) === teamBId);

  if (!inA && !inB) {
    throw new Error("Scorer must be a member of one of the two teams.");
  }

  match.scorerUserId = new mongoose.Types.ObjectId(targetUserId);
  match.scorerTeamId = inA ? match.teamA._id : match.teamB._id;
  match.scorerName = target.playerName;
  await match.save();

  getIO().emit("scoring:transferred", { matchId, scorerUserId: targetUserId });

  return match;
};