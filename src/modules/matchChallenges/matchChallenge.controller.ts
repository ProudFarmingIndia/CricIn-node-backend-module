import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as MatchChallengeService from "./matchChallenge.service";

/*
|--------------------------------------------------------------------------
| Send Challenge
|--------------------------------------------------------------------------
*/

export const sendChallenge = async (req: AuthRequest, res: Response) => {
  try {
    const challenge = await MatchChallengeService.sendChallenge(
      req.user.userId,
      req.body,
    );

    return res.status(201).json({
      success: true,
      message: "Match challenge sent.",
      data: challenge,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Get Challenges For A Team
|--------------------------------------------------------------------------
*/

export const getChallengesForTeam = async (req: AuthRequest, res: Response) => {
  try {
    const direction = req.query.direction === "sent" ? "sent" : "received";

    const challenges = await MatchChallengeService.getChallengesForTeam(
      req.user.userId,
      req.params.teamId as string,
      direction,
    );

    return res.status(200).json({
      success: true,
      data: challenges,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Get Challenge By Id
|--------------------------------------------------------------------------
*/

export const getChallengeById = async (req: AuthRequest, res: Response) => {
  try {
    const challenge = await MatchChallengeService.getChallengeById(
      req.params.id as string,
    );

    return res.status(200).json({
      success: true,
      data: challenge,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Accept Challenge
|--------------------------------------------------------------------------
*/

export const acceptChallenge = async (req: AuthRequest, res: Response) => {
  try {
    const challenge = await MatchChallengeService.acceptChallenge(
      req.user.userId,
      req.params.id as string,
    );

    return res.status(200).json({
      success: true,
      message: "Challenge accepted. Match scheduled.",
      data: challenge,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Reject Challenge
|--------------------------------------------------------------------------
*/

export const rejectChallenge = async (req: AuthRequest, res: Response) => {
  try {
    const challenge = await MatchChallengeService.rejectChallenge(
      req.user.userId,
      req.params.id as string,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Challenge declined.",
      data: challenge,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Modify Challenge
|--------------------------------------------------------------------------
*/

export const modifyChallenge = async (req: AuthRequest, res: Response) => {
  try {
    const challenge = await MatchChallengeService.modifyChallenge(
      req.user.userId,
      req.params.id as string,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Modified proposal sent.",
      data: challenge,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Cancel Challenge
|--------------------------------------------------------------------------
*/

export const cancelChallenge = async (req: AuthRequest, res: Response) => {
  try {
    const challenge = await MatchChallengeService.cancelChallenge(
      req.user.userId,
      req.params.id as string,
    );

    return res.status(200).json({
      success: true,
      message: "Challenge cancelled.",
      data: challenge,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Cancel Confirmed Match
|--------------------------------------------------------------------------
*/

export const cancelConfirmedMatch = async (req: AuthRequest, res: Response) => {
  try {
    const match = await MatchChallengeService.cancelConfirmedMatch(
      req.user.userId,
      req.params.matchId as string,
    );

    return res.status(200).json({
      success: true,
      message: "Match cancelled.",
      data: match,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
