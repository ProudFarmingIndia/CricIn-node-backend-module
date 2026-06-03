import { Router } from "express";

import { authMiddleware } from "../../shared/middleware/auth.middleware";
import { addBall, getScorecard } from "./scoring.controller";
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

router.get(
  "/scorecard/:inningsId",
  authMiddleware,
  getScorecard
);

export default router;