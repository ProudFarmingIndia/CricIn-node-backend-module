/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Series
|
| File:
| series.service.ts
|
| Description:
| Every operation on a bilateral series, from draft to result.
|
| THE SHAPE OF THE FLOW
|
|   create        organizer picks their own team, the opponent, the length
|   invite        one notification, to the opponent's CAPTAIN and nobody
|                 else - one team, one answer
|   accept        the opponent is in; nothing is provisional after this
|   publish       visible on the home feed and the Matches tab
|   generate      N fixtures created as real Match documents
|   play          the existing scoring flow, untouched
|   scoreline     recomputed after every result
|   awards        the same counter the tournament uses
|
| WHAT IS DELIBERATELY MISSING COMPARED TO A TOURNAMENT
|
|   No seeding. There are two teams; there is nothing to order.
|
|   No points table or NRR. With two teams, run rate decides nothing that
|   the scoreline has not already decided.
|
|   No squad registration. A tournament locks 15-20 players for six weeks
|   because a club that can field anyone every weekend does not have a
|   squad. A three-match series over two weekends does not have that
|   problem, and forcing two captains through a squad screen to play three
|   games is friction with no purpose. Per-match playing XI still works
|   exactly as it does for any other match.
|
|   No public participation. Nobody can ask to join a series.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import Series from "./series.model";
import Match from "../matches/match.model";
import Team from "../teams/team.model";
import Player from "../players/player.model";

import { createNotification } from "../notifications/notification.service";
import { NOTIFICATION_TYPES } from "../notifications/notification.types";

import { resolveAwards, buildLeaderboards } from "../tournaments/awards.service";

import { awardMetric, MIN_MATCHES, MAX_MATCHES } from "./series.constants";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

/*
|--------------------------------------------------------------------------
| The subscription gate
|--------------------------------------------------------------------------
|
| ONE function, exactly as in the tournament module. Today it returns true
| for everybody; when series organizing becomes a paid right, this is the
| only place that changes.
|
| It is a function and not an inline `if` so that the eventual check has
| somewhere to live that is already wired into every caller - retrofitting
| a gate is how you end up with three creation paths and only two of them
| checked.
|
*/

export const canCreateSeries = async (
  _userId: string,
): Promise<{ allowed: boolean; reason?: string }> => {
  return { allowed: true };
};

/*
|--------------------------------------------------------------------------
| Guards
|--------------------------------------------------------------------------
*/

const assertOrganizer = async (seriesId: string, userId: string) => {
  const series: any = await Series.findById(seriesId);

  if (!series) {
    throw new AppError("Series not found.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(series.userId) !== String(userId)) {
    throw new AppError(
      "Sirf series ka organizer hi ye kar sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  return series;
};

const sumAmounts = (rows: any[]) =>
  (rows || []).reduce((total, p) => total + Number(p?.amount || 0), 0);

const poolOf = (prizes: any[], awards: any[]) =>
  sumAmounts(prizes) + sumAmounts(awards);

const assertAwardsValid = (awards: any[]) => {
  if (!awards?.length) return;

  const seen = new Set<string>();

  for (const a of awards) {
    if (!a?.metric || !awardMetric(a.metric)) {
      throw new AppError("Award ka type galat hai.", HTTP_STATUS.BAD_REQUEST);
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
|
| The organizer must captain (or own) teamA. Without that check anybody
| could create a series in two other clubs' names and start sending
| invites signed with their team's badge.
|
*/

export const createSeries = async (userId: string, payload: any) => {
  const gate = await canCreateSeries(userId);

  if (!gate.allowed) {
    throw new AppError(
      gate.reason || "Series banane ki permission nahi hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  if (!payload.teamA) {
    throw new AppError("Apni team chuno.", HTTP_STATUS.BAD_REQUEST);
  }

  const team: any = await Team.findById(payload.teamA)
    .select("captainId viceCaptainId userId teamName")
    .lean();

  if (!team) {
    throw new AppError("Team nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  const runsTeam =
    String(team.captainId) === String(userId) ||
    String(team.userId) === String(userId) ||
    String(team.viceCaptainId) === String(userId);

  if (!runsTeam) {
    throw new AppError(
      "Series sirf apni team ke liye bana sakte ho — tum is team ke captain nahi ho.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const total = Number(payload.totalMatches || 3);

  if (total < MIN_MATCHES || total > MAX_MATCHES) {
    throw new AppError(
      `Matches ${MIN_MATCHES} se ${MAX_MATCHES} ke beech hone chahiye.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const prizes = payload.prizes || [];

  const awards = payload.awards || [];

  assertAwardsValid(awards);

  /*
  | teamB is NOT taken from the payload here even if it was sent. The
  | opponent enters through inviteOpponent, which is what creates the
  | notification and the pending state - setting it directly would put a
  | team into a series without ever asking them.
  */

  const series = await Series.create({
    ...payload,
    teamB: null,
    opponentStatus: "pending",
    totalMatches: total,
    prizes,
    awards,
    prizePool: poolOf(prizes, awards),
    userId,
    status: "draft",
  });

  return series;
};

/*
|--------------------------------------------------------------------------
| Update
|--------------------------------------------------------------------------
|
| Once fixtures exist, the shape is frozen. Every one of these values was
| used to build the schedule, and changing them afterwards would leave the
| series describing itself as something its own matches are not.
|
*/

const FIXTURE_LOCKED = ["totalMatches", "overs", "matchType", "teamA"];

export const updateSeries = async (
  seriesId: string,
  userId: string,
  payload: any,
) => {
  const series: any = await assertOrganizer(seriesId, userId);

  if (series.fixturesGeneratedAt) {
    for (const key of FIXTURE_LOCKED) {
      if (
        payload[key] !== undefined &&
        String(payload[key]) !== String(series[key])
      ) {
        throw new AppError(
          `Fixtures ban chuke hain — ab "${key}" nahi badal sakte.`,
          HTTP_STATUS.CONFLICT,
        );
      }
    }
  }

  if (payload.awards) assertAwardsValid(payload.awards);

  /* Never through the generic update - it has its own guarded path. */
  delete payload.teamB;
  delete payload.opponentStatus;

  Object.assign(series, payload);

  if (payload.prizes || payload.awards) {
    series.prizePool = poolOf(series.prizes, series.awards);
  }

  await series.save();

  return series;
};

/*
|--------------------------------------------------------------------------
| Visibility
|--------------------------------------------------------------------------
*/

export const setVisibility = async (
  seriesId: string,
  userId: string,
  isPublished: boolean,
) => {
  const series: any = await assertOrganizer(seriesId, userId);

  if (isPublished && !series.grounds?.length) {
    throw new AppError(
      "Publish karne se pehle kam se kam ek ground add karo.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  series.isPublished = !!isPublished;

  if (isPublished && series.status === "draft") {
    series.status = "published";
  }

  await series.save();

  return series;
};

/*
|--------------------------------------------------------------------------
| Invite the opponent
|--------------------------------------------------------------------------
|
| One invite, to the opponent team's CAPTAIN and nobody else. A
| vice-captain accepting behind the captain's back is how a side ends up
| committed to five weekends it never agreed to - the tournament module
| makes the same call for the same reason.
|
| Re-inviting after a decline is allowed and is the normal way to change
| your mind about an opponent: it resets the state and sends a fresh
| notification. Re-inviting the SAME team while they have not answered is
| refused, because that is a nag, not an invite.
|
*/

export const inviteOpponent = async (
  seriesId: string,
  userId: string,
  teamId: string,
) => {
  const series: any = await assertOrganizer(seriesId, userId);

  if (series.fixturesGeneratedAt) {
    throw new AppError(
      "Fixtures ban chuke hain — ab opponent nahi badal sakte.",
      HTTP_STATUS.CONFLICT,
    );
  }

  if (String(teamId) === String(series.teamA)) {
    throw new AppError(
      "Team khud se nahi khel sakti — doosri team chuno.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (
    String(series.teamB) === String(teamId) &&
    series.opponentStatus === "pending"
  ) {
    throw new AppError(
      "Is team ko already invite bheja hua hai — jawab ka intezaar karo.",
      HTTP_STATUS.CONFLICT,
    );
  }

  if (series.opponentStatus === "accepted") {
    throw new AppError(
      "Opponent already confirm ho chuka hai.",
      HTTP_STATUS.CONFLICT,
    );
  }

  const team: any = await Team.findById(teamId)
    .select("captainId teamName")
    .lean();

  if (!team) {
    throw new AppError("Team nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  if (!team.captainId) {
    throw new AppError(
      "Is team ka koi captain nahi hai — invite kis ko bheje?",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  series.teamB = new mongoose.Types.ObjectId(teamId);

  series.opponentCaptainUserId = team.captainId;

  series.opponentStatus = "pending";

  series.opponentRespondedAt = null;

  await series.save();

  const mine: any = await Team.findById(series.teamA).select("teamName").lean();

  await createNotification({
    receiverId: String(team.captainId),
    actorId: String(userId),
    type: NOTIFICATION_TYPES.SERIES_INVITE_RECEIVED,
    title: "Series invite",
    message: `${mine?.teamName ?? "Ek team"} ne "${series.seriesName}" ke liye ${series.totalMatches} match ka series challenge bheja hai.`,
    data: { seriesId: String(series._id), teamId: String(teamId) },
  }).catch(() => undefined);

  return series;
};

/*
|--------------------------------------------------------------------------
| The opponent answers
|--------------------------------------------------------------------------
*/

export const respondToInvite = async (
  seriesId: string,
  userId: string,
  accept: boolean,
) => {
  const series: any = await Series.findById(seriesId);

  if (!series) {
    throw new AppError("Series not found.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(series.opponentCaptainUserId) !== String(userId)) {
    throw new AppError(
      "Sirf opponent team ka captain hi jawab de sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  if (series.opponentStatus !== "pending") {
    throw new AppError(
      "Is invite ka jawab already ja chuka hai.",
      HTTP_STATUS.CONFLICT,
    );
  }

  series.opponentStatus = accept ? "accepted" : "declined";

  series.opponentRespondedAt = new Date();

  /*
  | A decline releases the slot so the organizer can invite somebody else
  | without the series being stuck describing a team that said no.
  */

  if (!accept) {
    series.teamB = null;

    series.opponentCaptainUserId = null;
  }

  await series.save();

  await createNotification({
    receiverId: String(series.userId),
    actorId: String(userId),
    type: accept
      ? NOTIFICATION_TYPES.SERIES_INVITE_ACCEPTED
      : NOTIFICATION_TYPES.SERIES_INVITE_DECLINED,
    title: accept ? "Series accepted" : "Series declined",
    message: `"${series.seriesName}" ka invite ${accept ? "accept" : "reject"} ho gaya.`,
    data: { seriesId: String(series._id) },
  }).catch(() => undefined);

  return series;
};

/*
|--------------------------------------------------------------------------
| Fixtures
|--------------------------------------------------------------------------
|
| N matches between the same two teams, spread across the playing days and
| dealt round-robin across the grounds.
|
| The scheduling walk is the same shape as the tournament's, kept
| deliberately identical so an organizer who has run a tournament finds
| the dates land where they expect. It is reimplemented here rather than
| imported because the tournament version takes a tournament document and
| plans a bracket, and generalising it to serve both would make the more
| complicated of the two harder to read for no gain.
|
*/

const nextPlayableDate = (from: Date, playDays: number[]) => {
  const days = playDays?.length ? playDays : [0, 1, 2, 3, 4, 5, 6];

  const cursor = new Date(from);

  /*
  | Bounded at 14 so a playDays array that somehow contains no valid day
  | cannot spin forever. Two weeks is past any real schedule gap.
  */

  for (let i = 0; i < 14; i++) {
    if (days.includes(cursor.getDay())) return cursor;

    cursor.setDate(cursor.getDate() + 1);
  }

  return cursor;
};

export const buildSeriesSchedule = (
  count: number,
  startDate: Date,
  playDays: number[],
  matchesPerDay: number,
): Date[] => {
  const out: Date[] = [];

  let cursor = nextPlayableDate(new Date(startDate), playDays);

  let placedToday = 0;

  for (let i = 0; i < count; i++) {
    if (placedToday >= matchesPerDay) {
      cursor = nextPlayableDate(
        new Date(cursor.getTime() + 24 * 60 * 60 * 1000),
        playDays,
      );

      placedToday = 0;
    }

    const slot = new Date(cursor);

    /* Morning and afternoon rather than every fixture at 09:00. */
    slot.setHours(9 + placedToday * 4, 0, 0, 0);

    out.push(slot);

    placedToday++;
  }

  return out;
};

/*
| Ordinal labels - "1st T20", "2nd T20". A series match without a number
| is just a match, and the number is what makes "we lost the 2nd one" a
| sentence the app can support.
*/

const ordinal = (n: number) => {
  if (n === 1) return "1st";

  if (n === 2) return "2nd";

  if (n === 3) return "3rd";

  return `${n}th`;
};

export const generateFixtures = async (seriesId: string, userId: string) => {
  const series: any = await assertOrganizer(seriesId, userId);

  if (series.fixturesGeneratedAt) {
    throw new AppError(
      "Fixtures already ban chuke hain.",
      HTTP_STATUS.CONFLICT,
    );
  }

  if (series.opponentStatus !== "accepted" || !series.teamB) {
    throw new AppError(
      "Pehle opponent team ka accept aana zaroori hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (!series.grounds?.length) {
    throw new AppError("Kam se kam ek ground add karo.", HTTP_STATUS.BAD_REQUEST);
  }

  const dates = buildSeriesSchedule(
    series.totalMatches,
    series.startDate || new Date(),
    series.playDays || [],
    series.matchesPerDay || 1,
  );

  const created = [];

  for (let i = 0; i < series.totalMatches; i++) {
    const ground = series.grounds[i % series.grounds.length];

    const doc: any = await Match.create({
      userId: series.userId,

      matchTitle: `${series.seriesName} · ${ordinal(i + 1)} ${series.matchType}`,

      matchType: series.matchType,

      overs: series.overs,

      ballType: series.ballType,

      /*
      | Both teams are known from the start - unlike a tournament, where a
      | playoff slot has to be created as a draft placeholder. So every
      | series fixture goes straight to "upcoming" and is immediately a
      | real, playable match.
      */

      teamA: series.teamA,
      teamB: series.teamB,

      status: "upcoming",

      scheduledStartTime: dates[i],
      startTime: dates[i],

      venueName: ground?.name || "",
      groundId: ground?.groundId || undefined,

      /* Organizer scores by default; transferable per match afterwards. */
      scorerUserId: series.userId,

      seriesId: series._id,
      seriesMatchNumber: i + 1,
    } as any);

    created.push(doc);
  }

  series.fixturesGeneratedAt = new Date();

  series.status = "scheduled";

  if (!series.endDate && dates.length) {
    series.endDate = dates[dates.length - 1];
  }

  await series.save();

  /* Both captains are told - it is their schedule now. */

  const receivers = [series.opponentCaptainUserId].filter(Boolean);

  for (const receiver of receivers) {
    await createNotification({
      receiverId: String(receiver),
      actorId: String(userId),
      type: NOTIFICATION_TYPES.SERIES_FIXTURES_READY,
      title: "Series schedule ready",
      message: `"${series.seriesName}" ke ${created.length} match schedule ho gaye.`,
      data: { seriesId: String(series._id) },
    }).catch(() => undefined);
  }

  return { generated: created.length };
};

export const updateFixture = async (
  seriesId: string,
  userId: string,
  matchId: string,
  payload: any,
) => {
  await assertOrganizer(seriesId, userId);

  const match: any = await Match.findOne({ _id: matchId, seriesId });

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
| Scorer control
|--------------------------------------------------------------------------
|
| Identical to the tournament's, and identical for a reason: it is a
| single field write, so handing the match to somebody else ends the
| previous holder's rights in the same operation. There is never a window
| where two people can both score.
|
| null hands it back to the organizer rather than leaving it ownerless.
|
*/

export const assignMatchScorer = async (
  seriesId: string,
  userId: string,
  matchId: string,
  targetUserId: string | null,
) => {
  const series: any = await assertOrganizer(seriesId, userId);

  const match: any = await Match.findOne({ _id: matchId, seriesId });

  if (!match) {
    throw new AppError(
      "Ye match is series ka nahi hai.",
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

  match.scorerUserId = targetUserId
    ? new mongoose.Types.ObjectId(targetUserId)
    : series.userId;

  await match.save();

  const newScorer = String(match.scorerUserId);

  if (previous && previous !== newScorer) {
    await createNotification({
      receiverId: previous,
      actorId: String(userId),
      type: NOTIFICATION_TYPES.SERIES_SCORER_REVOKED,
      title: "Scoring rights removed",
      message: `Ab tum "${series.seriesName}" ka ye match score nahi kar sakte.`,
      data: { seriesId: String(seriesId), matchId: String(matchId) },
    }).catch(() => undefined);
  }

  if (targetUserId && previous !== newScorer) {
    await createNotification({
      receiverId: newScorer,
      actorId: String(userId),
      type: NOTIFICATION_TYPES.SERIES_SCORER_ASSIGNED,
      title: "You are scoring",
      message: `"${series.seriesName}" ka ek match tumhe score karna hai.`,
      data: { seriesId: String(seriesId), matchId: String(matchId) },
    }).catch(() => undefined);
  }

  return match;
};

/*
|--------------------------------------------------------------------------
| Scoreline
|--------------------------------------------------------------------------
|
| Counted from scratch over the completed matches - never incremented.
|
| The reason is the same one behind the tournament's points table: a
| scorer undoes balls, and a match result can flip during a correction. An
| incremented counter drifts the first time that happens and drifts
| silently: nothing ever tells you the scoreline is wrong, it just is.
|
| At most fifteen documents, so recomputing costs nothing.
|
| A series is DECIDED when one side's wins exceed what the other can still
| reach. That does not stop the remaining matches - they are scheduled,
| the ground is booked and both teams turn up - it just lets the app say
| "series won, dead rubber to come", which is what everyone at the ground
| already knows.
|
*/

export const recomputeScoreline = async (seriesId: string) => {
  const series: any = await Series.findById(seriesId);

  if (!series) return null;

  const matches: any[] = await Match.find({ seriesId })
    .select("status winnerTeam result")
    .lean();

  const completed = matches.filter((m) => m.status === "completed");

  let a = 0;

  let b = 0;

  let drawn = 0;

  for (const m of completed) {
    if (!m.winnerTeam) {
      /* A tie, a no-result, an abandoned match - all "not won by either". */
      drawn++;

      continue;
    }

    if (String(m.winnerTeam) === String(series.teamA)) a++;
    else if (String(m.winnerTeam) === String(series.teamB)) b++;
    else drawn++;
  }

  series.teamAWins = a;

  series.teamBWins = b;

  series.drawnMatches = drawn;

  const remaining = series.totalMatches - completed.length;

  const decided = a > b + remaining || b > a + remaining;

  if (decided && !series.decidedAt) {
    series.decidedAt = new Date();
  }

  /*
  | Only the LAST match completing ends the series. Deciding it early
  | would mark it completed while fixtures are still to be played, and
  | those matches would drop out of every "upcoming" feed on the app.
  */

  if (completed.length >= series.totalMatches) {
    series.status = "completed";

    series.winnerTeam =
      a > b ? series.teamA : b > a ? series.teamB : null;
  } else if (completed.length > 0 && series.status === "scheduled") {
    series.status = "live";
  }

  await series.save();

  return series;
};

/*
| Called from match.service when a match completes. Fire-and-forget, like
| the tournament's standings recompute - a scoreline that is one refresh
| behind is a far smaller problem than a result that fails to save because
| the scoreline write threw.
*/

export const recomputeScorelineForMatch = async (matchId: string) => {
  const match: any = await Match.findById(matchId).select("seriesId").lean();

  if (!match?.seriesId) return;

  await recomputeScoreline(String(match.seriesId));
};

/*
|--------------------------------------------------------------------------
| Awards
|--------------------------------------------------------------------------
|
| The same counter the tournament uses, pointed at this series' matches.
| Sharing it is the point: "Most Sixes" must mean exactly the same thing
| in a series as in a tournament, and two implementations would drift.
|
*/

export const getAwards = async (seriesId: string) => {
  const series: any = await Series.findById(seriesId)
    .select("awards prizes prizePool status seriesName")
    .lean();

  if (!series) {
    throw new AppError("Series not found.", HTTP_STATUS.NOT_FOUND);
  }

  const { awards, leaderboards } = await resolveAwards(series.awards ?? [], {
    seriesId,
  });

  return {
    awards,
    leaderboards,
    prizes: series.prizes ?? [],
    prizePool: series.prizePool ?? 0,
  };
};

export const setAwardWinner = async (
  seriesId: string,
  userId: string,
  metric: string,
  playerId: string | null,
) => {
  const series: any = await assertOrganizer(seriesId, userId);

  const award = (series.awards ?? []).find((a: any) => a.metric === metric);

  if (!award) {
    throw new AppError(
      "Ye award is series mein hai hi nahi.",
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

  await series.save();

  return getAwards(seriesId);
};

export const getSeriesStats = async (seriesId: string) => {
  const boards = await buildLeaderboards({ seriesId });

  return {
    batting: (boards.most_runs ?? []).map((r) => ({
      playerId: r.playerId,
      name: r.name,
      profileImage: r.profileImage ?? null,
      runs: r.value,
      balls: r.meta?.balls ?? 0,
      fours: r.meta?.fours ?? 0,
      sixes: r.meta?.sixes ?? 0,
      strikeRate: r.meta?.strikeRate ?? 0,
    })),

    bowling: (boards.most_wickets ?? []).map((r) => ({
      playerId: r.playerId,
      name: r.name,
      profileImage: r.profileImage ?? null,
      wickets: r.value,
      economy: r.meta?.economy ?? 0,
      conceded: r.meta?.conceded ?? 0,
    })),

    boards,
  };
};

/*
|--------------------------------------------------------------------------
| Reads
|--------------------------------------------------------------------------
*/

export const listSeries = async (userId: string, filter: string) => {
  const base: any = { isPublished: true };

  if (filter === "live") base.status = { $in: ["live", "scheduled"] };

  if (filter === "upcoming") {
    base.status = { $in: ["published", "scheduled"] };
  }

  if (filter === "completed") base.status = "completed";

  /*
  | "mine" ignores isPublished on purpose - the organizer has to be able
  | to find their own draft, and an invited captain has to find a series
  | their team is in whatever its visibility.
  */

  if (filter === "mine") {
    const myTeams: any[] = await Team.find({
      $or: [{ captainId: userId }, { userId }, { viceCaptainId: userId }],
    })
      .select("_id")
      .lean();

    const teamIds = myTeams.map((t) => t._id);

    const list = await Series.find({
      $or: [
        { userId },
        { opponentCaptainUserId: userId },
        { teamA: { $in: teamIds } },
        { teamB: { $in: teamIds } },
      ],
    })
      .populate("teamA", "teamName logo")
      .populate("teamB", "teamName logo")
      .populate("winnerTeam", "teamName logo")
      .sort({ createdAt: -1 })
      .lean();

    return list;
  }

  return Series.find(base)
    .populate("teamA", "teamName logo")
    .populate("teamB", "teamName logo")
    .populate("winnerTeam", "teamName logo")
    .sort({ startDate: -1, createdAt: -1 })
    .limit(50)
    .lean();
};

export const getSeriesById = async (seriesId: string, userId?: string) => {
  const series: any = await Series.findById(seriesId)
    .populate("userId", "name phone")
    .populate("teamA", "teamName logo captainId")
    .populate("teamB", "teamName logo captainId")
    .populate("winnerTeam", "teamName logo")
    .lean();

  if (!series) {
    throw new AppError("Series not found.", HTTP_STATUS.NOT_FOUND);
  }

  const isOrganizer =
    String(series.userId?._id ?? series.userId) === String(userId);

  /*
  |--------------------------------------------------------------------------
  | Who is this person
  |--------------------------------------------------------------------------
  |
  | Same three roles as a tournament, and the same rule about what they
  | gate: only the Settings tab. Fixtures, scorecards, the scoreline,
  | stats and awards are open to everyone, because a series is a public
  | event and hiding its result from people who did not play would be
  | pointless.
  |
  | A participant here is a captain of either side or a player on either
  | team's roster. Unlike a tournament there is no registered squad to
  | check against - a series does not lock one - so the team roster is
  | the honest answer to "are you in this".
  |
  */

  const captainIds = [
    series.teamA?.captainId,
    series.teamB?.captainId,
    series.opponentCaptainUserId,
  ]
    .filter(Boolean)
    .map(String);

  const isCaptainHere = captainIds.includes(String(userId));

  let isSquadMember = false;

  if (userId && !isCaptainHere && !isOrganizer) {
    const me: any = await Player.findOne({ userId }).select("_id").lean();

    if (me) {
      const teamIds = [series.teamA?._id, series.teamB?._id].filter(Boolean);

      isSquadMember = !!(await Team.exists({
        _id: { $in: teamIds },
        players: me._id,
      }));
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
  | A pending invite addressed to THIS user, surfaced at the top level so
  | the detail screen can show the accept strip without a second request.
  */

  const myInvite =
    series.opponentStatus === "pending" &&
    String(series.opponentCaptainUserId) === String(userId)
      ? {
          teamId: String(series.teamB?._id ?? series.teamB),
          teamName: series.teamB?.teamName ?? "Team",
        }
      : null;

  const played = await Match.countDocuments({
    seriesId,
    status: "completed",
  });

  return {
    ...series,

    isOrganizer,

    isParticipant,

    myRole,

    myInvite,

    playedMatches: played,

    remainingMatches: Math.max(0, (series.totalMatches ?? 0) - played),
  };
};

export const getFixtures = async (seriesId: string) => {
  const matches: any[] = await Match.find({ seriesId })
    .populate("teamA", "teamName logo")
    .populate("teamB", "teamName logo")
    .populate("winnerTeam", "teamName logo")
    .select(
      "matchTitle status startTime venueName teamA teamB winnerTeam result seriesMatchNumber scorerUserId",
    )
    .sort({ seriesMatchNumber: 1 })
    .lean();

  /*
  | Returned in the SAME round-grouped shape the tournament's fixtures
  | use, so the app's FixtureList component renders both with no branch.
  | A series has one "round" holding every match, which is exactly what a
  | series is.
  */

  return [
    {
      label: "Fixtures",
      roundNumber: 1,
      matches,
    },
  ];
};

export const getScoreline = async (seriesId: string) => {
  const series: any = await recomputeScoreline(seriesId);

  if (!series) {
    throw new AppError("Series not found.", HTTP_STATUS.NOT_FOUND);
  }

  const teams: any[] = await Team.find({
    _id: { $in: [series.teamA, series.teamB].filter(Boolean) },
  })
    .select("teamName logo")
    .lean();

  const nameOf = (id: any) =>
    teams.find((t) => String(t._id) === String(id))?.teamName ?? "Team";

  const logoOf = (id: any) =>
    teams.find((t) => String(t._id) === String(id))?.logo ?? null;

  return {
    teamA: {
      teamId: String(series.teamA),
      teamName: nameOf(series.teamA),
      logo: logoOf(series.teamA),
      wins: series.teamAWins,
    },

    teamB: series.teamB
      ? {
          teamId: String(series.teamB),
          teamName: nameOf(series.teamB),
          logo: logoOf(series.teamB),
          wins: series.teamBWins,
        }
      : null,

    drawn: series.drawnMatches,

    played: series.teamAWins + series.teamBWins + series.drawnMatches,

    total: series.totalMatches,

    decided: !!series.decidedAt,

    status: series.status,

    winnerTeam: series.winnerTeam ? String(series.winnerTeam) : null,
  };
};

/*
|--------------------------------------------------------------------------
| Cancel
|--------------------------------------------------------------------------
|
| Played matches stand. They happened, their scorecards are real, and the
| players' career stats already count them - erasing that because the rest
| of the series fell through would be a lie about games that were played.
|
| Only the unplayed fixtures are cancelled.
|
*/

export const cancelSeries = async (seriesId: string, userId: string) => {
  const series: any = await assertOrganizer(seriesId, userId);

  series.status = "cancelled";

  await series.save();

  await Match.updateMany(
    { seriesId, status: { $in: ["draft", "upcoming"] } },
    { status: "cancelled" },
  );

  if (series.opponentCaptainUserId) {
    await createNotification({
      receiverId: String(series.opponentCaptainUserId),
      actorId: String(userId),
      type: NOTIFICATION_TYPES.SERIES_CANCELLED,
      title: "Series cancelled",
      message: `"${series.seriesName}" cancel ho gaya hai.`,
      data: { seriesId: String(series._id) },
    }).catch(() => undefined);
  }

  return series;
};

export const deleteSeries = async (seriesId: string, userId: string) => {
  await assertOrganizer(seriesId, userId);

  const played = await Match.exists({ seriesId, status: "completed" });

  if (played) {
    throw new AppError(
      "Khele hue match wale series ko delete nahi kar sakte — cancel kar do.",
      HTTP_STATUS.CONFLICT,
    );
  }

  await Match.deleteMany({ seriesId });

  await Series.findByIdAndDelete(seriesId);

  return { deleted: true };
};
