import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as StatsService from "./stats.service";

const RANGES = ["today", "week", "month", "all"];

/*
| Query params arrive as string | string[] and an unset one arrives as "".
| Both become undefined here so the service sees "no filter" rather than a
| filter that matches nothing.
*/

const str = (value: any): string | undefined => {
  if (Array.isArray(value)) {
    value = value[0];
  }

  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed.length > 0 ? trimmed : undefined;
};

export const getLeaderboards = async (req: AuthRequest, res: Response) => {
  try {
    const rawRange = str(req.query.range) || "all";

    const range = RANGES.includes(rawRange) ? rawRange : "all";

    const data = await StatsService.getLeaderboards({
      range: range as StatsService.StatsRange,

      city: str(req.query.city),

      state: str(req.query.state),

      country: str(req.query.country),

      ballType: str(req.query.ballType),

      matchType: str(req.query.matchType),

      limit: req.query.limit ? Number(req.query.limit) : 10,

      minBalls: req.query.minBalls ? Number(req.query.minBalls) : undefined,
    });

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

export const getTeamRankings = async (req: AuthRequest, res: Response) => {
  try {
    const data = await StatsService.getTeamRankings({
      city: str(req.query.city),

      state: str(req.query.state),

      country: str(req.query.country),

      teamType: str(req.query.teamType),

      minMatches: req.query.minMatches
        ? Number(req.query.minMatches)
        : undefined,

      limit: req.query.limit ? Number(req.query.limit) : 25,
    });

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

export const getFilterOptions = async (_req: AuthRequest, res: Response) => {
  try {
    const data = await StatsService.getFilterOptions();

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
