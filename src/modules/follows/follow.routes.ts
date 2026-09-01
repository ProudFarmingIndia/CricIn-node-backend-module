import { Router } from "express";

import {
  follow,
  unfollow,
  getStats,
  getFollowers,
  getMyFollowing,
  recalculate,
} from "./follow.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Follow Routes
|--------------------------------------------------------------------------
|
| Mounted at /api/follows.
|
| ORDERING MATTERS. The literal "/following" must be registered before any
| "/:param" route, or Express matches "following" as a parameter value and
| the route never fires. That was already latent in the old file, where
| DELETE "/:targetId" sat above GET "/following" - the two happened not to
| collide only because the methods differed.
|
| acceptFollowRequest is gone. It accepted a follow by id with no check
| that the caller was the person being followed, so anyone able to guess an
| id could accept a request addressed to someone else. Following is instant
| today, so nothing needs it; when request/approve is turned on it comes
| back with an ownership check.
|
*/

/*
| POST /api/follows
| body: { targetType: "PLAYER" | "TEAM", targetId }
*/

router.post("/", authMiddleware, follow);

/*
| GET /api/follows/following
| Everything the caller follows, players and teams.
*/

router.get("/following", authMiddleware, getMyFollowing);

/*
| GET /api/follows/stats/:targetType/:targetId
| { followers, following, isFollowing } for one target.
*/

router.get("/stats/:targetType/:targetId", authMiddleware, getStats);

/*
| GET /api/follows/followers/:targetType/:targetId
*/

router.get(
  "/followers/:targetType/:targetId",
  authMiddleware,
  getFollowers,
);

/*
| POST /api/follows/recalculate/:targetType/:targetId
| Repairs a drifted count.
*/

router.post(
  "/recalculate/:targetType/:targetId",
  authMiddleware,
  recalculate,
);

/*
| DELETE /api/follows/:targetType/:targetId
| Registered last: its two path params would otherwise swallow the literal
| segments above.
*/

router.delete("/:targetType/:targetId", authMiddleware, unfollow);

export default router;
