import { Router } from "express";

import {
  createMatch,
  getMatches,
  getMatchById,
  updateMatch,
  deleteMatch,
  startMatch,
  completeMatch,
} from "./match.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

router.post(
  "/",
  authMiddleware,
  createMatch
);

router.get(
  "/",
  authMiddleware,
  getMatches
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

export default router;