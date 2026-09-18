/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| liveStream.routes.ts
|
| Mounted at /api/live-streams
|
|--------------------------------------------------------------------------
*/

import { Router } from "express";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

import {
  createStream,
  quickStart,
  getStreams,
  getStreamKey,
  deleteStream,
  getStateAt,
  assignBroadcaster,
  respondToAssignment,
  getMyAssignments,
  stopStream,
  resumeStream,
  keepAlive,
  getVideoHighlights,
  getPlaybackToken,
  leaveStream,
  getLiveStreamingFeed,
} from "./liveStream.controller";

const router = Router();

/*
|--------------------------------------------------------------------------
| Live Streaming Feed
|--------------------------------------------------------------------------
|
| The "Live Streaming" category on Home and in the Matches tab. Static, so
| it must sit above /match/:matchId - otherwise "live" is read as a match
| id and every request 404s on a cast error.
|
*/

router.get("/live", authMiddleware, getLiveStreamingFeed);

/*
| Static route first - "quick-start" would otherwise be swallowed by
| /match/:matchId if the order were reversed.
*/

router.post("/quick-start", authMiddleware, quickStart);

/*
| The home-screen card for whoever is filming today. Static, so it has to
| sit above /match/:matchId.
*/

router.get("/my-assignments", authMiddleware, getMyAssignments);

router.post("/match/:matchId", authMiddleware, createStream);

router.get("/match/:matchId", authMiddleware, getStreams);

/*
| The overlay's own endpoint. Takes ?at=<ISO timestamp> - the moment the
| video is currently showing, not the moment the request is made.
*/

router.get("/match/:matchId/state", authMiddleware, getStateAt);

/*
| Scorer hands one angle to one player. The player then fetches their own
| key from the route below - which they could not otherwise reach.
*/

router.put("/match/:matchId/assign", authMiddleware, assignBroadcaster);

/*
| The invited person answers. No key is issued until they accept.
*/

router.put("/match/:matchId/respond", authMiddleware, respondToAssignment);

router.get("/match/:matchId/key/:angle", authMiddleware, getStreamKey);

/*
| Kill switch - cuts a broadcast that is already live. Separate from
| delete: the recording survives, so an accidental stop is recoverable.
*/

/*
| Video highlight markers for one match - timestamps into the recording,
| not clips. Registered above the /:angle routes so "highlights" is not
| read as an angle.
*/

router.get("/match/:matchId/highlights", authMiddleware, getVideoHighlights);

/*
| The viewer's own two calls. "token" and "leave" are registered above the
| /:angle routes for the same reason "highlights" is - otherwise Express
| reads them as an angle name.
*/

router.get(
  "/match/:matchId/playback-token/:angle",
  authMiddleware,
  getPlaybackToken,
);

router.put("/match/:matchId/leave", authMiddleware, leaveStream);

router.put("/match/:matchId/:angle/stop", authMiddleware, stopStream);

/*
| "Still going" - the answer to an idle warning during a rain break.
*/

router.put("/match/:matchId/:angle/keep-alive", authMiddleware, keepAlive);

router.put("/match/:matchId/:angle/resume", authMiddleware, resumeStream);

router.delete("/match/:matchId/:angle", authMiddleware, deleteStream);

export default router;