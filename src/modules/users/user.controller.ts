import { Response } from "express";
import { AuthRequest } from "../../shared/middleware/auth.middleware";

import {
  getUserProfile,
  updateUserProfile,
} from "./user.service";

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