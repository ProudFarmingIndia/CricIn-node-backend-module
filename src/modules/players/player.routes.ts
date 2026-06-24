import { Router } from "express";

import { authMiddleware } from "../../shared/middleware/auth.middleware";
import {
  createPlayer,
  deletePlayer,
  getAllPlayers,
  getMyPlayerProfile,
  getPlayerById,
  getPlayers,
  getPlayerStats,
  updateMyPlayerProfile,
  updatePlayer,
} from "./player.contoller";

const router = Router();

router.post("/", authMiddleware, createPlayer);

router.get("/me", authMiddleware, getMyPlayerProfile);

router.put("/me", authMiddleware, updateMyPlayerProfile);

router.get("/", authMiddleware, getPlayers);

router.get("/all", authMiddleware, getAllPlayers);

router.get("/:playerId/stats", authMiddleware, getPlayerStats);

router.get("/:id", authMiddleware, getPlayerById);

router.put("/:id", authMiddleware, updatePlayer);

router.delete("/:id", authMiddleware, deletePlayer);

export default router;
