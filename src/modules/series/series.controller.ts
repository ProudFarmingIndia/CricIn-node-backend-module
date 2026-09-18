/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Series
|
| File:
| series.controller.ts
|
| Description:
| Thin wrappers, same as the tournament controller. Pull the user off the
| request, call the service, turn a thrown AppError into the status code
| it carries. No logic here on purpose - the service is what gets tested.
|
|--------------------------------------------------------------------------
*/

import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as Service from "./series.service";

import {
  SERIES_LENGTHS,
  MIN_MATCHES,
  MAX_MATCHES,
  DEFAULT_MATCHES,
  AWARD_METRICS,
  DEFAULT_SERIES_AWARD_ROWS,
} from "./series.constants";

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
| What the create form needs. The award catalogue is the SAME one the
| tournament serves - shared rather than copied, so "Most Sixes" cannot
| come to mean two different things in two parts of the app.
|
*/

export const getOptions = async (_req: AuthRequest, res: Response) => {
  ok(res, {
    lengths: SERIES_LENGTHS,
    matches: { min: MIN_MATCHES, max: MAX_MATCHES, default: DEFAULT_MATCHES },
    awardMetrics: AWARD_METRICS,
    defaultAwards: DEFAULT_SERIES_AWARD_ROWS,
  });
};

/* ── Collection ────────────────────────────────────────────────── */

export const create = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.createSeries(req.user.userId, req.body), 201);
  } catch (e) {
    fail(res, e, "Series nahi ban paya.");
  }
};

export const list = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.listSeries(
        req.user.userId,
        String(req.query.filter || "upcoming"),
      ),
    );
  } catch (e) {
    fail(res, e, "Series list nahi mili.");
  }
};

/* ── One series ────────────────────────────────────────────────── */

export const detail = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.getSeriesById(req.params.id as string, req.user.userId),
    );
  } catch (e) {
    fail(res, e, "Series nahi mila.");
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.updateSeries(
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
    ok(
      res,
      await Service.deleteSeries(req.params.id as string, req.user.userId),
    );
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
        req.body.isPublished === true,
      ),
    );
  } catch (e) {
    fail(res, e, "Visibility change nahi hui.");
  }
};

export const cancel = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.cancelSeries(req.params.id as string, req.user.userId),
    );
  } catch (e) {
    fail(res, e, "Cancel nahi hua.");
  }
};

/* ── Opponent ──────────────────────────────────────────────────── */

export const invite = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.inviteOpponent(
        req.params.id as string,
        req.user.userId,
        req.body.teamId,
      ),
    );
  } catch (e) {
    fail(res, e, "Invite nahi gaya.");
  }
};

export const respond = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.respondToInvite(
        req.params.id as string,
        req.user.userId,
        req.body.accept === true,
      ),
    );
  } catch (e) {
    fail(res, e, "Jawab record nahi hua.");
  }
};

/* ── Fixtures ──────────────────────────────────────────────────── */

export const generate = async (req: AuthRequest, res: Response) => {
  try {
    ok(
      res,
      await Service.generateFixtures(req.params.id as string, req.user.userId),
    );
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
    fail(res, e, "Scorer set nahi hua.");
  }
};

/* ── Results ───────────────────────────────────────────────────── */

export const scoreline = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.getScoreline(req.params.id as string));
  } catch (e) {
    fail(res, e, "Scoreline load nahi hui.");
  }
};

export const stats = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.getSeriesStats(req.params.id as string));
  } catch (e) {
    fail(res, e, "Stats load nahi hue.");
  }
};

export const awards = async (req: AuthRequest, res: Response) => {
  try {
    ok(res, await Service.getAwards(req.params.id as string));
  } catch (e) {
    fail(res, e, "Awards load nahi hue.");
  }
};

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
