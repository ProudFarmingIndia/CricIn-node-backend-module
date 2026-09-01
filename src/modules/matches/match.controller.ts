import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as MatchService from "./match.service";

export const createMatch = async (req: AuthRequest, res: Response) => {
  try {
    const match = await MatchService.createMatch(req.user.userId, req.body);

    res.status(201).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not create the match.",
    });
  }
};

export const getMatches = async (req: AuthRequest, res: Response) => {
  try {
    const matches = await MatchService.getMatches(req.user.userId);

    res.status(200).json({
      success: true,
      data: matches,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not load matches.",
    });
  }
};

export const getMatchById = async (req: AuthRequest, res: Response) => {
  try {
    const match = await MatchService.getMatchById(
      req.params.id as string,
      req.user.userId,
    );

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found.",
      });
    }

    res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load this match.",
    });
  }
};

export const resetMatchSetup = async (req: AuthRequest, res: Response) => {
  try {
    const match = await MatchService.resetMatchSetup(
      req.user.userId,
      req.params.matchId as string,
    );

    res.status(200).json({ success: true, data: match });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not reset the match setup.",
    });
  }
};

export const getOverByOver = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getOverByOver(req.params.matchId as string);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load over-by-over.",
    });
  }
};

export const updateMatch = async (req: AuthRequest, res: Response) => {
  try {
    const match = await MatchService.updateMatch(
      req.user.userId,
      req.params.id as string,
      req.body,
    );

    res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not update this match.",
    });
  }
};

export const deleteMatch = async (req: AuthRequest, res: Response) => {
  try {
    await MatchService.deleteMatch(req.user.userId, req.params.id as string);

    res.status(200).json({
      success: true,
      message: "Match deleted",
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not delete this match.",
    });
  }
};

export const startMatch = async (req: AuthRequest, res: Response) => {
  try {
    /*
    | `pins` was never forwarded. The two-PIN case - a neutral Quick Score
    | scorer who manages neither team and must supply a PIN from each
    | captain - therefore arrived at the gate with both PINs undefined and
    | could never start a match.
    |
    | `setup` carries the squads and the toss so they are written in the
    | same call that validates the PIN, rather than saved screen by screen
    | on the way here.
    */

    const { pin, pins, setup } = req.body || {};

    const match = await MatchService.startMatch(
      req.user.userId,
      req.params.matchId as string,
      pin,
      pins,
      setup,
    );

    res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not start this match.",
    });
  }
};

export const verifyMatchPin = async (req: AuthRequest, res: Response) => {
  try {
    const { pin } = req.body || {};

    const data = await MatchService.verifyMatchPin(
      req.user.userId,
      req.params.matchId as string,
      pin,
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not verify the match PIN.",
    });
  }
};

export const completeMatch = async (req: AuthRequest, res: Response) => {
  try {
    const match = await MatchService.completeMatch(
      req.user.userId,
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not complete this match.",
    });
  }
};

export const updateMatchResult = async (req: AuthRequest, res: Response) => {
  try {
    const { winnerTeam, result } = req.body;

    const match = await MatchService.updateMatchResult(
      req.user.userId,
      req.params.matchId as string,
      winnerTeam,
      result,
    );

    res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not set the result for this match.",
    });
  }
};

export const getLiveMatch = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getLiveMatch(req.params.matchId as string);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the live match.",
    });
  }
};

export const getMatchSummary = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getMatchSummary(
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the match summary.",
    });
  }
};

export const getBattingScorecard = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getBattingScorecard(
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the batting scorecard.",
    });
  }
};

export const getBowlingScorecard = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getBowlingScorecard(
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the bowling scorecard.",
    });
  }
};

export const getFallOfWickets = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getFallOfWickets(
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the fall of wickets.",
    });
  }
};

export const getFullScorecard = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getFullScorecard(
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the full scorecard.",
    });
  }
};

export const getLiveMatchesFeed = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getLiveMatches(req.user.userId);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load live matches.",
    });
  }
};

export const getUpcomingMatchesFeed = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const data = await MatchService.getUpcomingMatches(req.user.userId);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load upcoming matches.",
    });
  }
};

export const getRecentMatchesFeed = async (req: AuthRequest, res: Response) => {
  try {
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 20;

    const data = await MatchService.getRecentMatches(req.user.userId, limit);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load recent matches.",
    });
  }
};

export const getScorecardByInnings = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const data = await MatchService.getScorecardByInnings(
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load the scorecard.",
    });
  }
};

export const getPartnerships = async (req: AuthRequest, res: Response) => {
  try {
    const data = await MatchService.getPartnerships(
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not load partnerships.",
    });
  }
};

export const requestConfirmation = async (req: AuthRequest, res: Response) => {
  try {
    const match = await MatchService.requestMatchConfirmation(
      req.user.userId,
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not request match confirmation.",
    });
  }
};

export const confirmMatch = async (req: AuthRequest, res: Response) => {
  try {
    const match = await MatchService.confirmMatchRequest(
      req.user.userId,
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not confirm this match.",
    });
  }
};

export const rejectMatchConfirmation = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const match = await MatchService.rejectMatchConfirmation(
      req.user.userId,
      req.params.matchId as string,
    );

    res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not reject this match.",
    });
  }
};

export const transferScoring = async (req: AuthRequest, res: Response) => {
  try {
    const { matchId } = req.params;
    const { targetUserId } = req.body;

    const match = await MatchService.transferScoring(
      req.user.userId,
      matchId as string,
      targetUserId,
    );

    res.json({ success: true, match });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};