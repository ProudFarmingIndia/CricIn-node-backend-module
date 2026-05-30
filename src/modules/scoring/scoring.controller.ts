import { Request, Response } from "express";

import * as ScoringService from "./scoring.service";

export const addBall = async (
  req: Request,
  res: Response
) => {

  const data =
    await ScoringService.addBall(
      req.body
    );

  res.status(201).json({
    success: true,
    data,
  });
};

export const getScorecard = async (
  req: Request,
  res: Response
) => {

  const data =
    await ScoringService.getScorecard(
      req.params.inningsId as string
    );

  res.status(200).json({
    success: true,
    data,
  });
};