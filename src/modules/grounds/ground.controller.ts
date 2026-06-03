import { Response } from "express";

import { AuthRequest }
from "../../shared/middleware/auth.middleware";

import * as GroundService
from "./ground.service";

export const createGround =
async (
  req: AuthRequest,
  res: Response
) => {

  const ground =
    await GroundService.createGround(
      req.user.userId,
      req.body
    );

  res.status(201).json({
    success: true,
    data: ground,
  });
};

export const getGrounds =
async (
  req: AuthRequest,
  res: Response
) => {

  const grounds =
    await GroundService.getGrounds(
      req.user.userId
    );

  res.status(200).json({
    success: true,
    data: grounds,
  });
};

export const getAllGrounds =
async (
  req: AuthRequest,
  res: Response
) => {

  const grounds =
    await GroundService.getAllGrounds();

  res.status(200).json({
    success: true,
    data: grounds,
  });
};

export const getGroundById =
async (
  req: AuthRequest,
  res: Response
) => {

  const ground =
    await GroundService.getGroundById(
      req.params.id as string
    );

  res.status(200).json({
    success: true,
    data: ground,
  });
};

export const updateGround =
async (
  req: AuthRequest,
  res: Response
) => {

  const ground =
    await GroundService.updateGround(
      req.params.id as string,
      req.body
    );

  res.status(200).json({
    success: true,
    data: ground,
  });
};

export const deleteGround =
async (
  req: AuthRequest,
  res: Response
) => {

  await GroundService.deleteGround(
    req.params.id as string
  );

  res.status(200).json({
    success: true,
    message:
      "Ground deleted",
  });
};