import { Router } from "express";

import {
  createMatch,
  getMatches,
  getMatchById,
  updateMatch,
  deleteMatch,
  startMatch,
  completeMatch,
  updateMatchResult,
  getLiveMatch,
  getMatchSummary,
  getBattingScorecard,
  getBowlingScorecard,
  getFallOfWickets,
  getFullScorecard,
} from "./match.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";
import { validateMatch } from "../../shared/validators/match.validator";

const router = Router();

router.post(
  "/",
  authMiddleware,
  validateMatch,
  createMatch
);

router.get(
  "/",
  authMiddleware,
  getMatches
);

router.get(
  "/:matchId/live",
  authMiddleware,
  getLiveMatch
);

router.get(
  "/:matchId/batting-scorecard",
  authMiddleware,
  getBattingScorecard
);

router.get(
  "/:id",
  authMiddleware,
  getMatchById
);

router.put(
  "/:id",
  authMiddleware,
  updateMatch
);

router.delete(
  "/:id",
  authMiddleware,
  deleteMatch
);

router.put(
  "/:matchId/start",
  authMiddleware,
  startMatch
);

router.put(
  "/:matchId/complete",
  authMiddleware,
  completeMatch
);

router.put(
  "/:matchId/result",
  authMiddleware,
  updateMatchResult
);

router.get(
  "/:matchId/summary",
  authMiddleware,
  getMatchSummary
);


router.get(
  "/:matchId/bowling-scorecard",
  authMiddleware,
  getBowlingScorecard
);

router.get(
  "/:matchId/fow",
  authMiddleware,
  getFallOfWickets
);

router.get(
  "/:matchId/full-scorecard",
  authMiddleware,
  getFullScorecard
);

export default router;