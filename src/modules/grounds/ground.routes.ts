import { Router } from "express";

import {
  createGround,
  getGrounds,
  getAllGrounds,
  getGroundById,
  updateGround,
  deleteGround,
} from "./ground.controller";

import { authMiddleware }
from "../../shared/middleware/auth.middleware";

const router = Router();

router.post(
  "/",
  authMiddleware,
  createGround
);

router.get(
  "/",
  authMiddleware,
  getGrounds
);

router.get(
  "/all",
  authMiddleware,
  getAllGrounds
);

router.get(
  "/:id",
  authMiddleware,
  getGroundById
);

router.put(
  "/:id",
  authMiddleware,
  updateGround
);

router.delete(
  "/:id",
  authMiddleware,
  deleteGround
);

export default router;