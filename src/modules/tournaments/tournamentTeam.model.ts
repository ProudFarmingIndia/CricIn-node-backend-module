/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| tournamentTeam.model.ts
|
| Description:
| One team's entry in one tournament: how it got in, where it is seeded,
| who it registered, and where it stands.
|
| WHY THIS IS A COLLECTION AND NOT AN ARRAY ON THE TOURNAMENT
| Four reasons, and any one of them is enough:
|
|   An invite has a life of its own - sent, seen, accepted, declined, and
|   sometimes re-sent to the same team a week later.
|
|   The squad is 15-20 players PER TOURNAMENT. That does not belong on the
|   Team document either, because a team plays several tournaments and
|   registers a different squad for each.
|
|   Standings change after every match. Twenty teams updating a nested
|   array inside one document is twenty writes fighting over one lock.
|
|   The points table is a sort. Sorting a sub-document array in Mongo means
|   loading the tournament and sorting in Node; as its own collection it is
|   an indexed query.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import { TEAM_ENTRY_STATUSES } from "./tournament.constants";

const tournamentTeamSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },

    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },

    /*
    | The captain at the time of invite. Stored rather than looked up
    | because captaincy changes, and an invite sent to yesterday's captain
    | should not silently become an invite to today's.
    */

    captainUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    status: {
      type: String,
      enum: TEAM_ENTRY_STATUSES,
      default: "invited",
      index: true,
    },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    respondedAt: { type: Date, default: null },

    /*
    |--------------------------------------------------------------------------
    | Seeding
    |--------------------------------------------------------------------------
    |
    | joinedAt is stamped the moment a captain accepts, and seed is written
    | from that order when the organizer locks the field: first to accept is
    | Team 1.
    |
    | This is deliberately mechanical. Any seeding the organizer controls -
    | by hand, by rating, by past results - is a seeding somebody can
    | accuse them of fixing. "Jo pehle aaya" is arguable by nobody.
    |
    */

    joinedAt: { type: Date, default: null },

    seed: { type: Number, default: null },

    group: { type: String, default: null },

    /*
    |--------------------------------------------------------------------------
    | Registered squad
    |--------------------------------------------------------------------------
    |
    | 15 minimum, 20 maximum, and every player who appears in this
    | tournament's matches must be in here. The count is enforced in the
    | service rather than by a schema validator so the captain can save a
    | half-filled squad and come back to it - the check runs when they
    | submit it as final.
    |
    */

    squad: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Player",
      },
    ],

    squadLockedAt: { type: Date, default: null },

    /*
    |--------------------------------------------------------------------------
    | Standings
    |--------------------------------------------------------------------------
    |
    | Recomputed from scratch after every completed match, never incremented.
    |
    | Incrementing looks cheaper and is wrong: undoing the last ball reopens
    | a finished match, and finishing it again would add the same result a
    | second time with nothing to show it had happened. Recomputing from the
    | match records is idempotent - run it ten times, same table.
    |
    | The four run/over totals are kept because Net Run Rate is a
    | tournament-wide figure, not an average of per-match rates. Balls, not
    | overs: 12.3 overs is 75 balls, and 12.3 + 12.3 is not 24.6.
    |
    */

    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    lost: { type: Number, default: 0 },
    tied: { type: Number, default: 0 },
    noResult: { type: Number, default: 0 },
    points: { type: Number, default: 0 },

    runsScored: { type: Number, default: 0 },
    ballsFaced: { type: Number, default: 0 },
    runsConceded: { type: Number, default: 0 },
    ballsBowled: { type: Number, default: 0 },

    nrr: { type: Number, default: 0 },

    /*
    | Set when a team walks out mid-tournament. Its played matches stand;
    | everything still to come is conceded to the opponent.
    */

    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/*
| One entry per team per tournament. Without this, a double-tapped invite
| button puts the same team in the draw twice and the fixture generator
| cheerfully schedules it against itself.
*/

tournamentTeamSchema.index({ tournamentId: 1, teamId: 1 }, { unique: true });

/* The points table query, in index order: filter, then sort. */
tournamentTeamSchema.index({ tournamentId: 1, points: -1, nrr: -1 });

/* "Which tournaments is my team in" - drives the Home section. */
tournamentTeamSchema.index({ teamId: 1, status: 1 });

const TournamentTeam = mongoose.model(
  "TournamentTeam",
  tournamentTeamSchema,
);

export default TournamentTeam;
