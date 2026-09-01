import { Router } from "express";

import {
  sendChallenge,
  getChallengesForTeam,
  getChallengeById,
  acceptChallenge,
  rejectChallenge,
  modifyChallenge,
  cancelChallenge,
  cancelConfirmedMatch,
} from "./matchChallenge.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

router.post("/", authMiddleware, sendChallenge);

router.get("/team/:teamId", authMiddleware, getChallengesForTeam);

router.get("/:id", authMiddleware, getChallengeById);

router.put("/:id/accept", authMiddleware, acceptChallenge);

router.put("/:id/reject", authMiddleware, rejectChallenge);

router.put("/:id/modify", authMiddleware, modifyChallenge);

router.delete("/:id", authMiddleware, cancelChallenge);

router.put("/match/:matchId/cancel", authMiddleware, cancelConfirmedMatch);

export default router;