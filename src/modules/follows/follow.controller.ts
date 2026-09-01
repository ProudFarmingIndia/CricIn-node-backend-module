import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as FollowService from "./follow.service";

/*
|--------------------------------------------------------------------------
| Follow Controller
|--------------------------------------------------------------------------
|
| The previous version had no try/catch anywhere and no ownership checks.
| Express 5 does forward a rejected async handler to the global error
| handler, so nothing crashed - but every failure came back as a generic
| 500, including "you cannot follow yourself" and "player not found", which
| are the user's business and should read as such.
|
| followerId always comes from req.user, never from the body.
|
| The `as string` on every req.params read is not decoration: Express 5
| types a param as `string | string[]`, because a route CAN declare the
| same name twice. These routes do not, but tsc cannot know that - so the
| cast is how the rest of this codebase handles it too (see
| match.controller.ts).
|
*/

export const follow = async (req: AuthRequest, res: Response) => {
  try {
    const result = await FollowService.follow(req.user.userId, req.body);

    return res.status(result.created ? 201 : 200).json({
      success: true,

      data: result.follow,

      message: result.created ? "Followed." : "Already following.",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const unfollow = async (req: AuthRequest, res: Response) => {
  try {
    /*
    | targetType moved into the path. It used to be absent entirely, so the
    | delete matched on targetId alone.
    */

    const result = await FollowService.unfollow(
      req.user.userId,
      req.params.targetType as string,
      req.params.targetId as string,
    );

    return res.status(200).json({
      success: true,

      data: result,

      message: result.removed ? "Unfollowed." : "You were not following this.",
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
| Follow State + Counts For One Target
|--------------------------------------------------------------------------
|
| What the profile header and the Follow button both read.
|
*/

export const getStats = async (req: AuthRequest, res: Response) => {
  try {
    const data = await FollowService.getFollowStats(
      req.params.targetType as string,
      req.params.targetId as string,
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

export const getFollowers = async (req: AuthRequest, res: Response) => {
  try {
    const data = await FollowService.getFollowers(
      req.params.targetType as string,
      req.params.targetId as string,
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

/*
|--------------------------------------------------------------------------
| My Following
|--------------------------------------------------------------------------
|
| Scoped to the caller. There is deliberately no "following of an arbitrary
| user" route here - that would need its own privacy decision.
|
*/

export const getMyFollowing = async (req: AuthRequest, res: Response) => {
  try {
    const data = await FollowService.getFollowing(req.user.userId);

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
| Recalculate Counts
|--------------------------------------------------------------------------
|
| Repairs drift between the denormalised counters and the follows
| collection. Left open to any authenticated user because it is idempotent
| and only ever writes the true count - it cannot be used to inflate a
| number.
|
*/

export const recalculate = async (req: AuthRequest, res: Response) => {
  try {
    const data = await FollowService.recalculateFollowCounts(
      req.params.targetType as string,
      req.params.targetId as string,
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
