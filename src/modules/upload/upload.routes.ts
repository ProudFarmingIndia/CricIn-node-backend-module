import { Router } from "express";

import upload from "./upload.middleware";

import {
  uploadImage,
  uploadVideo,
  uploadMultiple,
  deleteMedia,
} from "./upload.controller";

import {
  authMiddleware,
} from "../../shared/middleware/auth.middleware";

const router =
  Router();

/*
|--------------------------------------------------------------------------
| IMAGE
|--------------------------------------------------------------------------
*/

router.post(
  "/image",
  authMiddleware,
  upload.single("file"),
  uploadImage
);

/*
|--------------------------------------------------------------------------
| VIDEO
|--------------------------------------------------------------------------
*/

router.post(
  "/video",
  authMiddleware,
  upload.single("file"),
  uploadVideo
);

/*
|--------------------------------------------------------------------------
| MULTIPLE FILES
|--------------------------------------------------------------------------
*/

router.post(
  "/multiple",
  authMiddleware,
  upload.array(
    "files",
    20
  ),
  uploadMultiple
);

/*
|--------------------------------------------------------------------------
| DELETE
|--------------------------------------------------------------------------
*/

router.delete(
  "/delete",
  authMiddleware,
  deleteMedia
);

export default router;