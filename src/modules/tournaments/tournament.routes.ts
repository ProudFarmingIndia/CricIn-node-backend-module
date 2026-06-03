import { Router } from "express";

import {
  createTournament,
  getTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament,
  addTeamToTournament,
  removeTeamFromTournament,
  completeTournament,
} from "./tournament.controller";

import { authMiddleware }
from "../../shared/middleware/auth.middleware";

const router = Router();

router.post(
  "/",
  authMiddleware,
  createTournament
);

router.get(
  "/",
  authMiddleware,
  getTournaments
);

router.get(
  "/:id",
  authMiddleware,
  getTournamentById
);

router.put(
  "/:id",
  authMiddleware,
  updateTournament
);

router.delete(
  "/:id",
  authMiddleware,
  deleteTournament
);

router.post(
  "/:tournamentId/teams",
  authMiddleware,
  addTeamToTournament
);

router.delete(
  "/:tournamentId/teams/:teamId",
  authMiddleware,
  removeTeamFromTournament
);

router.put(
  "/:tournamentId/complete",
  authMiddleware,
  completeTournament
);

export default router;