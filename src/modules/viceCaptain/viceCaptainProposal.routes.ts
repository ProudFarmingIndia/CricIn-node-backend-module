import { Router } from "express";

import {
  proposeViceCaptain,
  getTeamProposal,
  getMyProposals,
  acceptProposal,
  rejectProposal,
  cancelProposal,
} from "./viceCaptainProposal.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

router.post("/", authMiddleware, proposeViceCaptain);

router.get("/my", authMiddleware, getMyProposals);

router.get("/team/:teamId", authMiddleware, getTeamProposal);

router.put("/:id/accept", authMiddleware, acceptProposal);

router.put("/:id/reject", authMiddleware, rejectProposal);

router.delete("/:id", authMiddleware, cancelProposal);

export default router;
