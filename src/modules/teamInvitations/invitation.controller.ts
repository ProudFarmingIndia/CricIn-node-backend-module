import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as InvitationService from "./invitation.service";

/*
|--------------------------------------------------------------------------
| Send Invitation
|--------------------------------------------------------------------------
*/

export const sendInvitation = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const invitation =
      await InvitationService.sendInvitation(
        req.user.userId,
        req.body
      );

    return res.status(201).json({
      success: true,
      message: "Invitation sent successfully.",
      data: invitation,
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
| Get My Invitations
|--------------------------------------------------------------------------
*/

export const getMyInvitations = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const invitations =
      await InvitationService.getMyInvitations(
        req.user.userId
      );

    return res.status(200).json({
      success: true,
      data: invitations,
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
| Accept Invitation
|--------------------------------------------------------------------------
*/

export const acceptInvitation = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const invitation =
      await InvitationService.acceptInvitation(
        req.params.id as string,
        /* Caller identity - the service refuses if it is not theirs. */
        req.user.userId,
      );

    return res.status(200).json({
      success: true,
      message: "Invitation accepted successfully.",
      data: invitation,
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
| Reject Invitation
|--------------------------------------------------------------------------
*/

export const rejectInvitation = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const invitation =
      await InvitationService.rejectInvitation(
        req.params.id as string,
        /* Caller identity - the service refuses if it is not theirs. */
        req.user.userId,
      );

    return res.status(200).json({
      success: true,
      message: "Invitation rejected successfully.",
      data: invitation,
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
| Cancel Invitation
|--------------------------------------------------------------------------
*/

export const cancelInvitation = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const invitation =
      await InvitationService.cancelInvitation(
        req.params.id as string,
        /* Caller identity - the service refuses if it is not theirs. */
        req.user.userId,
      );

    return res.status(200).json({
      success: true,
      message: "Invitation cancelled successfully.",
      data: invitation,
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
| Team Invitations
|--------------------------------------------------------------------------
|
| GET /api/team-invitations/team/:teamId?status=PENDING
|
| Every invitation this team has sent, so a captain can see who has
| accepted, who is still pending, and who said no. `status` is optional.
*/

export const getTeamInvitations = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const invitations = await InvitationService.getTeamInvitations(
      req.user.userId,
      req.params.teamId as string,
      req.query.status as string | undefined,
    );

    return res.status(200).json({
      success: true,
      data: invitations,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
