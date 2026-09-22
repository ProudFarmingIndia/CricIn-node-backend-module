/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| tournament.service.ts
|
| Description:
| Everything the organizer, the captains and the viewers do to a
| tournament.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import Tournament from "./tournament.model";
import TournamentTeam from "./tournamentTeam.model";
import Match from "../matches/match.model";
import Team from "../teams/team.model";
import Player from "../players/player.model";

import { createNotification } from "../notifications/notification.service";
import { NOTIFICATION_TYPES } from "../notifications/notification.types";

import { generateFixtures } from "./fixtures.service";
import { recomputeStandings, getStandings } from "./standings.service";
import { resolveAwards, buildLeaderboards } from "./awards.service";

import {
  awardMetric,
  SQUAD_MIN,
  SQUAD_MAX,
  playoffShape,
} from "./tournament.constants";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

/*
|--------------------------------------------------------------------------
| Who may create a tournament
|--------------------------------------------------------------------------
|
| Right now: anybody. Later: only subscribers.
|
| This function exists TODAY, returning true, precisely so that switching
| it on later is a change to one function instead of a hunt through the
| codebase for every place a tournament can be created. The call sites are
| already in place and already handle the refusal.
|
*/

export const canCreateTournament = async (
  _userId: string,
): Promise<{ allowed: boolean; reason?: string }> => {
  /*
  | When subscriptions land, this becomes:
  |
  |   const user = await User.findById(_userId).select("plan planExpiresAt");
  |   const active = user?.plan === "organizer" && user.planExpiresAt > new Date();
  |   return active ? { allowed: true } : { allowed: false, reason: "..." };
  */

  return { allowed: true };
};

/*
|--------------------------------------------------------------------------
| Only the organizer
|--------------------------------------------------------------------------
|
| One person, named on the tournament. Same rule as the live-stream owner:
| a control panel that two people can both operate is a control panel
| where each of them can undo the other mid-match.
|
*/

const assertOrganizer = async (tournamentId: string, userId: string) => {
  const tournament: any = await Tournament.findById(tournamentId);

  if (!tournament) {
    throw new AppError("Tournament not found.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(tournament.userId) !== String(userId)) {
    throw new AppError(
      "Sirf tournament ka organizer hi ye kar sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  return tournament;
};

const sumAmounts = (rows: any[]) =>
  (rows || []).reduce((total, p) => total + Number(p?.amount || 0), 0);

/*
| The pool is position prizes PLUS player awards. Somebody reading
| "₹25,000 prize pool" is being told what is on the table, and ₹5,000 of
| it being for Most Wickets does not make it less on the table.
*/

const poolOf = (prizes: any[], awards: any[]) =>
  sumAmounts(prizes) + sumAmounts(awards);

/*
| Two awards on the same metric is always a mistake - two rows fighting
| over one winner - so it is rejected rather than quietly deduplicated,
| which would drop an amount the organizer typed. `custom` is exempt:
| having three custom awards is the entire reason it exists.
*/

const assertAwardsValid = (awards: any[]) => {
  if (!awards?.length) return;

  const seen = new Set<string>();

  for (const a of awards) {
    if (!a?.metric) {
      throw new AppError("Har award ka type chunna zaroori hai.", HTTP_STATUS.BAD_REQUEST);
    }

    if (!awardMetric(a.metric)) {
      throw new AppError(`"${a.metric}" jaisa koi award nahi hai.`, HTTP_STATUS.BAD_REQUEST);
    }

    if (a.metric === "custom") continue;

    if (seen.has(a.metric)) {
      throw new AppError(
        `"${a.label || a.metric}" do baar add ho gaya hai.`,
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    seen.add(a.metric);
  }
};

/*
|--------------------------------------------------------------------------
| Create
|--------------------------------------------------------------------------
*/

export const createTournament = async (userId: string, payload: any) => {
  const gate = await canCreateTournament(userId);

  if (!gate.allowed) {
    throw new AppError(
      gate.reason || "Tournament banane ki permission nahi hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const prizes = payload.prizes || [];

  const awards = payload.awards || [];

  assertAwardsValid(awards);

  /*
  |--------------------------------------------------------------------------
  | status vs isPublished
  |--------------------------------------------------------------------------
  |
  | These two are NOT independent, and treating them as such is how a
  | tournament ends up invisible with its Publish switch already on.
  |
  | The create form sends the whole form object, `isPublished` included. So
  | `{ ...payload, status: "draft" }` used to write isPublished:true next to
  | status:"draft" - and listTournaments matches on STATUS
  | ($in ["published","registration_closed"]), so the tournament appeared
  | on nobody's home screen. Worse, the only code that promotes draft ->
  | published is setVisibility, which runs when the switch CHANGES. The
  | switch was already on, so the organizer had no way to fix it except
  | turning it off and on again.
  |
  | So publish intent at create time is honoured here, with the same
  | one-ground rule setVisibility enforces - a published tournament nobody
  | can find a venue for is not a tournament.
  */

  const wantsPublished =
    !!payload.isPublished && (payload.grounds?.length ?? 0) > 0;

  const tournament = await Tournament.create({
    ...payload,
    prizes,
    awards,
    prizePool: poolOf(prizes, awards),
    userId,
    isPublished: wantsPublished,
    status: wantsPublished ? "published" : "draft",
  });

  return tournament;
};

/*
|--------------------------------------------------------------------------
| Update
|--------------------------------------------------------------------------
|
| Two locks, and both of them exist because changing a value after the fact
| silently rewrites something people have already seen:
|
|   Once fixtures exist, format / maxTeams / overs / playoffShape are
|   frozen. The whole schedule was derived from them.
|
|   Once one match is complete, the points values are frozen. A table
|   people have already read was built with the old numbers.
|
*/

const FIXTURE_LOCKED = [
  "format",
  "maxTeams",
  "overs",
  "playoffShape",
  "matchType",
];

const POINTS_LOCKED = [
  "pointsWin",
  "pointsLoss",
  "pointsTie",
  "pointsNoResult",
];

export const updateTournament = async (
  tournamentId: string,
  userId: string,
  payload: any,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  if (tournament.fixturesGeneratedAt) {
    for (const key of FIXTURE_LOCKED) {
      if (payload[key] !== undefined && String(payload[key]) !== String(tournament[key])) {
        throw new AppError(
          `Fixtures ban chuke hain — ab "${key}" nahi badal sakte.`,
          HTTP_STATUS.CONFLICT,
        );
      }
    }
  }

  const anyComplete = await Match.exists({
    tournamentId,
    status: "completed",
  });

  if (anyComplete) {
    for (const key of POINTS_LOCKED) {
      if (payload[key] !== undefined && Number(payload[key]) !== Number(tournament[key])) {
        throw new AppError(
          "Ek match complete ho chuka hai — ab points rules nahi badal sakte.",
          HTTP_STATUS.CONFLICT,
        );
      }
    }
  }

  if (payload.awards) assertAwardsValid(payload.awards);

  /*
  | `status` and `userId` are not editable fields, whatever the payload
  | says. The edit form reuses the create form and posts the whole object
  | back, so this is not a hypothetical attack - it is the normal path.
  */

  delete payload.status;
  delete payload.userId;

  Object.assign(tournament, payload);

  /*
  | Same draft/published pairing as createTournament. An edit that flips
  | isPublished on must move a draft forward, otherwise the tournament is
  | published-but-invisible and the switch is already on, leaving nothing
  | left to toggle. See the long note in createTournament.
  */

  if (
    tournament.isPublished &&
    tournament.status === "draft" &&
    tournament.grounds?.length
  ) {
    tournament.status = "published";
  }

  /*
  | Recomputed from whatever the tournament holds AFTER the assign, not
  | from the payload - an edit that touches only `prizes` must not wipe
  | the award money out of the pool, and vice versa.
  */

  if (payload.prizes || payload.awards) {
    tournament.prizePool = poolOf(tournament.prizes, tournament.awards);
  }

  await tournament.save();

  return tournament;
};

/*
|--------------------------------------------------------------------------
| Awards
|--------------------------------------------------------------------------
|
| The countable awards decide themselves and keep deciding - the
| leaderboard is live from the first completed match, so a player can see
| they are two sixes off the Most Sixes prize while the tournament is still
| running. That is most of the value of having the award at all.
|
| The rest need a person, and that person is the organizer.
|
*/

export const getAwards = async (tournamentId: string) => {
  const tournament: any = await Tournament.findById(tournamentId)
    .select("awards prizes prizePool status tournamentName")
    .lean();

  if (!tournament) {
    throw new AppError("Tournament not found.", HTTP_STATUS.NOT_FOUND);
  }

  const { awards, leaderboards } = await resolveAwards(tournament.awards ?? [], {
    tournamentId,
  });

  return {
    awards,

    /*
    | Every board, not only the ones with an award attached. A player
    | wants to know who is leading the run-scoring whether or not there is
    | money on it, and the stats tab renders from exactly this.
    */
    leaderboards,

    prizes: tournament.prizes ?? [],

    prizePool: tournament.prizePool ?? 0,
  };
};

/*
| Set - or clear - the winner of one award.
|
| Passing null hands it back to the counter, which matters: an organizer
| who overrode the wrong player needs a way out that is not "delete the
| award and add it again", because that loses the amount and the label.
*/

export const setAwardWinner = async (
  tournamentId: string,
  userId: string,
  metric: string,
  playerId: string | null,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  const award = (tournament.awards ?? []).find(
    (a: any) => a.metric === metric,
  );

  if (!award) {
    throw new AppError(
      "Ye award is tournament mein hai hi nahi.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  if (playerId) {
    const exists = await Player.exists({ _id: playerId });

    if (!exists) {
      throw new AppError("Player nahi mila.", HTTP_STATUS.NOT_FOUND);
    }
  }

  award.winnerPlayerId = playerId
    ? new mongoose.Types.ObjectId(playerId)
    : null;

  award.decidedAt = playerId ? new Date() : null;

  await tournament.save();

  return getAwards(tournamentId);
};

export const deleteTournament = async (
  tournamentId: string,
  userId: string,
) => {
  await assertOrganizer(tournamentId, userId);

  const played = await Match.exists({ tournamentId, status: "completed" });

  if (played) {
    throw new AppError(
      "Khele hue match wale tournament ko delete nahi kar sakte — cancel kar do.",
      HTTP_STATUS.CONFLICT,
    );
  }

  await Match.deleteMany({ tournamentId });

  await TournamentTeam.deleteMany({ tournamentId });

  await Tournament.findByIdAndDelete(tournamentId);

  return { deleted: true };
};

/*
|--------------------------------------------------------------------------
| Publish / participation
|--------------------------------------------------------------------------
*/

export const setVisibility = async (
  tournamentId: string,
  userId: string,
  { isPublished, publicParticipation }: any,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  if (isPublished !== undefined) {
    if (isPublished && !tournament.grounds?.length) {
      throw new AppError(
        "Publish karne se pehle kam se kam ek ground add karo.",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    tournament.isPublished = !!isPublished;

    if (isPublished && tournament.status === "draft") {
      tournament.status = "published";
    }
  }

  if (publicParticipation !== undefined) {
    tournament.publicParticipation = !!publicParticipation;
  }

  await tournament.save();

  return tournament;
};

/*
|--------------------------------------------------------------------------
| Invite a team
|--------------------------------------------------------------------------
|
| The notification goes to the CAPTAIN and nobody else. One team, one
| answer - a vice-captain accepting behind the captain's back is how a
| side ends up committed to six weekends it never agreed to.
|
*/

export const inviteTeam = async (
  tournamentId: string,
  userId: string,
  teamId: string,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  if (tournament.fixturesGeneratedAt) {
    throw new AppError(
      "Fixtures ban chuke hain — ab nayi team nahi jud sakti.",
      HTTP_STATUS.CONFLICT,
    );
  }

  const team: any = await Team.findById(teamId).select("teamName captainId userId");

  if (!team) {
    throw new AppError("Team not found.", HTTP_STATUS.NOT_FOUND);
  }

  const accepted = await TournamentTeam.countDocuments({
    tournamentId,
    status: "accepted",
  });

  if (accepted >= tournament.maxTeams) {
    throw new AppError(
      `Tournament full hai — ${tournament.maxTeams} teams ho chuki hain.`,
      HTTP_STATUS.CONFLICT,
    );
  }

  /*
  | The captain's user account is what receives the notification. A team
  | with no captain set cannot be invited - there is nobody to ask.
  */

  const captainPlayer: any = team.captainId
    ? await Player.findById(team.captainId).select("userId playerName")
    : null;

  const captainUserId = captainPlayer?.userId || team.userId;

  if (!captainUserId) {
    throw new AppError(
      "Is team ka koi captain set nahi hai — pehle captain assign karwao.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const entry: any = await TournamentTeam.findOneAndUpdate(
    { tournamentId, teamId },
    {
      tournamentId,
      teamId,
      captainUserId,
      invitedBy: userId,
      status: "invited",
      respondedAt: null,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  await createNotification({
    receiverId: String(captainUserId),
    actorId: String(userId),
    type: NOTIFICATION_TYPES.TOURNAMENT_INVITE_RECEIVED,
    title: "Tournament invite",
    message: `${team.teamName} ko "${tournament.tournamentName}" mein bulaya gaya hai.`,
    data: {
      tournamentId: String(tournamentId),
      teamId: String(teamId),
      entryId: String(entry._id),
    },
  }).catch(() => undefined);

  return entry;
};

export const cancelInvite = async (
  tournamentId: string,
  userId: string,
  teamId: string,
) => {
  await assertOrganizer(tournamentId, userId);

  await TournamentTeam.findOneAndDelete({
    tournamentId,
    teamId,
    status: { $in: ["invited", "requested", "declined"] },
  });

  return { cancelled: true };
};

/*
|--------------------------------------------------------------------------
| Captain answers
|--------------------------------------------------------------------------
*/

export const respondToInvite = async (
  tournamentId: string,
  userId: string,
  teamId: string,
  accept: boolean,
) => {
  const entry: any = await TournamentTeam.findOne({ tournamentId, teamId });

  if (!entry) {
    throw new AppError("Ye invite ab active nahi hai.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(entry.captainUserId) !== String(userId)) {
    throw new AppError(
      "Sirf team ka captain hi jawab de sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const tournament: any = await Tournament.findById(tournamentId);

  if (tournament?.fixturesGeneratedAt) {
    throw new AppError(
      "Fixtures ban chuke hain — ab jawab nahi de sakte.",
      HTTP_STATUS.CONFLICT,
    );
  }

  entry.status = accept ? "accepted" : "declined";

  entry.respondedAt = new Date();

  /*
  | joinedAt is the seeding clock and is stamped ONCE. A team that
  | declines and is re-invited keeps its original place in the queue only
  | if it had accepted before; otherwise it joins at the back.
  */

  if (accept && !entry.joinedAt) entry.joinedAt = new Date();

  await entry.save();

  const team: any = await Team.findById(teamId).select("teamName");

  await createNotification({
    receiverId: String(tournament.userId),
    actorId: String(userId),
    type: accept
      ? NOTIFICATION_TYPES.TOURNAMENT_INVITE_ACCEPTED
      : NOTIFICATION_TYPES.TOURNAMENT_INVITE_DECLINED,
    title: accept ? "Team joined" : "Team declined",
    message: `${team?.teamName || "Ek team"} ne "${tournament.tournamentName}" ${
      accept ? "join kar liya" : "join karne se mana kar diya"
    }.`,
    data: { tournamentId: String(tournamentId), teamId: String(teamId) },
  }).catch(() => undefined);

  return entry;
};

/*
| A captain asking to be let in, when the organizer has opened public
| participation. Lands as "requested" and waits for approval - the
| organizer still decides who is in their tournament.
*/

export const requestToJoin = async (
  tournamentId: string,
  userId: string,
  teamId: string,
) => {
  const tournament: any = await Tournament.findById(tournamentId);

  if (!tournament) {
    throw new AppError("Tournament not found.", HTTP_STATUS.NOT_FOUND);
  }

  if (!tournament.publicParticipation) {
    throw new AppError(
      "Is tournament mein khud se join nahi kar sakte — organizer invite bhejega.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  if (tournament.fixturesGeneratedAt) {
    throw new AppError(
      "Registration band ho chuka hai.",
      HTTP_STATUS.CONFLICT,
    );
  }

  const team: any = await Team.findById(teamId).select("teamName captainId userId");

  if (!team) throw new AppError("Team not found.", HTTP_STATUS.NOT_FOUND);

  const captainPlayer: any = team.captainId
    ? await Player.findById(team.captainId).select("userId")
    : null;

  const captainUserId = String(captainPlayer?.userId || team.userId || "");

  if (captainUserId !== String(userId)) {
    throw new AppError(
      "Sirf team ka captain hi join request bhej sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const entry: any = await TournamentTeam.findOneAndUpdate(
    { tournamentId, teamId },
    {
      tournamentId,
      teamId,
      captainUserId,
      status: "requested",
      respondedAt: new Date(),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  await createNotification({
    receiverId: String(tournament.userId),
    actorId: String(userId),
    type: NOTIFICATION_TYPES.TOURNAMENT_JOIN_REQUEST,
    title: "Join request",
    message: `${team.teamName} "${tournament.tournamentName}" mein judna chahti hai.`,
    data: { tournamentId: String(tournamentId), teamId: String(teamId) },
  }).catch(() => undefined);

  return entry;
};

export const respondToJoinRequest = async (
  tournamentId: string,
  userId: string,
  teamId: string,
  approve: boolean,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  const entry: any = await TournamentTeam.findOne({
    tournamentId,
    teamId,
    status: "requested",
  });

  if (!entry) {
    throw new AppError("Aisi koi request nahi hai.", HTTP_STATUS.NOT_FOUND);
  }

  entry.status = approve ? "accepted" : "declined";

  if (approve && !entry.joinedAt) entry.joinedAt = new Date();

  await entry.save();

  await createNotification({
    receiverId: String(entry.captainUserId),
    actorId: String(userId),
    type: approve
      ? NOTIFICATION_TYPES.TOURNAMENT_INVITE_ACCEPTED
      : NOTIFICATION_TYPES.TOURNAMENT_INVITE_DECLINED,
    title: approve ? "Request approved" : "Request declined",
    message: `"${tournament.tournamentName}" ki request ${
      approve ? "approve" : "reject"
    } ho gayi.`,
    data: { tournamentId: String(tournamentId), teamId: String(teamId) },
  }).catch(() => undefined);

  return entry;
};

export const removeTeam = async (
  tournamentId: string,
  userId: string,
  teamId: string,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  if (tournament.fixturesGeneratedAt) {
    throw new AppError(
      "Fixtures ban chuke hain — team hatane ke liye withdraw use karo.",
      HTTP_STATUS.CONFLICT,
    );
  }

  await TournamentTeam.findOneAndDelete({ tournamentId, teamId });

  return { removed: true };
};

/*
|--------------------------------------------------------------------------
| Squad
|--------------------------------------------------------------------------
|
| The captain registers 15-20 players and only those may appear in this
| tournament's matches.
|
| Fifteen is the floor because eleven plus four is the smallest squad that
| survives one injury and one no-show. Twenty is the ceiling so a club
| cannot register forty players and field a different team every week -
| which is the thing squad registration exists to prevent.
|
*/

export const setSquad = async (
  tournamentId: string,
  userId: string,
  teamId: string,
  playerIds: string[],
  final: boolean,
) => {
  const entry: any = await TournamentTeam.findOne({ tournamentId, teamId });

  if (!entry) {
    throw new AppError("Ye team is tournament mein nahi hai.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(entry.captainUserId) !== String(userId)) {
    throw new AppError(
      "Sirf team ka captain hi squad register kar sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  if (entry.squadLockedAt) {
    throw new AppError(
      "Squad lock ho chuki hai.",
      HTTP_STATUS.CONFLICT,
    );
  }

  const unique = [...new Set((playerIds || []).map(String))];

  if (unique.length > SQUAD_MAX) {
    throw new AppError(
      `Zyada se zyada ${SQUAD_MAX} players register kar sakte ho.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /*
  | A half-filled squad saves freely - the captain will come back to it.
  | The 15 minimum is only enforced when they submit it as final, which is
  | the moment it actually has to be a squad.
  */

  if (final && unique.length < SQUAD_MIN) {
    throw new AppError(
      `Kam se kam ${SQUAD_MIN} players chahiye. Abhi ${unique.length} hain.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  entry.squad = unique.map((id) => new mongoose.Types.ObjectId(id));

  if (final) entry.squadLockedAt = new Date();

  await entry.save();

  return entry;
};

/*
|--------------------------------------------------------------------------
| Read one team's squad
|--------------------------------------------------------------------------
|
| The captain leaves the squad screen half-filled and comes back to it a
| week later. Without this the screen would reopen empty and they would
| re-tick fifteen names they had already chosen, so the saved selection is
| readable on its own.
|
| It returns the FULL team roster alongside the registered subset, because
| the screen has to draw both: every player with a tick against the ones
| already in. Two lists from one request rather than a team fetch plus a
| squad fetch that can disagree with each other.
|
*/

export const getSquad = async (tournamentId: string, teamId: string) => {
  const entry: any = await TournamentTeam.findOne({ tournamentId, teamId })
    .populate("squad", "playerName role")
    .lean();

  if (!entry) {
    throw new AppError(
      "Ye team is tournament mein nahi hai.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  const team: any = await Team.findById(teamId)
    .populate("players", "playerName role")
    .select("teamName players captainId")
    .lean();

  return {
    teamId: String(teamId),

    teamName: team?.teamName ?? "Team",

    status: entry.status,

    locked: !!entry.squadLockedAt,

    min: SQUAD_MIN,

    max: SQUAD_MAX,

    squad: (entry.squad ?? []).map((p: any) => String(p?._id ?? p)),

    roster: (team?.players ?? []).map((p: any) => ({
      _id: String(p._id),
      playerName: p.playerName,
      role: p.role ?? null,
    })),
  };
};

/*
|--------------------------------------------------------------------------
| Lock and generate
|--------------------------------------------------------------------------
*/

export const lockAndGenerate = async (
  tournamentId: string,
  userId: string,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  if (tournament.format === "League+Knockout") {
    const shape = playoffShape(tournament.playoffShape);

    if (!shape) {
      throw new AppError(
        "Pehle playoff ka format chuno.",
        HTTP_STATUS.BAD_REQUEST,
      );
    }
  }

  const result = await generateFixtures(tournamentId);

  const entries: any[] = await TournamentTeam.find({
    tournamentId,
    status: "accepted",
  })
    .select("captainUserId")
    .lean();

  for (const e of entries) {
    if (!e.captainUserId) continue;

    await createNotification({
      receiverId: String(e.captainUserId),
      actorId: String(userId),
      type: NOTIFICATION_TYPES.TOURNAMENT_FIXTURES_READY,
      title: "Fixtures ready",
      message: `"${tournament.tournamentName}" ka schedule aa gaya hai — ${result.generated} matches.`,
      data: { tournamentId: String(tournamentId) },
    }).catch(() => undefined);
  }

  return result;
};

/*
|--------------------------------------------------------------------------
| Scorer control
|--------------------------------------------------------------------------
|
| The organizer scores by default. They can hand ONE match to somebody
| else, and take it back whenever they like - the write is a single field,
| so assigning a new scorer ends the previous one's rights in the same
| operation. There is no window where two people can both score.
|
| This is the same shape as rotating a broadcaster on a live stream: one
| holder, named, replaceable by the owner at any moment.
|
*/

export const assignMatchScorer = async (
  tournamentId: string,
  userId: string,
  matchId: string,
  targetUserId: string | null,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  const match: any = await Match.findOne({ _id: matchId, tournamentId });

  if (!match) {
    throw new AppError(
      "Ye match is tournament ka nahi hai.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  if (match.status === "completed") {
    throw new AppError(
      "Match complete ho chuka hai — ab scorer nahi badal sakte.",
      HTTP_STATUS.CONFLICT,
    );
  }

  const previous = match.scorerUserId ? String(match.scorerUserId) : null;

  /* null hands it back to the organizer rather than leaving it ownerless. */
  match.scorerUserId = targetUserId
    ? new mongoose.Types.ObjectId(targetUserId)
    : tournament.userId;

  await match.save();

  const newScorer = String(match.scorerUserId);

  if (previous && previous !== newScorer) {
    await createNotification({
      receiverId: previous,
      actorId: String(userId),
      type: NOTIFICATION_TYPES.TOURNAMENT_SCORER_REVOKED,
      title: "Scoring rights removed",
      message: `Ab tum "${tournament.tournamentName}" ka ye match score nahi kar sakte.`,
      data: { tournamentId: String(tournamentId), matchId: String(matchId) },
    }).catch(() => undefined);
  }

  if (newScorer !== String(userId)) {
    await createNotification({
      receiverId: newScorer,
      actorId: String(userId),
      type: NOTIFICATION_TYPES.TOURNAMENT_SCORER_ASSIGNED,
      title: "You are scoring this match",
      message: `"${tournament.tournamentName}" ka ek match tumhe score karne ko mila hai.`,
      data: { tournamentId: String(tournamentId), matchId: String(matchId) },
    }).catch(() => undefined);
  }

  return { matchId, scorerUserId: newScorer };
};

/*
|--------------------------------------------------------------------------
| Fixture edits
|--------------------------------------------------------------------------
|
| Date, time and ground only. Teams are deliberately not editable: the
| draw came out of the format, and hand-swapping one pairing breaks the
| guarantee that everybody plays everybody.
|
*/

export const updateFixture = async (
  tournamentId: string,
  userId: string,
  matchId: string,
  payload: any,
) => {
  await assertOrganizer(tournamentId, userId);

  const match: any = await Match.findOne({ _id: matchId, tournamentId });

  if (!match) {
    throw new AppError("Fixture not found.", HTTP_STATUS.NOT_FOUND);
  }

  if (match.status === "completed") {
    throw new AppError(
      "Khele hue match ko edit nahi kar sakte.",
      HTTP_STATUS.CONFLICT,
    );
  }

  if (payload.startTime) {
    match.startTime = new Date(payload.startTime);
    match.scheduledStartTime = new Date(payload.startTime);
  }

  if (payload.venueName !== undefined) match.venueName = payload.venueName;

  if (payload.groundId !== undefined) match.groundId = payload.groundId || null;

  await match.save();

  return match;
};

/*
|--------------------------------------------------------------------------
| Advance
|--------------------------------------------------------------------------
|
| Called after every completed match. Two jobs:
|
|   Fill in the next knockout fixture once its feeder matches are done -
|   a bracket slot that says "winner of match 3" becomes a real team.
|
|   Fill playoff fixtures from the league table once every league match
|   has been played.
|
| Safe to run any number of times: it only ever writes a team into a slot
| that is still empty.
|
*/

export const advanceTournament = async (tournamentId: string) => {
  const tournament: any = await Tournament.findById(tournamentId);

  if (!tournament || tournament.status === "completed") return;

  const matches: any[] = await Match.find({ tournamentId }).lean();

  const byNumber = new Map<number, any>();

  for (const m of matches) {
    const n = m.tournamentRound?.matchNumber;

    if (n) byNumber.set(Number(n), m);
  }

  /* ── Knockout progression ────────────────────────────────────── */

  for (const m of matches) {
    const round = m.tournamentRound;

    if (!round) continue;

    if (m.teamA && m.teamB) continue;

    const feederA = round.dependsOnMatchA
      ? byNumber.get(Number(round.dependsOnMatchA))
      : null;

    const feederB = round.dependsOnMatchB
      ? byNumber.get(Number(round.dependsOnMatchB))
      : null;

    const update: any = {};

    if (!m.teamA && feederA?.winnerTeam) update.teamA = feederA.winnerTeam;

    if (!m.teamB && feederB?.winnerTeam) update.teamB = feederB.winnerTeam;

    if (Object.keys(update).length) {
      const willBeComplete =
        (update.teamA || m.teamA) && (update.teamB || m.teamB);

      if (willBeComplete) update.status = "upcoming";

      await Match.updateOne({ _id: m._id }, update);
    }
  }

  /* ── Playoffs from the league table ──────────────────────────── */

  if (tournament.format === "League+Knockout") {
    const leagueLeft = await Match.countDocuments({
      tournamentId,
      "tournamentRound.stage": "league",
      status: { $ne: "completed" },
    });

    if (leagueLeft === 0) {
      const table = await getStandings(tournamentId);

      const shape = playoffShape(tournament.playoffShape);

      const pick = (n: number) => table[n - 1]?.teamId ?? null;

      const setTeams = async (label: string, a: any, b: any) => {
        if (!a || !b) return;

        await Match.updateOne(
          {
            tournamentId,
            "tournamentRound.label": label,
            teamA: null,
          },
          { teamA: a, teamB: b, status: "upcoming" },
        );
      };

      if (shape?.key === "final_only") {
        await setTeams("Final", pick(1), pick(2));
      }

      if (shape?.key === "top4_semis") {
        await setTeams("Semi Final 1", pick(1), pick(4));
        await setTeams("Semi Final 2", pick(2), pick(3));
      }

      if (shape?.key === "ipl_playoffs") {
        await setTeams("Qualifier 1", pick(1), pick(2));
        await setTeams("Eliminator", pick(3), pick(4));
      }
    }
  }

  /* ── Finished? ───────────────────────────────────────────────── */

  const finalMatch: any = await Match.findOne({
    tournamentId,
    "tournamentRound.label": "Final",
  }).lean();

  const pureLeagueDone =
    tournament.format === "League" &&
    (await Match.countDocuments({
      tournamentId,
      status: { $ne: "completed" },
    })) === 0;

  if (finalMatch?.status === "completed" && finalMatch.winnerTeam) {
    tournament.winnerTeam = finalMatch.winnerTeam;

    tournament.runnerUpTeam =
      String(finalMatch.teamA) === String(finalMatch.winnerTeam)
        ? finalMatch.teamB
        : finalMatch.teamA;

    tournament.status = "completed";
    tournament.completedAt = new Date();

    await tournament.save();
  } else if (pureLeagueDone) {
    const table = await getStandings(tournamentId);

    if (table.length) {
      tournament.winnerTeam = table[0]!.teamId;
      tournament.runnerUpTeam = table[1]?.teamId ?? null;
      tournament.status = "completed";
      tournament.completedAt = new Date();

      await tournament.save();
    }
  } else if (
    tournament.status === "registration_closed" &&
    (await Match.exists({ tournamentId, status: { $in: ["live", "completed"] } }))
  ) {
    tournament.status = "live";

    await tournament.save();
  }
};

/*
|--------------------------------------------------------------------------
| Reads
|--------------------------------------------------------------------------
*/

export const listTournaments = async (userId: string, filter: string) => {
  const base: any = { isPublished: true };

  if (filter === "live") base.status = "live";

  if (filter === "upcoming") {
    base.status = { $in: ["published", "registration_closed"] };
  }

  if (filter === "completed") base.status = "completed";

  /*
  | "mine" ignores isPublished on purpose - the organizer has to be able
  | to find their own draft, and a captain has to find a tournament their
  | team is in whatever its visibility.
  */

  if (filter === "mine") {
    const entries: any[] = await TournamentTeam.find({
      captainUserId: userId,
      status: { $in: ["invited", "requested", "accepted"] },
    })
      .select("tournamentId")
      .lean();

    const ids = entries.map((e) => e.tournamentId);

    const list = await Tournament.find({
      $or: [{ userId }, { _id: { $in: ids } }],
    })
      .populate("winnerTeam", "teamName logo")
      .sort({ createdAt: -1 })
      .lean();

    return withCounts(list, userId);
  }

  const list = await Tournament.find(base)
    .populate("winnerTeam", "teamName logo")
    .sort({ startDate: -1, createdAt: -1 })
    .limit(50)
    .lean();

  return withCounts(list, userId);
};

const withCounts = async (list: any[], userId: string) => {
  if (!list.length) return [];

  const ids = list.map((t) => t._id);

  const counts: any[] = await TournamentTeam.aggregate([
    { $match: { tournamentId: { $in: ids }, status: "accepted" } },
    { $group: { _id: "$tournamentId", teams: { $sum: 1 } } },
  ]);

  const map = new Map(counts.map((c) => [String(c._id), c.teams]));

  return list.map((t) => ({
    ...t,
    teamCount: map.get(String(t._id)) ?? 0,
    isOrganizer: String(t.userId) === String(userId),
  }));
};

/*
|--------------------------------------------------------------------------
| Teams this user is the captain OF
|--------------------------------------------------------------------------
|
| Not "teams they are in" - captaincy specifically, because only a captain
| may enter a team into a tournament (see requestToJoin).
|
| Captaincy is stored two ways and both are load-bearing:
|
|   team.captainId -> a Player document, which may or may not be linked
|                     to a user account
|   team.userId    -> whoever created the team
|
| requestToJoin resolves it as `captainPlayer.userId || team.userId`, and
| this function MUST resolve it identically. If it were looser, the app
| would offer a team in the picker that the server then refuses with 403 -
| the worst kind of bug, because the user did nothing wrong.
|
*/

const teamsCaptainedBy = async (userId: string) => {
  const myPlayer: any = await Player.findOne({ userId }).select("_id").lean();

  const or: any[] = [{ userId }];

  if (myPlayer) or.push({ captainId: myPlayer._id });

  const teams: any[] = await Team.find({ $or: or })
    .select("teamName logo captainId userId")
    .lean();

  if (!teams.length) return [];

  const captainIds = teams.map((t) => t.captainId).filter(Boolean);

  const captains: any[] = captainIds.length
    ? await Player.find({ _id: { $in: captainIds } })
        .select("userId")
        .lean()
    : [];

  const captainUserOf = new Map(
    captains.map((c) => [String(c._id), String(c.userId ?? "")]),
  );

  return teams.filter((t) => {
    const resolved =
      (t.captainId ? captainUserOf.get(String(t.captainId)) : "") ||
      String(t.userId ?? "");

    return resolved === String(userId);
  });
};

export const getTournamentById = async (
  tournamentId: string,
  userId?: string,
) => {
  const tournament: any = await Tournament.findById(tournamentId)
    .populate("userId", "name phone")
    .populate("winnerTeam", "teamName logo")
    .populate("runnerUpTeam", "teamName logo")
    .lean();

  if (!tournament) {
    throw new AppError("Tournament not found.", HTTP_STATUS.NOT_FOUND);
  }

  const entries: any[] = await TournamentTeam.find({ tournamentId })
    .populate("teamId", "teamName logo")
    .sort({ seed: 1, joinedAt: 1 })
    .lean();

  const isOrganizer = String(tournament.userId?._id ?? tournament.userId) === String(userId);

  /*
  |--------------------------------------------------------------------------
  | Who is this person
  |--------------------------------------------------------------------------
  |
  | Three roles, and the app draws a different screen for each:
  |
  |   organizer     everything, including the Settings tab
  |   participant   a captain of an entered team, or a player in one of
  |                 their registered squads - everything except Settings
  |   viewer        anybody else - the same public tournament, no more
  |
  | The participant check goes through Player because a squad holds player
  | ids and the session holds a user id. One lookup for the user's own
  | player record, then a membership test against the registered squads;
  | if they have no player profile at all they cannot be in a squad, and
  | the lookup is skipped.
  |
  | Note what this does NOT gate: fixtures, scorecards, the points table,
  | stats and awards are open to everyone. A tournament is a public event
  | and hiding its results from people who did not enter would be
  | pointless. The role decides what you can DO and whether you see the
  | Settings tab - not what you can read.
  |
  */

  const accepted = entries.filter((e) => e.status === "accepted");

  const isCaptainHere = accepted.some(
    (e) => String(e.captainUserId) === String(userId),
  );

  let isSquadMember = false;

  if (userId && !isCaptainHere) {
    const me: any = await Player.findOne({ userId }).select("_id").lean();

    if (me) {
      isSquadMember = accepted.some((e) =>
        (e.squad ?? []).some((p: any) => String(p) === String(me._id)),
      );
    }
  }

  const isParticipant = isCaptainHere || isSquadMember;

  const myRole = isOrganizer
    ? "organizer"
    : isCaptainHere
      ? "captain"
      : isSquadMember
        ? "player"
        : "viewer";

  /*
  | A pending invite addressed to THIS user is surfaced at the top level so
  | the detail screen can show the accept strip without a second request.
  |
  | "invited" ONLY. A "requested" entry is this user's own application
  | waiting on the organizer - it used to be lumped in here, which made the
  | screen tell a captain who had just applied that they had "received an
  | invite" and offer them an Accept button for their own request. Those
  | are opposite directions and they get separate fields.
  */

  const myPendingInvite = entries.find(
    (e) =>
      String(e.captainUserId) === String(userId) && e.status === "invited",
  );

  /*
  |--------------------------------------------------------------------------
  | Can this person put a team in
  |--------------------------------------------------------------------------
  |
  | Every condition the server will check in requestToJoin, checked here
  | too, so the app can show the right thing instead of a button that
  | fails. A captain often holds several teams, so the answer is a LIST
  | and the picker asks which one - that choice cannot be guessed.
  |
  | Teams already invited, already applied or already in are filtered out.
  | A DECLINED team stays in the list on purpose: an organizer who rejected
  | a side by mistake, or a side that sorted out its availability, should
  | be able to try again - requestToJoin upserts on (tournament, team), so
  | the re-application overwrites the old row rather than duplicating it.
  |
  */

  const engagedTeamIds = new Set(
    entries
      .filter((e) => ["invited", "requested", "accepted"].includes(e.status))
      .map((e) => String(e.teamId?._id ?? e.teamId)),
  );

  const canParticipate =
    !!userId &&
    !isOrganizer &&
    !!tournament.publicParticipation &&
    !tournament.fixturesGeneratedAt &&
    accepted.length < (tournament.maxTeams ?? 0);

  let myJoinableTeams: any[] = [];

  if (canParticipate) {
    const mine = await teamsCaptainedBy(String(userId));

    myJoinableTeams = mine
      .filter((t) => !engagedTeamIds.has(String(t._id)))
      .map((t) => ({
        teamId: t._id,
        teamName: t.teamName ?? "Team",
        logo: t.logo ?? null,
      }));
  }

  /* This user's own applications still waiting on the organizer. */

  const myJoinRequests = entries
    .filter(
      (e) =>
        String(e.captainUserId) === String(userId) && e.status === "requested",
    )
    .map((e) => ({
      teamId: e.teamId?._id ?? e.teamId,
      teamName: e.teamId?.teamName ?? "Team",
    }));

  return {
    ...tournament,

    isOrganizer,

    isParticipant,

    myRole,

    teams: accepted
      .map((e) => ({
        teamId: e.teamId?._id ?? e.teamId,
        teamName: e.teamId?.teamName ?? "Team",
        logo: e.teamId?.logo ?? null,
        seed: e.seed,
        squadSize: e.squad?.length ?? 0,
        squadLocked: !!e.squadLockedAt,
      })),

    /* Organizer-only operational detail; everyone else sees none of it. */
    pendingTeams: isOrganizer
      ? entries
          .filter((e) => ["invited", "requested", "declined"].includes(e.status))
          .map((e) => ({
            teamId: e.teamId?._id ?? e.teamId,
            teamName: e.teamId?.teamName ?? "Team",
            logo: e.teamId?.logo ?? null,
            status: e.status,
          }))
      : [],

    myInvite: myPendingInvite
      ? {
          teamId: myPendingInvite.teamId?._id ?? myPendingInvite.teamId,
          teamName: myPendingInvite.teamId?.teamName ?? "Team",
          status: myPendingInvite.status,
        }
      : null,

    /*
    | The teams THIS user captains that are already in. Once an invite is
    | accepted `myInvite` goes null, and without this the captain would
    | have no way back to the one thing they still have to do - register
    | the squad. A captain can hold more than one team, so it is a list.
    */

    myTeams: entries
      .filter(
        (e) =>
          String(e.captainUserId) === String(userId) &&
          e.status === "accepted",
      )
      .map((e) => ({
        teamId: e.teamId?._id ?? e.teamId,
        teamName: e.teamId?.teamName ?? "Team",
        squadSize: e.squad?.length ?? 0,
        squadLocked: !!e.squadLockedAt,
      })),

    /*
    | The apply flow. `canRequestJoin` is the single question the screen
    | asks before drawing the strip - it is false when the tournament is
    | invite-only, when fixtures are out, when it is full, when this user
    | organizes it, and when they captain no team that is not already in.
    */

    canRequestJoin: canParticipate && myJoinableTeams.length > 0,

    myJoinableTeams,

    myJoinRequests,

    acceptedCount: accepted.length,
  };
};

export const getFixtures = async (tournamentId: string) => {
  const matches: any[] = await Match.find({ tournamentId })
    .populate("teamA", "teamName logo")
    .populate("teamB", "teamName logo")
    .populate("winnerTeam", "teamName logo")
    .select(
      "matchTitle status startTime venueName teamA teamB winnerTeam result tournamentRound scorerUserId",
    )
    .sort({ "tournamentRound.matchNumber": 1 })
    .lean();

  /* Grouped by round so the app renders "Round 1", "Semi Final" headers. */

  const rounds = new Map<string, any[]>();

  for (const m of matches) {
    const key = m.tournamentRound?.label || "Fixtures";

    rounds.set(key, [...(rounds.get(key) ?? []), m]);
  }

  return [...rounds.entries()].map(([label, list]) => ({
    label,
    roundNumber: list[0]?.tournamentRound?.roundNumber ?? 0,
    matches: list,
  }));
};

export const getPointsTable = async (tournamentId: string) => {
  await recomputeStandings(tournamentId);

  return getStandings(tournamentId);
};

/*
| Leaderboard for this tournament only - separate from career stats, which
| a tournament match also feeds. Both are true at once: a hundred is a
| hundred, and it belongs in the player's career; the tournament board just
| answers a narrower question.
*/

/*
| The stats tab.
|
| This used to run its own two aggregations for runs and wickets. It now
| reads the same leaderboards the awards do, which matters more than the
| saved code: two separate counters over the same deliveries WILL disagree
| eventually - one credits a run out to the bowler, the other does not -
| and then the Most Wickets award names a player the stats tab has in
| second place. One counter, one answer.
|
| `batting` and `bowling` are still returned in their old shape so nothing
| that already reads them breaks.
*/

export const getTournamentStats = async (tournamentId: string) => {
  const boards = await buildLeaderboards({ tournamentId });

  const asBatting = (boards.most_runs ?? []).map((r) => ({
    playerId: r.playerId,
    name: r.name,
    profileImage: r.profileImage ?? null,
    runs: r.value,
    balls: r.meta?.balls ?? 0,
    fours: r.meta?.fours ?? 0,
    sixes: r.meta?.sixes ?? 0,
    strikeRate: r.meta?.strikeRate ?? 0,
  }));

  const asBowling = (boards.most_wickets ?? []).map((r) => ({
    playerId: r.playerId,
    name: r.name,
    profileImage: r.profileImage ?? null,
    wickets: r.value,
    economy: r.meta?.economy ?? 0,
    conceded: r.meta?.conceded ?? 0,
  }));

  return {
    batting: asBatting,

    bowling: asBowling,

    /* Everything else the Stats tab draws: sixes, fours, catches, best
       innings, strike rate, economy, most POTM. */
    boards,
  };
};

export const cancelTournament = async (
  tournamentId: string,
  userId: string,
) => {
  const tournament: any = await assertOrganizer(tournamentId, userId);

  tournament.status = "cancelled";

  await tournament.save();

  await Match.updateMany(
    { tournamentId, status: { $in: ["draft", "upcoming"] } },
    { status: "cancelled" },
  );

  const entries: any[] = await TournamentTeam.find({
    tournamentId,
    status: "accepted",
  })
    .select("captainUserId")
    .lean();

  for (const e of entries) {
    if (!e.captainUserId) continue;

    await createNotification({
      receiverId: String(e.captainUserId),
      actorId: String(userId),
      type: NOTIFICATION_TYPES.TOURNAMENT_CANCELLED,
      title: "Tournament cancelled",
      message: `"${tournament.tournamentName}" cancel kar diya gaya hai.`,
      data: { tournamentId: String(tournamentId) },
    }).catch(() => undefined);
  }

  return tournament;
};

/*
|--------------------------------------------------------------------------
| Withdraw
|--------------------------------------------------------------------------
|
| A team walking out mid-tournament. This happens, and pretending it does
| not leaves half a table wrong for the rest of the season.
|
| Matches already played STAND - they were real games with real scorecards
| and real player stats. Everything still to come is conceded: the opponent
| takes the win and the points, and NOTHING is added to either side's run
| totals, so a walkover cannot distort anybody's NRR.
|
*/

export const withdrawTeam = async (
  tournamentId: string,
  userId: string,
  teamId: string,
) => {
  const tournament: any = await Tournament.findById(tournamentId);

  if (!tournament) {
    throw new AppError("Tournament not found.", HTTP_STATUS.NOT_FOUND);
  }

  const entry: any = await TournamentTeam.findOne({ tournamentId, teamId });

  if (!entry) {
    throw new AppError("Ye team is tournament mein nahi hai.", HTTP_STATUS.NOT_FOUND);
  }

  const isOrganizer = String(tournament.userId) === String(userId);

  if (!isOrganizer && String(entry.captainUserId) !== String(userId)) {
    throw new AppError(
      "Sirf organizer ya team ka captain hi withdraw kar sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  entry.status = "withdrawn";
  entry.withdrawnAt = new Date();

  await entry.save();

  const pending: any[] = await Match.find({
    tournamentId,
    status: { $in: ["draft", "upcoming"] },
    $or: [{ teamA: teamId }, { teamB: teamId }],
  });

  for (const m of pending) {
    const opponent =
      String(m.teamA) === String(teamId) ? m.teamB : m.teamA;

    m.status = "completed";
    m.winnerTeam = opponent;
    m.result = "Conceded — opponent withdrew";
    m.endTime = new Date();

    await m.save();
  }

  await recomputeStandings(tournamentId);

  await advanceTournament(tournamentId);

  return { withdrawn: true, conceded: pending.length };
};
