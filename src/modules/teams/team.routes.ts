import { Router } from "express";

import {
  createTeam,
  getTeams,
  getMyTeams,
  getAllTeams,
  getTeamById,
  checkTeamNames,
  updateTeam,
  deleteTeam,
  addPlayerToTeam,
  createLocalPlayer,
  removePlayerFromTeam,
  leaveTeam,
  setCaptain,
  revokeViceCaptain,
  updateViceCaptainRights,
  updateTeamStats,
  getTeamCalendar,
  blockDate,
  unblockDate,
} from "./team.controller";

import {
  authMiddleware,
} from "../../shared/middleware/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Team CRUD
|--------------------------------------------------------------------------
*/

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
  "/my",
  authMiddleware,
  getMyTeams,
);

router.get(
  "/all",
  authMiddleware,
  getAllTeams
);

/*
| MUST stay above "/:id". Express matches in registration order, so with
| "/:id" first a request for /api/teams/name-available is handled by
| getTeamById with id="name-available" - which returns "Team not found"
| and looks like the endpoint was never added.
*/
router.get(
  "/name-available",
  authMiddleware,
  checkTeamNames
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

/*
|--------------------------------------------------------------------------
| Squad Management (Temporary)
|--------------------------------------------------------------------------
|
| These APIs are only for MVP.
| Production flow should use Team Invitations.
|
*/

router.post(
  "/:teamId/players",
  authMiddleware,
  addPlayerToTeam
);

router.delete(
  "/:teamId/leave",
  authMiddleware,
  leaveTeam
);

router.delete(
  "/:teamId/players/:playerId",
  authMiddleware,
  removePlayerFromTeam
);

/*
|--------------------------------------------------------------------------
| Leadership
|--------------------------------------------------------------------------
*/

router.put(
  "/:teamId/captain",
  authMiddleware,
  setCaptain
);

router.put(
  "/:teamId/vice-captain/revoke",
  authMiddleware,
  revokeViceCaptain
);

router.put(
  "/:teamId/vice-captain/rights",
  authMiddleware,
  updateViceCaptainRights
);

/*
|--------------------------------------------------------------------------
| Team Statistics
|--------------------------------------------------------------------------
*/

router.put(
  "/:teamId/stats",
  authMiddleware,
  updateTeamStats
);

/*
|--------------------------------------------------------------------------
| Local Player
|--------------------------------------------------------------------------
|
| Create Local Player & Add Into Team
|
*/

router.post(
  "/:teamId/local-player",
  authMiddleware,
  createLocalPlayer
);

/*
|--------------------------------------------------------------------------
| Calendar / Availability
|--------------------------------------------------------------------------
*/

router.get(
  "/:teamId/calendar",
  authMiddleware,
  getTeamCalendar
);

router.post(
  "/:teamId/block-date",
  authMiddleware,
  blockDate
);

router.delete(
  "/:teamId/block-date/:date",
  authMiddleware,
  unblockDate
);

export default router;