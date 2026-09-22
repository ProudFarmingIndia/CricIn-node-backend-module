/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| fixtures.service.ts
|
| Description:
| Turns "eight teams, League + Knockout" into real Match documents with
| real dates and real grounds.
|
| THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS
| A fixture IS a Match. Not a Fixture model that later becomes a match, not
| a schedule table pointing at matches - the same `Match` document the rest
| of CricIn already knows how to score, stream and put on a scorecard.
|
| That means toss, squad selection, PIN, the scoring pad, live streaming
| and player stats all work on tournament matches without a single line
| changed in any of them. A separate Fixture model would have meant
| reimplementing each of those, or a conversion step that can fail halfway.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import Match from "../matches/match.model";
import Tournament from "./tournament.model";
import TournamentTeam from "./tournamentTeam.model";

import { playoffShape } from "./tournament.constants";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

/*
| Every Match needs its two PINs, whoever creates it. They used to be
| generated only inside match.service.createMatch, which this file does not
| go through - so every tournament fixture came out with null PINs, the
| start-match gate found nothing to check, and the organizer could start a
| game neither captain had agreed to.
*/
import { newMatchPins } from "../../shared/utils/matchPin";

/*
|--------------------------------------------------------------------------
| Round Robin - the circle method
|--------------------------------------------------------------------------
|
| Fix the first team, rotate everyone else one position each round. With N
| teams it produces exactly N-1 rounds and N(N-1)/2 matches, and every team
| plays once per round.
|
| Odd N gets a phantom BYE team so the arithmetic still works; whoever is
| drawn against BYE simply rests that round.
|
| Why not just nest two loops over every pair? Because that produces the
| right MATCHES in the wrong ORDER - team 1 would play all its games first
| and then sit idle. Rounds are what make a schedule playable.
|
*/

export const roundRobinRounds = (teamCount: number): [number, number][][] => {
  const odd = teamCount % 2 === 1;

  /* -1 is the phantom. Indices are 0-based team positions. */
  const ids = Array.from({ length: teamCount }, (_, i) => i);

  if (odd) ids.push(-1);

  const n = ids.length;

  const fixed = ids[0]!;

  let rotating = ids.slice(1);

  const rounds: [number, number][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];

    const first = rotating[0]!;

    if (fixed !== -1 && first !== -1) round.push([fixed, first]);

    /*
    | The rest of the round: walk inwards from both ends of the rotating
    | list. With m entries after the fixed team, that is floor((m-1)/2)
    | pairs, which together with the fixed pairing gives every team
    | exactly one match per round.
    */

    for (let i = 1; i <= Math.floor((rotating.length - 1) / 2); i++) {
      const a = rotating[i]!;
      const b = rotating[rotating.length - i]!;

      if (a !== -1 && b !== -1) round.push([a, b]);
    }

    rounds.push(round);

    /* Rotate right: last element moves to the front. */
    rotating = [rotating[rotating.length - 1]!, ...rotating.slice(0, -1)];
  }

  return rounds;
};

/*
|--------------------------------------------------------------------------
| Knockout bracket
|--------------------------------------------------------------------------
|
| A bracket needs a power of two. Six teams need eight slots, so two teams
| get a bye straight into round two - and the byes go to the top seeds,
| which is the whole reason seeding exists.
|
| Total matches is always N-1, whatever N is: every match eliminates
| exactly one team, and one team is left standing.
|
| Rounds after the first hold PLACEHOLDERS - "winner of match 3" - because
| nobody knows who plays there yet. That is why Match.teamA and teamB have
| to accept null; see the model change.
|
*/

type BracketMatch = {
  roundNumber: number;
  matchNumber: number;
  /* Seed index, or null when it depends on an earlier match. */
  a: number | null;
  b: number | null;
  aFrom: number | null;
  bFrom: number | null;
  label: string;
};

export const knockoutBracket = (teamCount: number): BracketMatch[] => {
  let size = 1;

  while (size < teamCount) size *= 2;

  const byes = size - teamCount;

  const matches: BracketMatch[] = [];

  let matchNumber = 1;

  /*
  | Round 1: the teams without a bye. Seeds 0..(byes-1) skip it, so the
  | teams that must play are byes..teamCount-1, paired highest against
  | lowest so the strongest of them meets the weakest.
  */

  const roundOnePlayers: number[] = [];

  for (let i = byes; i < teamCount; i++) roundOnePlayers.push(i);

  const roundOneMatchIds: number[] = [];

  /*
  | Rounds are named by how many teams are left, not by their number. Four
  | teams entering a round makes it a Semi Final whether it is the first
  | round or the third - calling it "Round 1" on a four-team knockout is
  | just wrong on the fixture list.
  */

  const roundLabel = (teamsRemaining: number, fallbackRound: number) =>
    teamsRemaining === 2
      ? "Final"
      : teamsRemaining === 4
        ? "Semi Final"
        : teamsRemaining === 8
          ? "Quarter Final"
          : `Round ${fallbackRound}`;

  const roundOneLabel = roundLabel(teamCount, 1);

  for (let i = 0; i < roundOnePlayers.length / 2; i++) {
    const a = roundOnePlayers[i]!;
    const b = roundOnePlayers[roundOnePlayers.length - 1 - i]!;

    matches.push({
      roundNumber: 1,
      matchNumber,
      a,
      b,
      aFrom: null,
      bFrom: null,
      label: roundOneLabel,
    });

    roundOneMatchIds.push(matchNumber);

    matchNumber++;
  }

  /*
  | Everything after round 1. Each round pairs up whatever came out of the
  | previous one, with the bye seeds joining at round 2.
  */

  let slots: { seed: number | null; from: number | null }[] = [
    ...Array.from({ length: byes }, (_, i) => ({ seed: i, from: null })),
    ...roundOneMatchIds.map((id) => ({ seed: null, from: id })),
  ];

  let roundNumber = roundOnePlayers.length ? 2 : 1;

  while (slots.length > 1) {
    const next: { seed: number | null; from: number | null }[] = [];

    const label = roundLabel(slots.length, roundNumber);

    for (let i = 0; i < slots.length; i += 2) {
      const s1 = slots[i]!;
      const s2 = slots[i + 1]!;

      matches.push({
        roundNumber,
        matchNumber,
        a: s1.seed,
        b: s2.seed,
        aFrom: s1.from,
        bFrom: s2.from,
        label,
      });

      next.push({ seed: null, from: matchNumber });

      matchNumber++;
    }

    slots = next;

    roundNumber++;
  }

  return matches;
};

/*
|--------------------------------------------------------------------------
| Dates
|--------------------------------------------------------------------------
|
| Walks forward from startDate, skipping days the organizer did not mark as
| playable, and putting `matchesPerDay` fixtures on each day it accepts.
|
| Deliberately dumb about rest: a round-robin round is dealt out in order,
| so with 2 matches a day a team can end up playing on consecutive days.
| Local tournaments run on weekends and that is exactly what people want;
| forcing rest gaps would stretch an eight-team league across two months.
|
| The 400-day ceiling is a guard, not a feature - it exists so a bad
| playDays value (an empty array, say) cannot spin forever.
|
*/

const nextPlayableDate = (from: Date, playDays: number[]): Date => {
  const days = playDays.length ? playDays : [0, 1, 2, 3, 4, 5, 6];

  const d = new Date(from);

  for (let i = 0; i < 400; i++) {
    if (days.includes(d.getDay())) return d;

    d.setDate(d.getDate() + 1);
  }

  return d;
};

export const buildSchedule = (
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

    /*
    | Two matches on one day start morning and afternoon rather than at the
    | same minute - a schedule where every fixture says 09:00 is not a
    | schedule.
    */

    const slot = new Date(cursor);

    slot.setHours(9 + placedToday * 4, 0, 0, 0);

    out.push(slot);

    placedToday++;
  }

  return out;
};

/*
|--------------------------------------------------------------------------
| Generate
|--------------------------------------------------------------------------
|
| The one entry point. Reads the locked field of teams, builds the right
| shape for the format, and writes real Match documents.
|
| Refuses to run twice. Regenerating over played matches would delete
| scorecards, and there is no version of that which is recoverable.
|
*/

export const generateFixtures = async (tournamentId: string) => {
  const tournament: any = await Tournament.findById(tournamentId);

  if (!tournament) {
    throw new AppError("Tournament not found.", HTTP_STATUS.NOT_FOUND);
  }

  if (tournament.fixturesGeneratedAt) {
    throw new AppError(
      "Fixtures pehle hi ban chuke hain. Dobara banane se khele hue match mit jayenge.",
      HTTP_STATUS.CONFLICT,
    );
  }

  const entries: any[] = await TournamentTeam.find({
    tournamentId,
    status: "accepted",
  })
    .sort({ joinedAt: 1, createdAt: 1 })
    .lean();

  if (entries.length < 2) {
    throw new AppError(
      "Fixtures banane ke liye kam se kam 2 teams chahiye.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /*
  | Seeding is written here, not at accept time, because a team that
  | declines and re-accepts would otherwise keep a stale number and leave a
  | gap in the sequence.
  */

  await Promise.all(
    entries.map((e, i) =>
      TournamentTeam.updateOne({ _id: e._id }, { seed: i + 1 }),
    ),
  );

  const teamIds = entries.map((e) => String(e.teamId));

  const grounds: any[] = tournament.grounds?.length
    ? tournament.grounds
    : [{ name: "TBD", address: "" }];

  const format = tournament.format;

  type Planned = {
    a: string | null;
    b: string | null;
    stage: string;
    roundNumber: number;
    matchNumber: number;
    label: string;
    dependsOn: { a: number | null; b: number | null };
  };

  const planned: Planned[] = [];

  let matchNumber = 1;

  /* ── League part ─────────────────────────────────────────────── */

  if (format === "League" || format === "League+Knockout") {
    const rounds = roundRobinRounds(teamIds.length);

    rounds.forEach((round, ri) => {
      round.forEach(([x, y]) => {
        planned.push({
          a: teamIds[x]!,
          b: teamIds[y]!,
          stage: "league",
          roundNumber: ri + 1,
          matchNumber: matchNumber++,
          label: `Round ${ri + 1}`,
          dependsOn: { a: null, b: null },
        });
      });
    });
  }

  /* ── Pure knockout ───────────────────────────────────────────── */

  if (format === "Knockout") {
    const bracket = knockoutBracket(teamIds.length);

    bracket.forEach((m) => {
      planned.push({
        a: m.a === null ? null : teamIds[m.a]!,
        b: m.b === null ? null : teamIds[m.b]!,
        stage: "knockout",
        roundNumber: m.roundNumber,
        matchNumber: matchNumber++,
        label: m.label,
        dependsOn: { a: m.aFrom, b: m.bFrom },
      });
    });
  }

  /* ── Playoffs after a league ─────────────────────────────────── */

  if (format === "League+Knockout") {
    const shape = playoffShape(tournament.playoffShape);

    /*
    | Every playoff fixture is a placeholder - the league has not been
    | played, so nobody knows who is in them. They are created now anyway
    | so the schedule is complete and the dates are booked; the teams get
    | filled in when the league finishes.
    */

    const add = (label: string, roundNumber: number) => {
      planned.push({
        a: null,
        b: null,
        stage: "playoff",
        roundNumber,
        matchNumber: matchNumber++,
        label,
        dependsOn: { a: null, b: null },
      });
    };

    const leagueRounds = planned.filter((p) => p.stage === "league").length
      ? Math.max(...planned.map((p) => p.roundNumber))
      : 0;

    if (shape?.key === "final_only") {
      add("Final", leagueRounds + 1);
    } else if (shape?.key === "top4_semis") {
      add("Semi Final 1", leagueRounds + 1);
      add("Semi Final 2", leagueRounds + 1);
      add("Final", leagueRounds + 2);
    } else if (shape?.key === "ipl_playoffs") {
      add("Qualifier 1", leagueRounds + 1);
      add("Eliminator", leagueRounds + 1);
      add("Qualifier 2", leagueRounds + 2);
      add("Final", leagueRounds + 3);
    }
  }

  /* ── Dates and grounds ───────────────────────────────────────── */

  const dates = buildSchedule(
    planned.length,
    tournament.startDate || new Date(),
    tournament.playDays || [],
    tournament.matchesPerDay || 2,
  );

  const created = [];

  for (let i = 0; i < planned.length; i++) {
    const p = planned[i]!;

    const ground = grounds[i % grounds.length];

    /*
    | A placeholder fixture is created as a draft so the model's
    | conditional `required` on teamA/teamB lets it through - the same
    | mechanism the "Go Live before teams" flow uses. It flips to
    | "upcoming" the moment both teams are known.
    */

    const isPlaceholder = !p.a || !p.b;

    const doc: any = await Match.create({
      userId: tournament.userId,

      matchTitle: `${tournament.tournamentName} · ${p.label}`,

      matchType: tournament.matchType,

      overs: tournament.overs,

      teamA: p.a ? new mongoose.Types.ObjectId(p.a) : undefined,
      teamB: p.b ? new mongoose.Types.ObjectId(p.b) : undefined,

      /*
      | Generated even for a playoff placeholder whose teams are not known
      | yet. The PIN belongs to the SLOT, not to whoever eventually fills
      | it - so when the bracket resolves, both captains already have a
      | code waiting rather than needing one minted at kick-off.
      */
      ...newMatchPins(),

      status: isPlaceholder ? "draft" : "upcoming",

      scheduledStartTime: dates[i],
      startTime: dates[i],

      venueName: ground?.name || "",
      groundId: ground?.groundId || undefined,

      /*
      | The organizer scores by default. They can hand any single match to
      | somebody else afterwards, and take it back whenever they like.
      */

      scorerUserId: tournament.userId,

      tournamentId: tournament._id,

      tournamentRound: {
        stage: p.stage,
        roundNumber: p.roundNumber,
        matchNumber: p.matchNumber,
        label: p.label,
        dependsOnMatchA: p.dependsOn.a,
        dependsOnMatchB: p.dependsOn.b,
      },
    } as any);

    created.push(doc);
  }

  tournament.fixturesGeneratedAt = new Date();

  tournament.status = "registration_closed";

  if (dates.length) {
    tournament.startDate = tournament.startDate || dates[0];
    tournament.endDate = dates[dates.length - 1];
  }

  await tournament.save();

  return {
    generated: created.length,
    teams: teamIds.length,
    rounds: Math.max(...planned.map((p) => p.roundNumber), 0),
    matches: created.map((m: any) => ({
      _id: m._id,
      label: m.tournamentRound?.label,
      matchNumber: m.tournamentRound?.matchNumber,
      startTime: m.startTime,
      venueName: m.venueName,
    })),
  };
};

/*
|--------------------------------------------------------------------------
| Preview
|--------------------------------------------------------------------------
|
| What the create form shows while the organizer is still choosing: how
| many matches this format will actually produce. Pure arithmetic, no
| database - so it can be called on every keystroke.
|
*/

export const previewFixtureCount = (
  format: string,
  teams: number,
  playoffKey: string,
) => {
  if (teams < 2) return { matches: 0, rounds: 0 };

  if (format === "Knockout") {
    return { matches: teams - 1, rounds: Math.ceil(Math.log2(teams)) };
  }

  const league = (teams * (teams - 1)) / 2;

  const rounds = teams % 2 === 1 ? teams : teams - 1;

  if (format === "League") return { matches: league, rounds };

  const shape = playoffShape(playoffKey);

  return {
    matches: league + (shape?.matches ?? 0),
    rounds: rounds + (shape?.key === "ipl_playoffs" ? 3 : shape ? 2 : 0),
  };
};
