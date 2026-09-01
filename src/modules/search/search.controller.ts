import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as SearchService from "./search.service";

/*
|--------------------------------------------------------------------------
| Global Search
|--------------------------------------------------------------------------
*/

export const globalSearch = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { q = "" } = req.query;

    const result =
      await SearchService.globalSearch(
        q as string,
        req.user.userId
      );

    return res.status(200).json({
      success: true,
      data: result,
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
| Search Players
|--------------------------------------------------------------------------
*/

export const searchPlayers = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { q = "" } = req.query;

    const players =
      await SearchService.searchPlayers(
        q as string,
        req.user.userId
      );

    return res.status(200).json({
      success: true,
      data: players,
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
| Search Player By Mobile
|--------------------------------------------------------------------------
|
| Used while inviting player into team.
|
*/

export const searchPlayerByMobile =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const { mobile = "" } =
        req.query;

      const player =
        await SearchService.searchPlayerByMobile(
          mobile as string,
          req.user.userId
        );

      return res.status(200).json({
        success: true,
        data: player,
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
| Search Teams
|--------------------------------------------------------------------------
*/

export const searchTeams = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { q = "" } = req.query;

    /*
    | userId is now passed through so each team carries the caller's
    | follow state (isFollowing / followerCount) and the card can render
    | the right button without a second request.
    */

    const teams =
      await SearchService.searchTeams(
        q as string,
        req.user.userId
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
| Search Grounds
|--------------------------------------------------------------------------
*/

export const searchGrounds = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { q = "" } = req.query;

    const grounds =
      await SearchService.searchGrounds(
        q as string
      );

    return res.status(200).json({
      success: true,
      data: grounds,
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
| Search Tournaments
|--------------------------------------------------------------------------
*/

export const searchTournaments =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const { q = "" } = req.query;

      const tournaments =
        await SearchService.searchTournaments(
          q as string
        );

      return res.status(200).json({
        success: true,
        data: tournaments,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  };