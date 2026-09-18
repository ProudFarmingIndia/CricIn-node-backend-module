import { Router } from "express";

import {
  sendInvitation,
  getMyInvitations,
  getTeamInvitations,
  acceptInvitation,
  rejectInvitation,
  cancelInvitation,
} from "./invitation.controller";

import {
  authMiddleware,
} from "../../shared/middleware/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Send Invitation
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  authMiddleware,
  sendInvitation
);

/*
|--------------------------------------------------------------------------
| My Invitations
|--------------------------------------------------------------------------
|
| Returns all invitations received by the logged-in player.
|
*/

router.get(
  "/my",
  authMiddleware,
  getMyInvitations
);

/*
|--------------------------------------------------------------------------
| Team Invitations
|--------------------------------------------------------------------------
|
| Everything this team has sent, with status. Optional ?status=PENDING.
|
| Registered above "/:id/..." for the same reason /name-available sits above
| /:id on the teams router - Express matches in order, and a literal
| segment must be declared before the parameterised one that would swallow
| it.
|
*/

router.get(
  "/team/:teamId",
  authMiddleware,
  getTeamInvitations
);

/*
|--------------------------------------------------------------------------
| Accept Invitation
|--------------------------------------------------------------------------
*/

router.put(
  "/:id/accept",
  authMiddleware,
  acceptInvitation
);

/*
|--------------------------------------------------------------------------
| Reject Invitation
|--------------------------------------------------------------------------
*/

router.put(
  "/:id/reject",
  authMiddleware,
  rejectInvitation
);

/*
|--------------------------------------------------------------------------
| Cancel Invitation
|--------------------------------------------------------------------------
|
| Captain can cancel a pending invitation.
|
*/

router.delete(
  "/:id",
  authMiddleware,
  cancelInvitation
);

export default router;