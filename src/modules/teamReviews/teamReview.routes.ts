import { Router } from "express";

import { createReview, getTeamReviews } from "./teamReview.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

router.post("/", authMiddleware, createReview);

router.get("/team/:teamId", authMiddleware, getTeamReviews);

export default router;