import { Router } from "express";

import {
  createPlayer,
  getPlayers,
  getAllPlayers,
  getPlayerById,
  updatePlayer,
  deletePlayer,
  getPlayerStats,
} from "./player.contoller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

router.post("/", authMiddleware, createPlayer);

router.get("/", authMiddleware, getPlayers);

router.get("/all", authMiddleware, getAllPlayers);

router.get("/:playerId/stats", authMiddleware, getPlayerStats);

router.get("/:id", authMiddleware, getPlayerById);

router.put("/:id", authMiddleware, updatePlayer);

router.delete("/:id", authMiddleware, deletePlayer);

export default router;
