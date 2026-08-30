import { Router } from "express";

import { authMiddleware } from "../../shared/middleware/auth.middleware";
import {
  addBall,
  getScorecard,
  undoLastBall,
  setNextBowler,
  setNextBatsman,
} from "./scoring.controller";
import {
  createInnings,
  getInningsById,
  endInnings
} from "./innings.controller";

const router = Router();

router.post(
  "/innings",
  authMiddleware,
  createInnings
);

router.get(
  "/innings/:id",
  authMiddleware,
  getInningsById
);

router.put(
  "/innings/:inningsId/end",
  authMiddleware,
  endInnings
);

router.post(
  "/ball",
  authMiddleware,
  addBall
);

router.put(
  "/ball/next-batsman",
  authMiddleware,
  setNextBatsman
);

router.put(
  "/ball/next-bowler",
  authMiddleware,
  setNextBowler
);

router.delete(
  "/ball/:inningsId/undo",
  authMiddleware,
  undoLastBall
);

router.get(
  "/scorecard/:inningsId",
  authMiddleware,
  getScorecard
);

export default router;