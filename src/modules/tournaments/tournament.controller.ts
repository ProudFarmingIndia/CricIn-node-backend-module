/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| tournament.controller.ts
|
| Description:
| Thin wrappers. Every one of them does the same three things: pull the
| user off the request, call the service, and turn a thrown AppError into
| the status code it carries. No logic lives here on purpose - it is the
| service that gets tested and reused.
|
|--------------------------------------------------------------------------
*/

import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as Service from "./tournament.service";
import { previewFixtureCount } from "./fixtures.service";

import {
  PLAYOFF_SHAPES,
  TOURNAMENT_FORMATS,
  SQUAD_MIN,
  SQUAD_MAX,
  DEFAULT_POINTS,
  AWARD_METRICS,
  DEFAULT_AWARD_ROWS,
} from "./tournament.constants";

const ok = (res: Response, data: any, code = 200) =>
  res.status(code).json({ success: true, data });

const fail = (res: Response, error: any, fallback: string) =>
  res.status(error?.statusCode || 400).json({
    success: false,
    message: error?.message || fallback,
  });

/*
|--------------------------------------------------------------------------
| Options
|--------------------------------------------------------------------------
|
| Everything the create form needs to render its pickers - formats, playoff
| shapes with their guidance copy, squad limits, default points.
|
| Served rather than hardcoded in the app so a new playoff shape appears in
| the picker without an app release, and so the copy explaining each shape
| lives next to the code that implements it.
|
*/

export const getOptions = async (_req: AuthRequest, res: Response) => {
  ok(res, {
    formats: TOURNAMENT_FORMATS,
    playoffShapes: PLAYOFF_SHAPES,
    squad: { min: SQUAD_MIN, max: SQUAD_MAX },
    defaultPoints: DEFAULT_POINTS,

    /*
    | The award catalogue, shipped to the app rather than hardcoded there.
    | Each entry carries its own label, hint, unit and whether the app can
    | count it - so adding "Most Maidens" here puts it in the organizer's
    | picker with its explanation, and only its icon has to be added on
    | the frontend.
    */
    awardMetrics: AWARD_METRICS,

    defaultAwards: DEFAULT_AWARD_ROWS,
  });
};

/* Live arithmetic for the create form - no database, safe on every tap. */
export const preview = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    previewFixtureCount(
      String(req.query.format || "League"),
      Number(req.query.teams || 0),
      String(req.query.playoffShape || "none"),
    ),
  );
};

export const create = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.createTournament(req.user.userId, req.body), 201);
  } catch (e) {
    fail(res, e, "Tournament nahi ban paya.");
  }
};

export const list = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.listTournaments(
        req.user.userId,
        String(req.query.filter || "upcoming"),
      ),
    );
  } catch (e) {
    fail(res, e, "Tournaments load nahi hue.");
  }
};

export const detail = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.getTournamentById(
        req.params.id as string,
        req.user?.userId,
      ),
    );
  } catch (e) {
    fail(res, e, "Tournament load nahi hua.");
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.updateTournament(
        req.params.id as string,
        req.user.userId,
        req.body,
      ),
    );
  } catch (e) {
    fail(res, e, "Update nahi hua.");
  }
};

export const remove = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.deleteTournament(req.params.id as string, req.user.userId));
  } catch (e) {
    fail(res, e, "Delete nahi hua.");
  }
};

export const visibility = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.setVisibility(
        req.params.id as string,
        req.user.userId,
        req.body,
      ),
    );
  } catch (e) {
    fail(res, e, "Visibility change nahi hui.");
  }
};

/* ── Teams ─────────────────────────────────────────────────────── */

export const invite = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.inviteTeam(
        req.params.id as string,
        req.user.userId,
        req.body.teamId,
      ),
      201,
    );
  } catch (e) {
    fail(res, e, "Invite nahi gaya.");
  }
};

export const cancelInvite = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.cancelInvite(
        req.params.id as string,
        req.user.userId,
        req.params.teamId as string,
      ),
    );
  } catch (e) {
    fail(res, e, "Invite cancel nahi hua.");
  }
};

export const respond = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.respondToInvite(
        req.params.id as string,
        req.user.userId,
        req.body.teamId,
        req.body.accept === true,
      ),
    );
  } catch (e) {
    fail(res, e, "Jawab record nahi hua.");
  }
};

export const joinRequest = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.requestToJoin(
        req.params.id as string,
        req.user.userId,
        req.body.teamId,
      ),
      201,
    );
  } catch (e) {
    fail(res, e, "Request nahi gayi.");
  }
};

export const respondJoinRequest = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.respondToJoinRequest(
        req.params.id as string,
        req.user.userId,
        req.body.teamId,
        req.body.approve === true,
      ),
    );
  } catch (e) {
    fail(res, e, "Request handle nahi hui.");
  }
};

export const removeTeam = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.removeTeam(
        req.params.id as string,
        req.user.userId,
        req.params.teamId as string,
      ),
    );
  } catch (e) {
    fail(res, e, "Team hat nahi payi.");
  }
};

export const withdraw = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.withdrawTeam(
        req.params.id as string,
        req.user.userId,
        req.params.teamId as string,
      ),
    );
  } catch (e) {
    fail(res, e, "Withdraw nahi hua.");
  }
};

/* ── Awards ────────────────────────────────────────────────────── */

export const awards = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.getAwards(req.params.id as string));
  } catch (e) {
    fail(res, e, "Awards load nahi hue.");
  }
};

/* playerId: null hands the award back to the counter. */

export const setAwardWinner = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.setAwardWinner(
        req.params.id as string,
        req.user.userId,
        req.params.metric as string,
        req.body.playerId ?? null,
      ),
    );
  } catch (e) {
    fail(res, e, "Winner set nahi hua.");
  }
};

/* ── Squad ─────────────────────────────────────────────────────── */

export const getSquad = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.getSquad(
        req.params.id as string,
        req.params.teamId as string,
      ),
    );
  } catch (e) {
    fail(res, e, "Squad load nahi hui.");
  }
};

export const setSquad = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.setSquad(
        req.params.id as string,
        req.user.userId,
        req.params.teamId as string,
        req.body.playerIds || [],
        req.body.final === true,
      ),
    );
  } catch (e) {
    fail(res, e, "Squad save nahi hui.");
  }
};

/* ── Fixtures ──────────────────────────────────────────────────── */

export const generate = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.lockAndGenerate(req.params.id as string, req.user.userId));
  } catch (e) {
    fail(res, e, "Fixtures nahi bane.");
  }
};

export const fixtures = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.getFixtures(req.params.id as string));
  } catch (e) {
    fail(res, e, "Fixtures load nahi hue.");
  }
};

export const editFixture = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.updateFixture(
        req.params.id as string,
        req.user.userId,
        req.params.matchId as string,
        req.body,
      ),
    );
  } catch (e) {
    fail(res, e, "Fixture update nahi hua.");
  }
};

export const assignScorer = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.assignMatchScorer(
        req.params.id as string,
        req.user.userId,
        req.params.matchId as string,
        req.body.userId ?? null,
      ),
    );
  } catch (e) {
    fail(res, e, "Scorer assign nahi hua.");
  }
};

/* ── Standings & stats ─────────────────────────────────────────── */

export const pointsTable = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.getPointsTable(req.params.id as string));
  } catch (e) {
    fail(res, e, "Points table load nahi hui.");
  }
};

export const stats = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.getTournamentStats(req.params.id as string));
  } catch (e) {
    fail(res, e, "Stats load nahi hue.");
  }
};

export const cancel = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.cancelTournament(req.params.id as string, req.user.userId));
  } catch (e) {
    fail(res, e, "Cancel nahi hua.");
  }
};
