import { Router } from "express";

import upload
from "./upload.middleware";

import {
  uploadImage,
  uploadVideo,
} from "./upload.controller";

import {
  authMiddleware,
} from "../middleware/auth.middleware";

const router = Router();

router.post(
  "/image",
  authMiddleware,
  upload.single("file"),
  uploadImage
);

router.post(
  "/video",
  authMiddleware,
  upload.single("file"),
  uploadVideo
);

export default router;