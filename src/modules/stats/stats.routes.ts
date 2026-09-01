import { Router } from "express";

import {
  getLeaderboards,
  getTeamRankings,
  getFilterOptions,
} from "./stats.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Stats Routes
|--------------------------------------------------------------------------
|
| Mounted at /api/stats.
|
*/

// GET /api/stats/leaderboards?range=&city=&state=&country=&ballType=&matchType=
router.get("/leaderboards", authMiddleware, getLeaderboards);

// GET /api/stats/teams?city=&state=&country=&teamType=&minMatches=
router.get("/teams", authMiddleware, getTeamRankings);

// GET /api/stats/filters - the values that actually exist in the data
router.get("/filters", authMiddleware, getFilterOptions);

export default router;
