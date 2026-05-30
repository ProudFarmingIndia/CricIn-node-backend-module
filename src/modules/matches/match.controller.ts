import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as MatchService from "./match.service";

export const createMatch = async (
  req: AuthRequest,
  res: Response
) => {
  const match =
    await MatchService.createMatch(
      req.user.userId,
      req.body
    );

  res.status(201).json({
    success: true,
    data: match,
  });
};

export const getMatches = async (
  req: AuthRequest,
  res: Response
) => {
  const matches =
    await MatchService.getMatches(
      req.user.userId
    );

  res.status(200).json({
    success: true,
    data: matches,
  });
};

export const getMatchById = async (
  req: AuthRequest,
  res: Response
) => {
  const match =
    await MatchService.getMatchById(
      req.params.id as string
    );

  res.status(200).json({
    success: true,
    data: match,
  });
};

export const updateMatch = async (
  req: AuthRequest,
  res: Response
) => {
  const match =
    await MatchService.updateMatch(
      req.params.id as string,
      req.body
    );

  res.status(200).json({
    success: true,
    data: match,
  });
};

export const deleteMatch = async (
  req: AuthRequest,
  res: Response
) => {
  await MatchService.deleteMatch(
    req.params.id as string
  );

  res.status(200).json({
    success: true,
    message: "Match deleted",
  });
};

export const startMatch = async (
  req: AuthRequest,
  res: Response
) => {
  const match =
    await MatchService.startMatch(
      req.params.matchId as string
    );

  res.status(200).json({
    success: true,
    data: match,
  });
};

export const completeMatch = async (
  req: AuthRequest,
  res: Response
) => {
  const match =
    await MatchService.completeMatch(
      req.params.matchId as string
    );

  res.status(200).json({
    success: true,
    data: match,
  });
};