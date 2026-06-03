import { Router } from "express";

import {
  follow,
  unfollow,
  getMyFollowing,
  getFollowers,
  acceptFollowRequest,
} from "./follow.controller";

import { authMiddleware }
from "../../shared/middleware/auth.middleware";

const router = Router();

router.post(
  "/",
  authMiddleware,
  follow
);

router.delete(
  "/:targetId",
  authMiddleware,
  unfollow
);

router.get(
  "/following",
  authMiddleware,
  getMyFollowing
);

router.get(
  "/followers/:targetId",
  authMiddleware,
  getFollowers
);

router.put(
  "/accept/:followId",
  authMiddleware,
  acceptFollowRequest
);

export default router;