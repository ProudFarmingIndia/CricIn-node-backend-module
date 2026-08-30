import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as HighlightService from "./highlight.service";

/*
|--------------------------------------------------------------------------
| Highlight Controller
|--------------------------------------------------------------------------
*/

const RANGES = ["today", "week", "month", "all"];

export const getHighlights = async (req: AuthRequest, res: Response) => {
  try {
    const rawRange = (req.query.range as string) || "week";

    /*
    | An unrecognised range falls back to "week" rather than erroring - a
    | stale client sending an old value should still get a usable feed.
    */

    const range = RANGES.includes(rawRange) ? rawRange : "week";

    const data = await HighlightService.getHighlights({
      range: range as HighlightService.HighlightRange,

      city: (req.query.city as string) || undefined,

      state: (req.query.state as string) || undefined,

      country: (req.query.country as string) || undefined,

      limit: req.query.limit ? Number(req.query.limit) : 10,
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

/*
|--------------------------------------------------------------------------
| One Match
|--------------------------------------------------------------------------
|
| No time range here - the match itself is the window. The limit is higher
| because this is the whole story of one game rather than a top-ten across
| everything.
|
*/

export const getMatchHighlights = async (req: AuthRequest, res: Response) => {
  try {
    const data = await HighlightService.getHighlights({
      matchId: req.params.matchId as string,

      limit: req.query.limit ? Number(req.query.limit) : 20,
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
