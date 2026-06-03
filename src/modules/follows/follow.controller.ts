import { Response } from "express";

import { AuthRequest }
from "../../shared/middleware/auth.middleware";

import * as FollowService
from "./follow.service";

export const follow = async (
  req: AuthRequest,
  res: Response
) => {

  const data =
    await FollowService.follow(
      req.user.userId,
      req.body
    );

  res.status(201).json({
    success: true,
    data,
  });
};

export const unfollow =
async (
  req: AuthRequest,
  res: Response
) => {

  await FollowService.unfollow(
    req.user.userId,
    req.params.targetId as string
  );

  res.status(200).json({
    success: true,
    message: "Unfollowed",
  });
};

export const getMyFollowing =
async (
  req: AuthRequest,
  res: Response
) => {

  const data =
    await FollowService.getMyFollowing(
      req.user.userId
    );

  res.status(200).json({
    success: true,
    data,
  });
};

export const getFollowers =
async (
  req: AuthRequest,
  res: Response
) => {

  const data =
    await FollowService.getFollowers(
      req.params.targetId as string
    );

  res.status(200).json({
    success: true,
    data,
  });
};

export const acceptFollowRequest =
async (
  req: AuthRequest,
  res: Response
) => {

  const data =
    await FollowService.acceptFollowRequest(
      req.params.followId as string
    );

  res.status(200).json({
    success: true,
    data,
  });
};