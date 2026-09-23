import { Router } from "express";
import {
  getProfile,
  updateProfile,
  updatePushToken,
  getMyRoles,
  switchRole,
} from "./user.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

router.get(
  "/me",
  authMiddleware,
  getProfile
);

router.put(
  "/profile",
  authMiddleware,
  updateProfile
);

router.put(
  "/push-token",
  authMiddleware,
  updatePushToken
);

/*
|--------------------------------------------------------------------------
| Role switching
|--------------------------------------------------------------------------
|
| One login, more than one hat. GET says which hats this account has and
| which one the app is wearing; PATCH changes the second of those.
|
| Neither is a permission - see user.service.ts.
*/

router.get(
  "/roles",
  authMiddleware,
  getMyRoles
);

router.patch(
  "/active-role",
  authMiddleware,
  switchRole
);

export default router;