import { Router } from "express";

import {
  createPost,
  getFeed,
  getPostById,
  likePost,
  commentPost,
  getComments,
  sharePost,
} from "./feed.controller";

import { authMiddleware }
from "../../shared/middleware/auth.middleware";

const router = Router();

router.post(
  "/",
  authMiddleware,
  createPost
);

router.get(
  "/",
  authMiddleware,
  getFeed
);

router.get(
  "/:postId",
  authMiddleware,
  getPostById
);

router.post(
  "/:postId/like",
  authMiddleware,
  likePost
);

router.post(
  "/:postId/comment",
  authMiddleware,
  commentPost
);

router.get(
  "/:postId/comments",
  authMiddleware,
  getComments
);

router.post(
  "/:postId/share",
  authMiddleware,
  sharePost
);

export default router;