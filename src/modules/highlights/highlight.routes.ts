import { Router } from "express";

import { getHighlights, getMatchHighlights } from "./highlight.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Highlight Routes
|--------------------------------------------------------------------------
|
| Mounted at /api/highlights.
|
| The literal "/match/:matchId" is registered before the bare "/" only for
| readability - they cannot collide, since one has extra path segments.
|
*/

// GET /api/highlights?range=today|week|month|all&city=&state=&country=&limit=
router.get("/", authMiddleware, getHighlights);

// GET /api/highlights/match/:matchId
router.get("/match/:matchId", authMiddleware, getMatchHighlights);

export default router;
