import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as ScoringRequestService from "./scoringRequest.service";

/*
|--------------------------------------------------------------------------
| Scoring Request Controller
|--------------------------------------------------------------------------
|
| requestedBy always comes from req.user, never the body - the whole point
| of the flow is that the requester's identity decides whose approval is
| needed.
|
*/

export const create = async (req: AuthRequest, res: Response) => {
  try {
    const result = await ScoringRequestService.createScoringRequest(
      req.user.userId,
      req.body,
    );

    return res.status(201).json({
      success: true,

      data: result,

      /*
      | readyToScore tells the app which way to go next: straight to squad
      | selection when the requester manages both teams, or to the waiting
      | state when captains still owe an answer.
      */
      message: result.readyToScore
        ? "Match created."
        : "Approval requested from the other captains.",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const respond = async (req: AuthRequest, res: Response) => {
  try {
    const decision = req.body?.decision;

    if (decision !== "approve" && decision !== "reject") {
      throw new Error("decision must be 'approve' or 'reject'.");
    }

    const result = await ScoringRequestService.respondToScoringRequest(
      req.user.userId,
      req.params.requestId as string,
      decision,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const listMine = async (req: AuthRequest, res: Response) => {
  try {
    const data = await ScoringRequestService.getMyScoringRequests(
      req.user.userId,
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const listForMyTeams = async (req: AuthRequest, res: Response) => {
  try {
    const data = await ScoringRequestService.getScoringRequestsForMyTeams(
      req.user.userId,
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const cancel = async (req: AuthRequest, res: Response) => {
  try {
    const data = await ScoringRequestService.cancelScoringRequest(
      req.user.userId,
      req.params.requestId as string,
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
