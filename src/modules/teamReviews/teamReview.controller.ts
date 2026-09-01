import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as TeamReviewService from "./teamReview.service";

/*
|--------------------------------------------------------------------------
| Create Review
|--------------------------------------------------------------------------
*/

export const createReview = async (req: AuthRequest, res: Response) => {
  try {
    const review = await TeamReviewService.createReview(
      req.user.userId,
      req.body,
    );

    return res.status(201).json({
      success: true,
      message: "Review submitted.",
      data: review,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Get Reviews For A Team
|--------------------------------------------------------------------------
*/

export const getTeamReviews = async (req: AuthRequest, res: Response) => {
  try {
    const reviews = await TeamReviewService.getTeamReviews(
      req.params.teamId as string,
    );

    return res.status(200).json({
      success: true,
      data: reviews,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};