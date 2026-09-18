import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as ScoringService from "./scoring.service";

export const addBall = async (req: AuthRequest, res: Response) => {
  try {
    const data = await ScoringService.addBall(req.body, req.user.userId);
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not record that ball.",
    });
  }
};

export const undoLastBall = async (req: AuthRequest, res: Response) => {
  try {
    const data = await ScoringService.undoLastBall(
      req.params.inningsId as string,
      req.user.userId,
    );
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not undo the last ball.",
    });
  }
};

export const setNextBowler = async (req: AuthRequest, res: Response) => {
  try {
    const { inningsId, playerId } = req.body;
    const data = await ScoringService.setNextBowler(
      inningsId,
      playerId,
      req.user.userId,
    );
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not set the next bowler.",
    });
  }
};

export const setNextBatsman = async (req: AuthRequest, res: Response) => {
  try {
    /*
    | `end` is optional: "striker" | "nonStriker". Omitted for an incoming
    | batter (the service fills the vacant end); sent explicitly for a
    | correction, where the scorer knows which end they mis-tapped.
    */
    const { inningsId, playerId, end } = req.body;

    const data = await ScoringService.setNextBatsman(
      inningsId,
      playerId,
      req.user.userId,
      end,
    );
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not set the next batsman.",
    });
  }
};

/*
| Wrapped like every other handler here. It was the one without a try/catch,
| so a bad or deleted inningsId produced an unhandled rejection and a bare
| 500 instead of the JSON envelope the client parses.
*/

export const getScorecard = async (req: AuthRequest, res: Response) => {
  try {
    const data = await ScoringService.getScorecard(
      req.params.inningsId as string,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the scorecard.",
    });
  }
};