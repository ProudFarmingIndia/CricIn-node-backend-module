/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Series
|
| File:
| series.routes.ts
|
| Mounted at /api/series
|
| ORDER MATTERS, same as the tournament routes. Express matches in
| declaration order, so "/options" sits above "/:id" - reversed, "options"
| would be read as a series id and every request would fail with a
| Mongoose cast error rather than a missing-route error, which is a
| genuinely confusing way to lose an afternoon.
|
| Likewise "/fixtures/:matchId" stays below "/fixtures".
|
|--------------------------------------------------------------------------
*/

import { Router } from "express";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

import * as C from "./series.controller";

const router = Router();

/* ── Static first ──────────────────────────────────────────────── */

router.get("/options", authMiddleware, C.getOptions);

/* ── Collection ────────────────────────────────────────────────── */

router.get("/", authMiddleware, C.list);

router.post("/", authMiddleware, C.create);

/* ── One series ────────────────────────────────────────────────── */

router.get("/:id", authMiddleware, C.detail);

router.put("/:id", authMiddleware, C.update);

router.delete("/:id", authMiddleware, C.remove);

router.put("/:id/visibility", authMiddleware, C.visibility);

router.put("/:id/cancel", authMiddleware, C.cancel);

/* ── Opponent ──────────────────────────────────────────────────── */

router.post("/:id/invite", authMiddleware, C.invite);

router.put("/:id/respond", authMiddleware, C.respond);

/* ── Fixtures ──────────────────────────────────────────────────── */

router.post("/:id/generate-fixtures", authMiddleware, C.generate);

router.get("/:id/fixtures", authMiddleware, C.fixtures);

router.put("/:id/fixtures/:matchId", authMiddleware, C.editFixture);

router.put("/:id/fixtures/:matchId/scorer", authMiddleware, C.assignScorer);

/* ── Results ───────────────────────────────────────────────────── */

router.get("/:id/scoreline", authMiddleware, C.scoreline);

router.get("/:id/stats", authMiddleware, C.stats);

router.get("/:id/awards", authMiddleware, C.awards);

router.put("/:id/awards/:metric/winner", authMiddleware, C.setAwardWinner);

export default router;
