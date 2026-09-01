import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as ViceCaptainProposalService from "./viceCaptainProposal.service";

/*
|--------------------------------------------------------------------------
| Propose Vice-Captain
|--------------------------------------------------------------------------
*/

export const proposeViceCaptain = async (req: AuthRequest, res: Response) => {
  try {
    const { teamId, playerId } = req.body;

    const proposal = await ViceCaptainProposalService.proposeViceCaptain(
      req.user.userId,
      teamId,
      playerId,
    );

    return res.status(201).json({
      success: true,
      message: "Vice-Captain proposal sent.",
      data: proposal,
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
| Get Team's Pending Proposal
|--------------------------------------------------------------------------
*/

export const getTeamProposal = async (req: AuthRequest, res: Response) => {
  try {
    const proposal = await ViceCaptainProposalService.getTeamProposal(
      req.user.userId,
      req.params.teamId as string,
    );

    return res.status(200).json({
      success: true,
      data: proposal,
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
| My Proposals
|--------------------------------------------------------------------------
*/

export const getMyProposals = async (req: AuthRequest, res: Response) => {
  try {
    const proposals = await ViceCaptainProposalService.getMyProposals(
      req.user.userId,
    );

    return res.status(200).json({
      success: true,
      data: proposals,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Accept Proposal
|--------------------------------------------------------------------------
*/

export const acceptProposal = async (req: AuthRequest, res: Response) => {
  try {
    const proposal = await ViceCaptainProposalService.acceptProposal(
      req.user.userId,
      req.params.id as string,
    );

    return res.status(200).json({
      success: true,
      message: "You are now Vice-Captain.",
      data: proposal,
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
| Reject Proposal
|--------------------------------------------------------------------------
*/

export const rejectProposal = async (req: AuthRequest, res: Response) => {
  try {
    const proposal = await ViceCaptainProposalService.rejectProposal(
      req.user.userId,
      req.params.id as string,
    );

    return res.status(200).json({
      success: true,
      message: "Proposal declined.",
      data: proposal,
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
| Cancel Proposal
|--------------------------------------------------------------------------
*/

export const cancelProposal = async (req: AuthRequest, res: Response) => {
  try {
    const proposal = await ViceCaptainProposalService.cancelProposal(
      req.user.userId,
      req.params.id as string,
    );

    return res.status(200).json({
      success: true,
      message: "Proposal cancelled.",
      data: proposal,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
