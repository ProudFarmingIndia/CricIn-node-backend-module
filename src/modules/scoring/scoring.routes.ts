import { Router } from "express";

import { authMiddleware } from "../../shared/middleware/auth.middleware";
import { addBall, getScorecard } from "./scoring.service";

const router = Router();

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