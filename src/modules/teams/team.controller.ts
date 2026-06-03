import { Response } from "express";
import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as TeamService from "./team.service";

export const createTeam = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const team =
      await TeamService.createTeam(
        req.user.userId,
        req.body
      );

    res.status(201).json({
      success: true,
      data: team,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getTeams = async (
  req: AuthRequest,
  res: Response
) => {
  const teams =
    await TeamService.getTeams(
      req.user.userId
    );

  res.status(200).json({
    success: true,
    data: teams,
  });
};

export const getTeamById = async (
  req: AuthRequest,
  res: Response
) => {
  const team =
    await TeamService.getTeamById(
      req.params.id as string
    );

  res.status(200).json({
    success: true,
    data: team,
  });
};

export const updateTeam = async (
  req: AuthRequest,
  res: Response
) => {
  const team =
    await TeamService.updateTeam(
      req.params.id as string,
      req.body
    );

  res.status(200).json({
    success: true,
    data: team,
  });
};

export const deleteTeam = async (
  req: AuthRequest,
  res: Response
) => {
  await TeamService.deleteTeam(
    req.params.id as string
  );

  res.status(200).json({
    success: true,
    message: "Team deleted",
  });
};

export const addPlayerToTeam = async (
  req: AuthRequest,
  res: Response
) => {
  const { playerId } = req.body;

  const team =
    await TeamService.addPlayerToTeam(
      req.params.teamId as string,
      playerId
    );

  res.status(200).json({
    success: true,
    data: team,
  });
};

export const removePlayerFromTeam =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    const team =
      await TeamService.removePlayerFromTeam(
        req.params.teamId as string,
        req.params.playerId as string
      );

    res.status(200).json({
      success: true,
      data: team,
    });
  };

export const setCaptain = async (
  req: AuthRequest,
  res: Response
) => {
  const { captainId } = req.body;

  const team =
    await TeamService.setCaptain(
      req.params.teamId as string,
      captainId
    );

  res.status(200).json({
    success: true,
    data: team,
  });
};

export const getAllTeams = async (
  req: AuthRequest,
  res: Response
) => {
  const teams =
    await TeamService.getAllTeams();

  res.status(200).json({
    success: true,
    data: teams,
  });
};