import { Router } from "express";

import {
  createMatch,
  getMatches,
  getMatchById,
  updateMatch,
  deleteMatch,
  startMatch,
  verifyMatchPin,
  completeMatch,
  updateMatchResult,
  getLiveMatch,
  getMatchSummary,
  getBattingScorecard,
  getBowlingScorecard,
  getFallOfWickets,
  getFullScorecard,
  getLiveMatchesFeed,
  getUpcomingMatchesFeed,
  getRecentMatchesFeed,
  getScorecardByInnings,
  getPartnerships,
  requestConfirmation,
  confirmMatch,
  rejectMatchConfirmation,
  resetMatchSetup,
  getOverByOver,
  transferScoring,
} from "./match.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";
import { validateMatch } from "../../shared/validators/match.validator";

const router = Router();

router.post("/", authMiddleware, validateMatch, createMatch);

/*
|--------------------------------------------------------------------------
| Match Feed - MUST Be Registered Before Any /:matchId Or /:id Route
|--------------------------------------------------------------------------
*/

router.get("/feed/live", authMiddleware, getLiveMatchesFeed);

router.get("/feed/upcoming", authMiddleware, getUpcomingMatchesFeed);

router.get("/feed/recent", authMiddleware, getRecentMatchesFeed);

router.get("/", authMiddleware, getMatches);

router.get("/:matchId/live", authMiddleware, getLiveMatch);

router.get("/:matchId/batting-scorecard", authMiddleware, getBattingScorecard);

router.get("/:matchId/scorecard", authMiddleware, getScorecardByInnings);

router.get("/:matchId/partnerships", authMiddleware, getPartnerships);

router.get("/:id", authMiddleware, getMatchById);

router.put("/:id", authMiddleware, updateMatch);

router.delete("/:id", authMiddleware, deleteMatch);

router.put("/:matchId/start", authMiddleware, startMatch);

router.post("/:matchId/verify-pin", authMiddleware, verifyMatchPin);

router.put("/:matchId/complete", authMiddleware, completeMatch);

router.put("/:matchId/result", authMiddleware, updateMatchResult);

router.put(
  "/:matchId/request-confirmation",
  authMiddleware,
  requestConfirmation,
);

router.put("/:matchId/confirm", authMiddleware, confirmMatch);

router.put(
  "/:matchId/reject-confirmation",
  authMiddleware,
  rejectMatchConfirmation,
);

router.get("/:matchId/summary", authMiddleware, getMatchSummary);

router.put("/:matchId/reset-setup", authMiddleware, resetMatchSetup);

router.get("/:matchId/over-by-over", authMiddleware, getOverByOver);

router.get("/:matchId/bowling-scorecard", authMiddleware, getBowlingScorecard);

router.get("/:matchId/fow", authMiddleware, getFallOfWickets);

router.get("/:matchId/full-scorecard", authMiddleware, getFullScorecard);

router.put(
  "/:matchId/transfer-scoring",
  authMiddleware,
  transferScoring,
);

export default router;