import { Router } from "express";
import {
  getProfile,
  updateProfile,
  updatePushToken,
} from "./user.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

router.get(
  "/me",
  authMiddleware,
  getProfile
);

router.put(
  "/profile",
  authMiddleware,
  updateProfile
);

router.put(
  "/push-token",
  authMiddleware,
  updatePushToken
);

export default router;