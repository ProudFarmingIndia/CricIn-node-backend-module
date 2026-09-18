import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as TeamService from "./team.service";
import * as TeamAvailabilityService from "./teamAvailability.service";

/*
|--------------------------------------------------------------------------
| Get Team Calendar
|--------------------------------------------------------------------------
*/

export const getTeamCalendar = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;

    const calendar = await TeamAvailabilityService.getTeamCalendar(
      req.params.teamId as string,
      (from as string) || new Date().toISOString(),
      (to as string) ||
        new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    );

    return res.status(200).json({
      success: true,
      data: calendar,
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
| Block Date
|--------------------------------------------------------------------------
*/

export const blockDate = async (req: AuthRequest, res: Response) => {
  try {
    const { date, reason } = req.body;

    const blocked = await TeamAvailabilityService.blockDate(
      req.user.userId,
      req.params.teamId as string,
      date,
      reason,
    );

    return res.status(201).json({
      success: true,
      message: "Date blocked.",
      data: blocked,
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
| Unblock Date
|--------------------------------------------------------------------------
*/

export const unblockDate = async (req: AuthRequest, res: Response) => {
  try {
    await TeamAvailabilityService.unblockDate(
      req.user.userId,
      req.params.teamId as string,
      req.params.date as string,
    );

    return res.status(200).json({
      success: true,
      message: "Date unblocked.",
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
| Create Team
|--------------------------------------------------------------------------
*/

export const createTeam = async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.createTeam(req.user.userId, req.body);

    return res.status(201).json({
      success: true,
      message: "Team created successfully.",
      data: team,
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
| Get My Teams
|--------------------------------------------------------------------------
*/

export const getTeams = async (req: AuthRequest, res: Response) => {
  try {
    const teams = await TeamService.getTeams(req.user.userId);

    return res.status(200).json({
      success: true,
      data: teams,
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
| Get My Teams
|--------------------------------------------------------------------------
|
| Returns:
| - Teams Created By Me
| - Teams I Joined
|
*/

export const getMyTeams = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const teams = await TeamService.getMyTeams(
      req.user.userId,
    );

    return res.status(200).json({
      success: true,
      data: teams,
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
| Get All Teams
|--------------------------------------------------------------------------
*/

export const getAllTeams = async (req: AuthRequest, res: Response) => {
  try {
    const teams = await TeamService.getAllTeams();

    return res.status(200).json({
      success: true,
      data: teams,
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
| Get Team By Id
|--------------------------------------------------------------------------
*/

export const getTeamById = async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.getTeamById(req.params.id as string);

    return res.status(200).json({
      success: true,
      data: team,
    });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Update Team
|--------------------------------------------------------------------------
*/

export const updateTeam = async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.updateTeam(
      req.user.userId,
      req.params.id as string,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Team updated successfully.",
      data: team,
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
| Delete Team
|--------------------------------------------------------------------------
*/

export const deleteTeam = async (req: AuthRequest, res: Response) => {
  try {
    await TeamService.deleteTeam(req.user.userId, req.params.id as string);

    return res.status(200).json({
      success: true,
      message: "Team deleted successfully.",
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
| Add Player (Temporary)
|--------------------------------------------------------------------------
|
| This API is only for MVP.
| Production flow should use Team Invitations.
|
*/

export const addPlayerToTeam = async (req: AuthRequest, res: Response) => {
  try {
    const { playerId } = req.body;

    const team = await TeamService.addPlayerToTeam(
      req.user.userId,
      req.params.teamId as string,
      playerId,
    );

    return res.status(200).json({
      success: true,
      message: "Player added successfully.",
      data: team,
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
| Leave Team
|--------------------------------------------------------------------------
*/

export const leaveTeam = async (req: AuthRequest, res: Response) => {
  try {
    await TeamService.leaveTeam(
      req.user.userId,
      req.params.teamId as string,
    );

    return res.status(200).json({
      success: true,
      message: "You have left the team.",
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
| Remove Player
|--------------------------------------------------------------------------
*/

export const removePlayerFromTeam = async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.removePlayerFromTeam(
      req.user.userId,
      req.params.teamId as string,
      req.params.playerId as string,
    );

    return res.status(200).json({
      success: true,
      message: "Player removed successfully.",
      data: team,
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
| Set Captain
|--------------------------------------------------------------------------
*/

export const setCaptain = async (req: AuthRequest, res: Response) => {
  try {
    const { captainId } = req.body;

    const team = await TeamService.setCaptain(
      req.user.userId,
      req.params.teamId as string,
      captainId,
    );

    return res.status(200).json({
      success: true,
      message: "Captain updated successfully.",
      data: team,
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
| Revoke Vice Captain
|--------------------------------------------------------------------------
|
| Assigning a NEW vice-captain goes through the proposal/approval flow
| (see viceCaptainProposal module) - this endpoint only handles removal,
| which is instant and doesn't need the vice-captain's approval.
|
*/

export const revokeViceCaptain = async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.revokeViceCaptain(
      req.user.userId,
      req.params.teamId as string,
    );

    return res.status(200).json({
      success: true,
      message: "Vice Captain removed.",
      data: team,
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
| Update Vice-Captain Rights
|--------------------------------------------------------------------------
*/

export const updateViceCaptainRights = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const team = await TeamService.updateViceCaptainRights(
      req.user.userId,
      req.params.teamId as string,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Vice-Captain rights updated.",
      data: team,
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
| Update Team Statistics
|--------------------------------------------------------------------------
*/

export const updateTeamStats = async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.updateTeamStats(req.params.teamId as string);

    return res.status(200).json({
      success: true,
      message: "Team statistics updated successfully.",
      data: team,
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
| Create Local Player & Add To Team
|--------------------------------------------------------------------------
|
| Used from:
| Add Local Player BottomSheet
|
*/

export const createLocalPlayer = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const team = await TeamService.createLocalPlayer(
      req.user.userId,
      req.params.teamId as string,
      req.body,
    );

    return res.status(201).json({
      success: true,
      message: "Local player added successfully.",
      data: team,
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
| Check Team Name / Short Name Availability
|--------------------------------------------------------------------------
|
| GET /api/teams/name-available?teamName=Delhi%20Warriors&shortName=DW
|
| Optional `excludeTeamId` so the edit screen does not report a team's own
| name as taken.
|
| Always 200, even when a name is unavailable. "That name is taken" is a
| successful answer to the question asked, not an error - and the app polls
| this on every keystroke, so a 400 here would fill the console with noise
| and trip any global error toast the client has.
*/

export const checkTeamNames = async (req: AuthRequest, res: Response) => {
  try {
    const { teamName, shortName, excludeTeamId } = req.query;

    const result = await TeamService.checkNameAvailability(
      teamName === undefined ? undefined : String(teamName),
      shortName === undefined ? undefined : String(shortName),
      excludeTeamId ? String(excludeTeamId) : undefined,
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
