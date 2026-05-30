import { Router } from "express";
import {
  getProfile,
  updateProfile,
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

export default router;