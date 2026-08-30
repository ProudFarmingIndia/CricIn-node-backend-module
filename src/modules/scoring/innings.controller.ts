import { Response } from "express";
import * as InningsService from "./innings.service";
import { AuthRequest } from "../../shared/middleware/auth.middleware";

/*
| These three used to take a bare Request and call the service with no
| identity at all, on routes that are behind authMiddleware - so the user
| was known and simply not used. Passing req.user.userId through is what lets
| the service refuse someone else's innings.
*/

export const createInnings = async (req: AuthRequest, res: Response) => {
  try {
    const innings = await InningsService.createInnings(
      req.body,
      req.user?.userId,
    );

    res.status(201).json({
      success: true,
      data: innings,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not start the innings.",
    });
  }
};

export const getInningsById = async (req: AuthRequest, res: Response) => {
  try {
    const innings =
      await InningsService.getInningsById(
        req.params.id as string
      );

    res.status(200).json({
      success: true,
      data: innings,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the innings.",
    });
  }
};

export const endInnings = async (req: AuthRequest, res: Response) => {
  try {
    const innings = await InningsService.endInnings(
      req.params.inningsId as string,
      req.user?.userId,
    );

    res.status(200).json({
      success: true,
      data: innings,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not end the innings.",
    });
  }
};