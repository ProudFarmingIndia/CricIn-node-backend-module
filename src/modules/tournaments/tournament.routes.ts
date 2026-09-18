/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| tournament.routes.ts
|
| Mounted at /api/tournaments
|
| ORDER MATTERS. Express matches in declaration order, so every static
| path ("/options", "/preview") sits above "/:id". Reversed, "options"
| would be read as a tournament id and every request would fail with a
| Mongoose cast error rather than a missing-route error - which is a
| genuinely confusing way to lose an afternoon.
|
|--------------------------------------------------------------------------
*/

import { Router } from "express";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

import * as C from "./tournament.controller";

const router = Router();

/* ── Static first ──────────────────────────────────────────────── */

router.get("/options", authMiddleware, C.getOptions);

router.get("/preview", authMiddleware, C.preview);

/* ── Collection ────────────────────────────────────────────────── */

router.get("/", authMiddleware, C.list);

router.post("/", authMiddleware, C.create);

/* ── One tournament ────────────────────────────────────────────── */

router.get("/:id", authMiddleware, C.detail);

router.put("/:id", authMiddleware, C.update);

router.delete("/:id", authMiddleware, C.remove);

router.put("/:id/visibility", authMiddleware, C.visibility);

router.put("/:id/cancel", authMiddleware, C.cancel);

/* ── Teams ─────────────────────────────────────────────────────── */

router.post("/:id/invite", authMiddleware, C.invite);

router.put("/:id/respond", authMiddleware, C.respond);

router.post("/:id/join-request", authMiddleware, C.joinRequest);

router.put("/:id/join-request/respond", authMiddleware, C.respondJoinRequest);

router.delete("/:id/invite/:teamId", authMiddleware, C.cancelInvite);

router.delete("/:id/teams/:teamId", authMiddleware, C.removeTeam);

router.put("/:id/teams/:teamId/withdraw", authMiddleware, C.withdraw);

router.get("/:id/teams/:teamId/squad", authMiddleware, C.getSquad);

router.put("/:id/teams/:teamId/squad", authMiddleware, C.setSquad);

/*
| Fixtures, standings and stats.
|
| "/fixtures", "/points-table" and "/stats" are all static under /:id, so
| they cannot collide with anything - but "/fixtures/:matchId" must stay
| below "/fixtures" for the same declaration-order reason as above.
*/

router.post("/:id/generate-fixtures", authMiddleware, C.generate);

router.get("/:id/fixtures", authMiddleware, C.fixtures);

router.put("/:id/fixtures/:matchId", authMiddleware, C.editFixture);

router.put("/:id/fixtures/:matchId/scorer", authMiddleware, C.assignScorer);

router.get("/:id/points-table", authMiddleware, C.pointsTable);

router.get("/:id/stats", authMiddleware, C.stats);

/*
| Awards. Reading is open to everyone - the leaderboards are the same
| public information the stats tab shows. Writing a winner is
| organizer-only, enforced in the service.
*/

router.get("/:id/awards", authMiddleware, C.awards);

router.put("/:id/awards/:metric/winner", authMiddleware, C.setAwardWinner);

export default router;
