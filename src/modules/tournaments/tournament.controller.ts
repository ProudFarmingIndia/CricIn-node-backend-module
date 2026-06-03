import { Response } from "express";

import { AuthRequest }
from "../../shared/middleware/auth.middleware";

import * as TournamentService
from "./tournament.service";

export const createTournament =
async (
  req: AuthRequest,
  res: Response
) => {

  const tournament =
    await TournamentService.createTournament(
      req.user.userId,
      req.body
    );

  res.status(201).json({
    success: true,
    data: tournament,
  });
};

export const getTournaments =
async (
  req: AuthRequest,
  res: Response
) => {

  const tournaments =
    await TournamentService.getTournaments(
      req.user.userId
    );

  res.status(200).json({
    success: true,
    data: tournaments,
  });
};

export const getTournamentById =
async (
  req: AuthRequest,
  res: Response
) => {

  const tournament =
    await TournamentService.getTournamentById(
      req.params.id as string
    );

  res.status(200).json({
    success: true,
    data: tournament,
  });
};

export const updateTournament =
async (
  req: AuthRequest,
  res: Response
) => {

  const tournament =
    await TournamentService.updateTournament(
      req.params.id as string,
      req.body
    );

  res.status(200).json({
    success: true,
    data: tournament,
  });
};

export const deleteTournament =
async (
  req: AuthRequest,
  res: Response
) => {

  await TournamentService.deleteTournament(
    req.params.id as string
  );

  res.status(200).json({
    success: true,
    message:
      "Tournament deleted",
  });
};

export const addTeamToTournament =
async (
  req: AuthRequest,
  res: Response
) => {

  const tournament =
    await TournamentService.addTeamToTournament(
      req.params.tournamentId as string,
      req.body.teamId as string
    );

  res.status(200).json({
    success: true,
    data: tournament,
  });
};

export const removeTeamFromTournament =
async (
  req: AuthRequest,
  res: Response
) => {

  const tournament =
    await TournamentService.removeTeamFromTournament(
      req.params.tournamentId as string ,
      req.params.teamId as string
    );

  res.status(200).json({
    success: true,
    data: tournament,
  });
};

export const completeTournament =
async (
  req: AuthRequest,
  res: Response
) => {

  const tournament =
    await TournamentService.completeTournament(
      req.params.tournamentId as string,
      req.body.winnerTeam as string
    );

  res.status(200).json({
    success: true,
    data: tournament,
  });
};