import { Router } from "express";

import {
  createTeam,
  getTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  addPlayerToTeam,
  removePlayerFromTeam,
  setCaptain,
} from "./team.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

router.post(
  "/",
  authMiddleware,
  createTeam
);

router.get(
  "/",
  authMiddleware,
  getTeams
);

router.get(
  "/:id",
  authMiddleware,
  getTeamById
);

router.put(
  "/:id",
  authMiddleware,
  updateTeam
);

router.delete(
  "/:id",
  authMiddleware,
  deleteTeam
);

router.post(
  "/:teamId/players",
  authMiddleware,
  addPlayerToTeam
);

router.delete(
  "/:teamId/players/:playerId",
  authMiddleware,
  removePlayerFromTeam
);

router.put(
  "/:teamId/captain",
  authMiddleware,
  setCaptain
);

export default router;