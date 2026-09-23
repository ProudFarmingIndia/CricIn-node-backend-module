import { Response } from "express";
import { AuthRequest } from "../../shared/middleware/auth.middleware";

import {
  getUserProfile,
  updateUserProfile,
  updatePushToken as updatePushTokenService,
  getMyRoles as getMyRolesService,
  switchRole as switchRoleService,
} from "./user.service";

/*
|--------------------------------------------------------------------------
| Roles
|--------------------------------------------------------------------------
|
| Read what hats this account wears, and change which one the app opens in.
| Neither grants anything - see the note in user.service.ts.
*/

export const getMyRoles = async (req: AuthRequest, res: Response) => {
  try {
    const data = await getMyRolesService(req.user.userId);

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const switchRole = async (req: AuthRequest, res: Response) => {
  try {
    const data = await switchRoleService(req.user.userId, req.body?.role);

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getProfile = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const user = await getUserProfile(
      req.user.userId
    );

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const updatePushToken = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const user = await updatePushTokenService(
      req.user.userId,
      req.body.expoPushToken
    );

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateProfile = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const user = await updateUserProfile(
      req.user.userId,
      req.body
    );

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};