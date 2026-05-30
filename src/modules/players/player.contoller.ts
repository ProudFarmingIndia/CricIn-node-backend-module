import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as PlayerService from "./player.service";

export const createPlayer = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const player =
      await PlayerService.createPlayer(
        req.user.userId,
        req.body
      );

    return res.status(201).json({
      success: true,
      data: player,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getPlayers = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const players =
      await PlayerService.getPlayers(
        req.user.userId
      );

    return res.status(200).json({
      success: true,
      data: players,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getPlayerById = async (
  req: AuthRequest,
  res: Response
) => {
  const player =
    await PlayerService.getPlayerById(
      req.params.id as string
    );

  res.status(200).json({
    success: true,
    data: player,
  });
};

export const updatePlayer = async (
  req: AuthRequest,
  res: Response
) => {
  const player =
    await PlayerService.updatePlayer(
      req.params.id as string,
      req.body
    );

  res.status(200).json({
    success: true,
    data: player,
  });
};

export const deletePlayer = async (
  req: AuthRequest,
  res: Response
) => {
  await PlayerService.deletePlayer(
    req.params.id as string
  );

  res.status(200).json({
    success: true,
    message: "Player deleted",
  });
};