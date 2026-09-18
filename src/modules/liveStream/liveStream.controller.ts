/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| liveStream.controller.ts
|
|--------------------------------------------------------------------------
*/

import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as LiveStreamService from "./liveStream.service";
import * as OverlayService from "./overlay.service";
import * as VideoHighlightsService from "./videoHighlights.service";

import { releaseViewerSlot } from "./viewerRegistry";

export const createStream = async (req: AuthRequest, res: Response) => {
  try {
    const data = await LiveStreamService.createStream(
      req.params.matchId as string,
      req.user.userId,
      req.body.angle,
    );

    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not start the live stream.",
    });
  }
};

export const quickStart = async (req: AuthRequest, res: Response) => {
  try {
    const data = await LiveStreamService.quickStart(
      req.user.userId,
      req.body.angle,
    );

    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not start the live stream.",
    });
  }
};

export const getStreams = async (req: AuthRequest, res: Response) => {
  try {
    const data = await LiveStreamService.getStreams(
      req.params.matchId as string,
      req.user?.userId,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not load the live streams.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Assign Broadcaster
|--------------------------------------------------------------------------
|
| Body: { angle: "front" | "third", userId: string | null }
|
| null clears the assignment - which is how you take the camera off
| someone who has left the ground.
|
*/

export const assignBroadcaster = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const data = await LiveStreamService.assignBroadcaster(
      req.params.matchId as string,
      req.user.userId,
      req.body.angle,
      req.body.userId ?? null,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not assign the broadcaster.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Respond To A Broadcast Invite
|--------------------------------------------------------------------------
|
| Body: { angle: "front" | "third", accept: true | false }
|
| Until this is called the invite grants nothing - no key is issued on a
| pending assignment.
|
*/

export const respondToAssignment = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const data = await LiveStreamService.respondToAssignment(
      req.params.matchId as string,
      req.user.userId,
      req.body.angle,
      req.body.accept === true,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not answer this request.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| My Assignments
|--------------------------------------------------------------------------
|
| The home-screen card for whoever is filming. Its own endpoint because
| every other feed filters on team membership, and the camera operator is
| routinely in neither squad.
|
*/

export const getMyAssignments = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const data = await LiveStreamService.getMyAssignments(
      req.user.userId,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not load your assignments.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Playback Token
|--------------------------------------------------------------------------
|
| What the viewer's player asks for before it can show anything. Also the
| one place the concurrent-viewer cap can refuse someone before Mux starts
| billing delivery for them - which is why a refusal here is a 429 and not
| a silent black screen.
|
*/

export const getPlaybackToken = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const data = await LiveStreamService.getPlaybackToken(
      req.params.matchId as string,
      req.user.userId,
      req.params.angle as string,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not start playback.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Leave
|--------------------------------------------------------------------------
|
| Frees the viewer slot when the player closes. Best-effort: the lease
| expires on its own, so this never fails the request.
|
*/

export const leaveStream = async (req: AuthRequest, res: Response) => {
  releaseViewerSlot(req.params.matchId as string, req.user.userId);

  res.status(200).json({ success: true, data: { left: true } });
};

/*
|--------------------------------------------------------------------------
| Live Streaming Feed
|--------------------------------------------------------------------------
|
| Every match with a camera on it right now. Open to any logged-in user -
| this is the discovery surface, so gating it by team membership would
| defeat the point.
|
*/

export const getLiveStreamingFeed = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const data = await LiveStreamService.getLiveStreamingFeed(
      Number(req.query.limit) || 30,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not load live streams.",
    });
  }
};

export const getStreamKey = async (req: AuthRequest, res: Response) => {
  try {
    const data = await LiveStreamService.getStreamKey(
      req.params.matchId as string,
      req.user.userId,
      req.params.angle as string,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not load the stream key.",
    });
  }
};

export const deleteStream = async (req: AuthRequest, res: Response) => {
  try {
    const data = await LiveStreamService.deleteStream(
      req.params.matchId as string,
      req.user.userId,
      req.params.angle as string,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not delete the live stream.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Overlay State
|--------------------------------------------------------------------------
|
| Called by the video player roughly once a second with the wall-clock
| moment currently on screen. Everything the broadcast overlay draws comes
| from this one response.
|
*/

export const getStateAt = async (req: AuthRequest, res: Response) => {
  try {
    const data = await OverlayService.getStateAt(
      req.params.matchId as string,
      req.query.at as string | undefined,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not load the match state.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Stop / Resume
|--------------------------------------------------------------------------
|
| The kill switch. Reassigning a camera rotates the key and stops the NEXT
| connection; this cuts the one that is already open.
|
*/

export const stopStream = async (req: AuthRequest, res: Response) => {
  try {
    const data = await LiveStreamService.stopStream(
      req.params.matchId as string,
      req.user.userId,
      req.params.angle as string,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not stop the stream.",
    });
  }
};

export const resumeStream = async (req: AuthRequest, res: Response) => {
  try {
    const data = await LiveStreamService.resumeStream(
      req.params.matchId as string,
      req.user.userId,
      req.params.angle as string,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not resume the stream.",
    });
  }
};


/*
|--------------------------------------------------------------------------
| Keep Alive
|--------------------------------------------------------------------------
|
| Answers the idle warning during a rain break. Without it a stoppage
| looks identical to an abandoned phone.
|
*/

export const keepAlive = async (req: AuthRequest, res: Response) => {
  try {
    const data = await LiveStreamService.keepAlive(
      req.params.matchId as string,
      req.user.userId,
      req.params.angle as string,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not extend the stream.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Video Highlights
|--------------------------------------------------------------------------
|
| ?playerId= narrows it to one player's own moments - the personal reel.
|
*/

export const getVideoHighlights = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const data = await VideoHighlightsService.getVideoHighlights(
      req.params.matchId as string,
      req.query.playerId as string | undefined,
    );

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Could not load the highlights.",
    });
  }
};