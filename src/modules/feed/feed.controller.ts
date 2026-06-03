import { Response } from "express";

import { AuthRequest }
from "../../shared/middleware/auth.middleware";

import * as FeedService
from "./feed.service";

export const createPost =
async (
  req: AuthRequest,
  res: Response
) => {

  const post =
    await FeedService.createPost(
      req.user.userId,
      req.body
    );

  res.status(201).json({
    success: true,
    data: post,
  });
};

export const getFeed =
async (
  req: AuthRequest,
  res: Response
) => {

  const feed =
    await FeedService.getFeed();

  res.status(200).json({
    success: true,
    data: feed,
  });
};

export const getPostById =
async (
  req: AuthRequest,
  res: Response
) => {

  const post =
    await FeedService.getPostById(
      req.params.postId as string
    );

  res.status(200).json({
    success: true,
    data: post,
  });
};

export const likePost =
async (
  req: AuthRequest,
  res: Response
) => {

  await FeedService.likePost(
    req.user.userId,
    req.params.postId as string
  );

  res.status(200).json({
    success: true,
  });
};

export const commentPost =
async (
  req: AuthRequest,
  res: Response
) => {

  const comment =
    await FeedService.commentPost(
      req.user.userId,
      req.params.postId as string,
      req.body.comment
    );

  res.status(201).json({
    success: true,
    data: comment,
  });
};

export const getComments =
async (
  req: AuthRequest,
  res: Response
) => {

  const comments =
    await FeedService.getComments(
      req.params.postId as string
    );

  res.status(200).json({
    success: true,
    data: comments,
  });
};

export const sharePost =
async (
  req: AuthRequest,
  res: Response
) => {

  const post =
    await FeedService.sharePost(
      req.params.postId as string,
    );

  res.status(200).json({
    success: true,
    data: post,
  });
};