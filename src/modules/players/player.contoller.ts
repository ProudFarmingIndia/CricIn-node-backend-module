import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as PlayerService from "./player.service";

import * as PlayerStatsService from "./player.stats.service";

export const createPlayer = async (req: AuthRequest, res: Response) => {
  try {
    const player = await PlayerService.createPlayer(req.user.userId, req.body);

    res.status(201).json({
      success: true,
      data: player,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getMyPlayerProfile = async (req: AuthRequest, res: Response) => {
  const player = await PlayerService.getMyPlayerProfile(req.user.userId);

  res.status(200).json({
    success: true,
    data: player,
  });
};

export const updateMyPlayerProfile = async (
  req: AuthRequest,
  res: Response,
) => {
  const player = await PlayerService.updateMyPlayerProfile(
    req.user.userId,
    req.body,
  );

  res.status(200).json({
    success: true,
    data: player,
  });
};

export const getPlayers = async (req: AuthRequest, res: Response) => {
  const players = await PlayerService.getPlayers(req.user.userId);

  res.status(200).json({
    success: true,
    data: players,
  });
};

export const getAllPlayers = async (req: AuthRequest, res: Response) => {
  const players = await PlayerService.getAllPlayers();

  res.status(200).json({
    success: true,
    data: players,
  });
};

export const getPlayerById = async (req: AuthRequest, res: Response) => {
  const player = await PlayerService.getPlayerById(req.params.id as string);

  res.status(200).json({
    success: true,
    data: player,
  });
};

export const updatePlayer = async (req: AuthRequest, res: Response) => {
  const player = await PlayerService.updatePlayer(req.params.id as string, req.body);

  res.status(200).json({
    success: true,
    data: player,
  });
};

export const deletePlayer = async (req: AuthRequest, res: Response) => {
  await PlayerService.deletePlayer(req.params.id as string);

  res.status(200).json({
    success: true,
    message: "Player deleted successfully",
  });
};

export const getPlayerStats = async (req: AuthRequest, res: Response) => {
  const stats = await PlayerStatsService.getPlayerStats(req.params.playerId as string);

  res.status(200).json({
    success: true,
    data: stats,
  });
};
