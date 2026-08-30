import { Router } from "express";

import {
  sendInvitation,
  getMyInvitations,
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