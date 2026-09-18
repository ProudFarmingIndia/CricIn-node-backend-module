/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| liveStream.service.ts
|
| Description:
| Creating, listing and tearing down Mux live streams for a match.
|
|--------------------------------------------------------------------------
*/

import mux, {
  RTMPS_URL,
  ANGLES,
  RECONNECT_WINDOW_SECONDS,
  IDLE_END_MINUTES,
  SIGNED_PLAYBACK,
  PLAYBACK_TOKEN_MINUTES,
  StreamAngle,
} from "../../config/mux";

import LiveStream from "./liveStream.model";
import Match from "../matches/match.model";

import { claimViewerSlot, getViewerCount } from "./viewerRegistry";

import { encrypt, decrypt } from "../../shared/utils/streamKeyCrypto";

import Player from "../players/player.model";

import { createNotification } from "../notifications/notification.service";
import { NOTIFICATION_TYPES } from "../notifications/notification.types";
import {
  sendBroadcastInviteNotification,
  sendBroadcastInviteAnsweredNotification,
} from "../notifications/notification.helper";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

const assertAngle = (angle: string): StreamAngle => {
  const a = String(angle || "front").toLowerCase() as StreamAngle;

  if (!ANGLES.includes(a)) {
    throw new AppError(
      `angle must be one of: ${ANGLES.join(", ")}`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  return a;
};

/*
|--------------------------------------------------------------------------
| Who May Broadcast
|--------------------------------------------------------------------------
|
| The match creator, the assigned scorer, or whoever sent the challenge.
| Deliberately the same set that can already score the match - a stream
| key is the same kind of trust as the ability to write the scorecard.
|
*/

/*
|--------------------------------------------------------------------------
| Exactly One Person
|--------------------------------------------------------------------------
|
| THE SCORER. Not "a captain", not "either captain", not whoever sent the
| challenge - the one person actually recording this match.
|
| This used to accept userId OR scorerUserId OR inviteSenderUserId. That
| set is wrong in a way that only shows up with two real accounts on one
| match: inviteSenderUserId is the captain who SENT the challenge, so on
| every challenged match the OPPOSING captain was a stream manager too.
| Both captains saw "Manage cameras", both could assign broadcasters, and
| both could stop each other's stream mid-match.
|
| The rule now:
|
|   scorerUserId set  ->  only that user. Scoring has started and one
|                         person owns it. Transferring scoring (see
|                         transferScoring in match.service) moves camera
|                         control with it, which is correct - the camera
|                         and the scorecard are the same job.
|
|   not set yet       ->  the match CREATOR. Before anyone starts scoring
|                         somebody still has to be able to set the cameras
|                         up, and the creator is the only unambiguous
|                         answer.
|
| One returned value, used by both the write paths (assertCanManage) and
| the read path (isManager in getStreams), so the panel a user is shown
| and the actions they can actually perform can never disagree.
|
*/

const streamOwnerId = (match: any): string | null => {
  const owner = match?.scorerUserId || match?.userId;

  return owner ? String(owner) : null;
};

const assertCanManage = async (matchId: string, userId: string) => {
  const match = await Match.findById(matchId).select(
    "userId scorerUserId status",
  );

  if (!match) {
    throw new AppError("Match not found.", HTTP_STATUS.NOT_FOUND);
  }

  const owner = streamOwnerId(match);

  if (!owner || owner !== String(userId)) {
    throw new AppError(
      "Sirf is match ka scorer hi cameras control kar sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  return match;
};

/*
|--------------------------------------------------------------------------
| Create Stream
|--------------------------------------------------------------------------
|
| Idempotent on (matchId, angle). A second call returns the existing
| stream instead of minting another one - the "Go Live" button gets
| double-tapped constantly on a flaky ground connection, and every extra
| Mux stream is a recording that bills storage every month whether anyone
| watches it or not.
|
*/

export const createStream = async (
  matchId: string,
  userId: string,
  angleInput: string,
) => {
  const angle = assertAngle(angleInput);

  await assertCanManage(matchId, userId);

  const existing = await LiveStream.findOne({ matchId, angle }).select(
    "+streamKeyEnc",
  );

  if (existing) {
    return {
      reused: true,
      angle: existing.angle,
      status: existing.status,
      rtmpsUrl: RTMPS_URL,
      streamKey: decrypt(existing.streamKeyEnc as string),
      playbackId: existing.playbackId,
      playbackUrl: `https://stream.mux.com/${existing.playbackId}.m3u8`,
    };
  }

  const muxStream = await mux.video.liveStreams.create({
    /*
    |--------------------------------------------------------------------------
    | Signed, Not Public
    |--------------------------------------------------------------------------
    |
    | A public playback ID is a URL that plays anywhere - a browser, VLC,
    | somebody else's website. "In-app only" is not a thing you can build
    | on top of that; the app is simply where it happens to be opened.
    |
    | Signed means the URL is inert without a short-lived JWT this backend
    | mints per viewer, after checking they are logged in and the match is
    | not over its viewer cap. Forwarded to WhatsApp it is dead within the
    | hour.
    |
    | Falls back to public when no signing key is configured - see the
    | longer note in config/mux.ts. That keeps local testing working
    | before the keys exist, and warns loudly at boot.
    */

    playback_policy: SIGNED_PLAYBACK ? ["signed"] : ["public"],

    /*
    | "reduced" lands around 12-20s glass-to-glass; "standard" is 25-30s.
    | Every second here is a second the scorecard has to be held back to
    | stay in sync, so the lower one is worth taking.
    */

    latency_mode: "reduced",

    /*
    | Covers both a dropped connection and a deliberate camera handover -
    | see the note in config/mux.ts. Must be non-zero: reduced-latency
    | streams get no reconnect window at all by default.
    */

    reconnect_window: RECONNECT_WINDOW_SECONDS,

    /*
    | new_asset_settings is deliberately absent. Mux records every live
    | stream regardless, and phase one deletes that recording the moment
    | it is ready (see jobs/manageRecordings) - so there is nothing to
    | configure a playback policy for.
    */

    passthrough: JSON.stringify({ matchId, angle }),
  });

  const playbackId = muxStream.playback_ids?.[0]?.id;

  if (!playbackId) {
    throw new AppError(
      "Mux did not return a playback ID.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
  }

  const doc = await LiveStream.create({
    matchId,
    angle,
    muxLiveStreamId: muxStream.id,
    streamKeyEnc: encrypt(muxStream.stream_key as string),
    playbackId,

    /*
    | A stream Mux has only just minted is always idle - it becomes active
    | when a broadcaster actually connects, and that transition arrives on
    | the webhook. Trusting the create response here would paint a LIVE
    | badge on a match nobody has started filming.
    */

    status: "idle",

    createdBy: userId,
  });

  return {
    reused: false,
    angle: doc.angle,
    status: doc.status,
    rtmpsUrl: RTMPS_URL,
    streamKey: muxStream.stream_key,
    playbackId: doc.playbackId,
    playbackUrl: `https://stream.mux.com/${doc.playbackId}.m3u8`,
  };
};

/*
|--------------------------------------------------------------------------
| Quick Start
|--------------------------------------------------------------------------
|
| "Go Live" pressed with no match behind it. A draft Match is created
| first so the stream, its recording and every ball scored against it all
| have somewhere to live from the first second.
|
| The alternative - letting a stream exist unattached and joining it to a
| match later - means nullable foreign keys everywhere and a migration
| the first time someone streams for an hour before filling in the teams.
|
| The draft is invisible in every public listing until the user completes
| it (see the status filter note in match.service).
|
*/

export const quickStart = async (userId: string, angleInput: string) => {
  const angle = assertAngle(angleInput);

  /*
  | Cast because "draft" is a status this model only gained for this
  | feature - see the match.model change that adds it to the enum, and
  | makes matchTitle/teamA/teamB optional while a match is still one.
  */

  const match: any = await Match.create({
    userId,
    status: "draft",
    matchTitle: "Untitled match",
    startTime: new Date(),
  } as any);

  const stream = await createStream(
    String(match._id),
    userId,
    angle,
  );

  return {
    ...stream,
    matchId: String(match._id),
    draft: true,
  };
};

/*
|--------------------------------------------------------------------------
| Assign A Broadcaster
|--------------------------------------------------------------------------
|
| The scorer hands one angle to one player. That player can then fetch
| that angle's key and nothing else - not the other angle's, not the
| ability to create or delete streams, and not scoring.
|
| Re-assigning is allowed and is the intended way to fix "wrong player
| got it" mid-match. Passing null clears the assignment.
|
*/

export const assignBroadcaster = async (
  matchId: string,
  userId: string,
  angleInput: string,
  assigneeUserId: string | null,
) => {
  const angle = assertAngle(angleInput);

  const match: any = await assertCanManage(matchId, userId);

  const doc = await LiveStream.findOne({ matchId, angle });

  if (!doc) {
    throw new AppError(
      "Create the stream for this angle first, then assign it.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  const previous = doc.assignedTo ? String(doc.assignedTo) : null;

  /*
  |--------------------------------------------------------------------------
  | Taking It Away Means Rotating The Key
  |--------------------------------------------------------------------------
  |
  | Clearing assignedTo only stops them ASKING for the key again. It does
  | nothing about the one they already copied into Larix - that string is a
  | Mux credential, and it keeps working until Mux is told otherwise.
  |
  | So a scorer who realised they gave the camera to the wrong person, and
  | reassigned it, would still have that person able to broadcast onto the
  | match. The fix has to happen at Mux, not in our database:
  | resetStreamKey invalidates the old key and mints a new one, which the
  | correct person then fetches.
  |
  | Only rotated when the holder actually changes - re-confirming the same
  | person must not kill the key they are mid-match with.
  |
  */

  const holderChanged =
    !!previous && String(previous) !== String(assigneeUserId ?? "");

  if (holderChanged) {
    try {
      const reset = await mux.video.liveStreams.resetStreamKey(
        doc.muxLiveStreamId as string,
      );

      if (reset?.stream_key) {
        (doc as any).streamKeyEnc = encrypt(reset.stream_key);
      }
    } catch (error: any) {
      /*
      | If Mux would not rotate, the old key is still live - so refuse
      | rather than report a revocation that did not happen.
      */

      throw new AppError(
        "Could not revoke the old stream key. Try again.",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /*
  | Clearing an assignment - taking the camera off someone who has left.
  */

  if (!assigneeUserId) {
    doc.assignedTo = null;
    (doc as any).assignmentStatus = "none";
    (doc as any).assignedBy = null;
    (doc as any).assignedAt = null;

    await doc.save();

    if (previous) {
      await createNotification({
        receiverId: previous,
        actorId: userId,
        type: NOTIFICATION_TYPES.BROADCAST_INVITE_REVOKED,
        title: "Camera reassigned",
        message: `You are no longer filming ${match.matchTitle || "this match"}.`,
        data: { matchId, angle },
      }).catch(() => undefined);
    }

    return { angle, assignedTo: null, assignmentStatus: "none" };
  }

  doc.assignedTo = assigneeUserId as any;
  (doc as any).assignmentStatus = "pending";
  (doc as any).assignedBy = userId;
  (doc as any).assignedAt = new Date();

  await doc.save();

  /*
  | The invite IS the discovery mechanism. Someone in neither squad has no
  | feed that would ever show them this match, so a failed notification
  | means they simply never learn they were asked - hence the catch, so a
  | notification outage cannot also fail the assignment itself.
  */

  const actor: any = await Player.findOne({ userId })
    .select("playerName")
    .lean();

  await sendBroadcastInviteNotification({
    receiverId: String(assigneeUserId),
    actorId: String(userId),
    matchId: String(matchId),
    angle,
    matchTitle: match.matchTitle || "a match",
    actorName: actor?.playerName,
  }).catch(() => undefined);

  /*
  | The person who lost the camera is told too. Without this their
  | "you are filming this match" card just vanishes and they turn up at the
  | ground expecting to shoot.
  */

  if (holderChanged && previous) {
    await createNotification({
      receiverId: previous,
      actorId: userId,
      type: NOTIFICATION_TYPES.BROADCAST_INVITE_REVOKED,
      title: "Camera reassigned",
      message: `You are no longer filming ${match.matchTitle || "this match"}.`,
      data: { matchId, angle },
    }).catch(() => undefined);
  }

  return {
    angle,

    assignedTo: doc.assignedTo,

    assignmentStatus: "pending",

    keyRotated: holderChanged,

    /*
    | Mid-match handover is a race the scorer has to be told about. The old
    | key is dead the moment this returns, so the picture is already gone -
    | and Mux only treats the two phones as one continuous session if the
    | new one connects inside the reconnect window. Miss it and the match
    | splits into two recordings and every viewer's player reports the
    | stream as ended.
    */

    handoverWindowSeconds: holderChanged
      ? RECONNECT_WINDOW_SECONDS
      : null,

    note: holderChanged
      ? `Old key revoked. The new broadcaster should connect within ${RECONNECT_WINDOW_SECONDS}s to keep it one continuous stream.`
      : undefined,
  };
};

/*
|--------------------------------------------------------------------------
| Kill Switch
|--------------------------------------------------------------------------
|
| Someone is broadcasting RIGHT NOW and it has to stop this second - the
| wrong feed, the wrong content, a phone left running in a bag.
|
| Reassigning does not help here: rotating the key stops the NEXT
| connection, not the one already open. disable() cuts the live session at
| Mux and refuses further connections until it is enabled again.
|
| Deliberately separate from delete: the recording survives, so an
| accidental stop mid-match is recoverable.
|
*/

export const stopStream = async (
  matchId: string,
  userId: string,
  angleInput: string,
) => {
  const angle = assertAngle(angleInput);

  await assertCanManage(matchId, userId);

  const doc = await LiveStream.findOne({ matchId, angle });

  if (!doc) {
    throw new AppError(
      "No stream found for this angle.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  await mux.video.liveStreams.disable(doc.muxLiveStreamId as string);

  doc.status = "disabled";
  (doc as any).endedAt = new Date();

  await doc.save();

  return { angle, stopped: true };
};

/*
| Undo a stop. The key is rotated on the way back so that whoever caused
| the problem cannot simply reconnect with what they still have.
*/

export const resumeStream = async (
  matchId: string,
  userId: string,
  angleInput: string,
) => {
  const angle = assertAngle(angleInput);

  await assertCanManage(matchId, userId);

  const doc = await LiveStream.findOne({ matchId, angle });

  if (!doc) {
    throw new AppError(
      "No stream found for this angle.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  await mux.video.liveStreams.enable(doc.muxLiveStreamId as string);

  const reset = await mux.video.liveStreams.resetStreamKey(
    doc.muxLiveStreamId as string,
  );

  if (reset?.stream_key) {
    (doc as any).streamKeyEnc = encrypt(reset.stream_key);
  }

  doc.status = "idle";
  (doc as any).endedAt = null;

  await doc.save();

  return {
    angle,
    resumed: true,
    keyRotated: true,
    note: "The stream key has changed - the broadcaster must fetch it again.",
  };
};

/*
|--------------------------------------------------------------------------
| Accept Or Decline
|--------------------------------------------------------------------------
|
| Only the invited person can answer, and only their own invite. Until
| this runs the assignment grants nothing at all.
|
*/

export const respondToAssignment = async (
  matchId: string,
  userId: string,
  angleInput: string,
  accept: boolean,
) => {
  const angle = assertAngle(angleInput);

  const doc = await LiveStream.findOne({ matchId, angle });

  if (!doc || String(doc.assignedTo) !== String(userId)) {
    throw new AppError(
      "You have not been asked to film this angle.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  (doc as any).assignmentStatus = accept ? "accepted" : "declined";

  /*
  | A decline releases the slot immediately, so the scorer can hand it to
  | somebody else without an extra "clear" step.
  */

  if (!accept) doc.assignedTo = null;

  await doc.save();

  const [match, actor]: any[] = await Promise.all([
    Match.findById(matchId).select("matchTitle").lean(),
    Player.findOne({ userId }).select("playerName").lean(),
  ]);

  const notifyId = (doc as any).assignedBy;

  if (notifyId) {
    await sendBroadcastInviteAnsweredNotification({
      receiverId: String(notifyId),
      actorId: String(userId),
      matchId: String(matchId),
      angle,
      matchTitle: match?.matchTitle || "a match",
      actorName: actor?.playerName,
      accepted: accept,
    }).catch(() => undefined);
  }

  return { angle, accepted: accept };
};

/*
|--------------------------------------------------------------------------
| My Assignments
|--------------------------------------------------------------------------
|
| The home screen card for whoever is filming today.
|
| This endpoint exists because every other feed in the app filters on team
| membership - getLiveMatches, getUpcomingMatches, all of them start from
| getManagedTeamIds. A camera operator who belongs to neither side matches
| none of those queries, so without this the match they are supposed to
| film does not appear anywhere in their app.
|
*/

export const getMyAssignments = async (userId: string) => {
  const streams = await LiveStream.find({
    assignedTo: userId,
    assignmentStatus: { $in: ["pending", "accepted"] },
  }).lean();

  if (!streams.length) return { count: 0, assignments: [] };

  const matches: any[] = await Match.find({
    _id: { $in: streams.map((s) => s.matchId) },
    status: { $in: ["draft", "upcoming", "live"] },
  })
    .select("matchTitle status venueName scheduledStartTime startTime teamA teamB")
    .populate("teamA", "teamName logo")
    .populate("teamB", "teamName logo")
    .lean();

  const assignments = streams
    .map((s) => {
      const match = matches.find(
        (m) => String(m._id) === String(s.matchId),
      );

      if (!match) return null; // completed or cancelled - not their problem any more

      return {
        matchId: String(s.matchId),
        angle: s.angle,
        assignmentStatus: (s as any).assignmentStatus,
        streamStatus: s.status,
        needsResponse: (s as any).assignmentStatus === "pending",
        match: {
          title: match.matchTitle,
          status: match.status,
          venue: match.venueName,
          startTime: match.startTime || match.scheduledStartTime,
          teamA: match.teamA,
          teamB: match.teamB,
        },
      };
    })
    .filter(Boolean);

  return { count: assignments.length, assignments };
};


/*
|--------------------------------------------------------------------------
| Angle State
|--------------------------------------------------------------------------
|
| The scorer needs to know WHY a camera is not up, because the fix is
| different every time - chase a person, wait, or press stop. `status`
| alone cannot tell "nobody was assigned" apart from "assigned and they
| have not answered" apart from "accepted and still walking over".
|
*/

type AngleState =
  | "no_assignee"
  | "awaiting_response"
  | "declined"
  | "ready"
  | "live"
  | "reconnecting"
  | "stopped"
  | "ended";

const angleState = (s: any): AngleState => {
  if (s.status === "active") return "live";

  if (s.status === "disconnected") return "reconnecting";

  if (s.status === "disabled") return "stopped";

  if (!s.assignedTo) {
    return s.assignmentStatus === "declined" ? "declined" : "no_assignee";
  }

  if (s.assignmentStatus === "pending") return "awaiting_response";

  /* Accepted, never connected vs accepted and already finished. */
  return s.startedAt ? "ended" : "ready";
};

const ANGLE_ACTION: Record<AngleState, string> = {
  no_assignee: "Kisi ko ye camera assign karo.",
  awaiting_response: "Invite bheja hai - abhi accept nahi kiya.",
  declined: "Inhone mana kar diya - kisi aur ko do.",
  ready: "Accept ho gaya, abhi connect nahi kiya.",
  live: "",
  reconnecting: "Network drop hua - apne aap wapas aa raha hai.",
  stopped: "Tumne stop kiya tha - resume karke chalu karo.",
  ended: "Ye camera band ho gaya.",
};

const angleAction = (s: any): string => ANGLE_ACTION[angleState(s)];

const controlSummary = (streams: any[]): string => {
  if (!streams.length) return "Koi camera set nahi hai.";

  const live = streams.filter((x) => x.status === "active").length;

  if (streams.length === 1) {
    return live === 1
      ? "1 camera live hai. Doosra angle add kar sakte ho."
      : "Camera abhi live nahi hai.";
  }

  if (live === 2) return "Dono camera live hain.";

  if (live === 1) {
    const down = streams.find((x) => x.status !== "active");

    return `1 of 2 live. ${down.angle === "third" ? "Third umpire" : "Front"} camera down hai.`;
  }

  return "Koi camera live nahi hai.";
};

/*
|--------------------------------------------------------------------------
| List Streams
|--------------------------------------------------------------------------
|
| What the viewer's player calls. Returns playback URLs for every angle
| and never the stream key - select:false on the model plus the toJSON
| transform make that structural rather than something this function has
| to remember.
|
| It also answers the harder question: when there is NO picture, why not.
| A player with a dead URL and no explanation is the worst thing a viewer
| can be shown - they assume the app is broken and close it. So every
| response carries a machine-readable `reason`, a line of copy, and enough
| match detail for the app to render a proper card in the video's place.
|
*/

const FALLBACK_COPY: Record<string, string> = {
  no_stream: "Is match ki live streaming set nahi hui hai.",
  waiting: "Camera connect ho raha hai. Match abhi shuru hone wala hai.",
  reconnecting: "Network slow hai, stream wapas aa rahi hai...",
  ended: "Live streaming khatam ho gayi. Replay jald hi milega.",
  replay_ready: "Match khatam - replay dekh sakte ho.",
  live: "",
};

export const getStreams = async (
  matchId: string,
  viewerUserId?: string,
) => {
  const [streams, match] = await Promise.all([
    LiveStream.find({ matchId }).sort({ angle: 1 }),

    Match.findById(matchId)
      .select(
        "matchTitle status venueName scheduledStartTime startTime overs matchType teamA teamB userId scorerUserId inviteSenderUserId",
      )
      .populate("teamA", "teamName logo")
      .populate("teamB", "teamName logo")
      .lean(),
  ]);

  /*
  | One lookup for both assignees. The scorer's panel shows names, not
  | ObjectIds - "Rahul has not accepted yet" is actionable, a hex string
  | is not.
  */

  const assigneeIds = streams
    .map((s) => s.assignedTo)
    .filter(Boolean)
    .map(String);

  const names = new Map<string, string>();

  if (assigneeIds.length) {
    const players: any[] = await Player.find({
      userId: { $in: assigneeIds },
    })
      .select("userId playerName")
      .lean();

    for (const p of players) {
      names.set(String(p.userId), p.playerName);
    }
  }

  /*
  | Same single rule the write paths use - see streamOwnerId. Deriving it
  | twice is how the read and write sides drift apart and a user ends up
  | with a control panel whose buttons all return 403.
  */

  const isManager = !!(
    viewerUserId &&
    match &&
    streamOwnerId(match) === String(viewerUserId)
  );

  const isLive = streams.some((s) => s.status === "active");

  const anyReconnecting = streams.some(
    (s) => s.status === "disconnected",
  );

  const anyReplay = streams.some((s) => s.recordingPlaybackId);

  const everStarted = streams.some((s) => s.startedAt);

  /*
  | Order matters: "reconnecting" has to beat "ended", because a phone
  | that dropped 20 seconds ago is not over - telling the viewer it has
  | ended makes them leave a match that is about to come back.
  */

  const reason = !streams.length
    ? "no_stream"
    : isLive
      ? "live"
      : anyReconnecting
        ? "reconnecting"
        : anyReplay
          ? "replay_ready"
          : everStarted
            ? "ended"
            : "waiting";

  return {
    matchId,

    isLive,

    angleCount: streams.length,

    reason,

    message: FALLBACK_COPY[reason] ?? "",

    /*
    | Sent so the app can show the fixture - teams, venue, start time -
    | wherever the video would have been. Never an empty black box.
    */

    match: match
      ? {
          title: (match as any).matchTitle,
          status: (match as any).status,
          venue: (match as any).venueName,
          startTime:
            (match as any).startTime ||
            (match as any).scheduledStartTime,
          overs: (match as any).overs,
          matchType: (match as any).matchType,
          teamA: (match as any).teamA,
          teamB: (match as any).teamB,
        }
      : null,

    /*
    | If the caller is one of the assigned broadcasters, tell them which
    | angle is theirs so the app can open the broadcast screen straight
    | away instead of making them pick.
    */

    myAngle:
      viewerUserId
        ? streams.find(
            (s) => String(s.assignedTo) === String(viewerUserId),
          )?.angle ?? null
        : null,

    angles: streams.map((s) => {
      const mine = String(s.assignedTo) === String(viewerUserId);

      return {
        angle: s.angle,
        status: s.status,
        live: s.status === "active",

        /*
        | Who is holding the camera is operational detail for the people
        | running the match, not something every follower watching needs -
        | so it is only filled in for a manager or for the assignee
        | themselves. Everyone else sees null.
        */

        assignedTo: isManager || mine ? s.assignedTo : null,

        assignedName:
          isManager || mine
            ? names.get(String(s.assignedTo)) ?? null
            : null,

        assignmentStatus:
          isManager || mine ? (s as any).assignmentStatus : null,

        /*
        | One field the scorer's panel can switch on. Derived here rather
        | than in the app because "assigned but not accepted" and "accepted
        | but not connected" look identical from status alone, and they
        | need completely different things done about them.
        */

        state: isManager ? angleState(s) : null,

        uptimeSeconds:
          s.status === "active" && s.startedAt
            ? Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000)
            : null,

        /*
        | The playback ID is sent so the app can ask for a token for this
        | specific angle. On a signed stream the bare URL below plays
        | nothing on its own - it needs ?token=<jwt> appended, which is
        | the whole point.
        */

        playbackId: s.playbackId,

        playbackUrl: `https://stream.mux.com/${s.playbackId}.m3u8`,
        replayUrl: s.recordingPlaybackId
          ? `https://stream.mux.com/${s.recordingPlaybackId}.m3u8`
          : null,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      };
    }),

    /*
    | Tells the app whether it must fetch a playback token before handing
    | the URL to the player. Hard-coding "always fetch" would break the
    | day the signing keys are missing; hard-coding "never" is the bug
    | this whole change exists to fix.
    */

    signed: SIGNED_PLAYBACK,

    viewerCount: getViewerCount(matchId),

    /*
    |--------------------------------------------------------------------------
    | Scorer's Control Panel
    |--------------------------------------------------------------------------
    |
    | Only for whoever is running the match. The scorer is already busy
    | scoring every ball - they cannot be reading two status fields and
    | working out what they mean. This says the thing directly: how many
    | cameras are up, and what needs doing about the ones that are not.
    |
    */

    control: isManager
      ? {
          anglesLive: streams.filter((s) => s.status === "active").length,

          anglesConfigured: streams.length,

          bothLive:
            streams.length === 2 &&
            streams.every((s) => s.status === "active"),

          summary: controlSummary(streams),

          needsAttention: streams
            .filter((s) => angleState(s) !== "live")
            .map((s) => ({
              angle: s.angle,
              state: angleState(s),
              action: angleAction(s),
            })),
        }
      : null,
  };
};

/*
|--------------------------------------------------------------------------
| Playback Token
|--------------------------------------------------------------------------
|
| The gate between "logged into CricIn" and "can actually see the video".
|
| Three things happen here and all three matter:
|
|   1. IDENTITY. Only an authenticated CricIn user gets a token, so a
|      playback URL forwarded outside the app plays nothing once the
|      token expires - which is the whole reason the stream is signed.
|
|   2. THE VIEWER CAP. Delivery is billed per viewer per minute, so this
|      is the one place that can refuse a viewer before Mux starts
|      charging for them. A renewal is never refused, only a new viewer
|      on an already-full match.
|
|   3. VISIBILITY. Deliberately open: any logged-in user may watch any
|      match. The decision is that discovery matters more than gating -
|      followers get the NOTIFICATION, everyone gets to WATCH. When
|      private matches arrive, the check goes here and nowhere else.
|
| Returns token: null when no signing key is configured. That is not an
| error - it means the stream was created with public playback and the
| bare URL plays. The app appends the token only when it is given one.
|
*/

export const getPlaybackToken = async (
  matchId: string,
  userId: string,
  angleInput: string,
) => {
  const angle = assertAngle(angleInput);

  const stream = await LiveStream.findOne({ matchId, angle });

  if (!stream) {
    throw new AppError(
      "This angle is not being streamed.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  const slot = claimViewerSlot(matchId, userId, PLAYBACK_TOKEN_MINUTES);

  if (!slot.ok) {
    throw new AppError(
      `Is match ko abhi ${slot.limit} log dekh rahe hain - limit full hai. Thodi der baad try karo.`,
      HTTP_STATUS.TOO_MANY_REQUESTS,
    );
  }

  if (!SIGNED_PLAYBACK) {
    return {
      angle,
      playbackId: stream.playbackId,
      playbackUrl: `https://stream.mux.com/${stream.playbackId}.m3u8`,
      token: null,
      expiresInSeconds: null,
      signed: false,
      viewerCount: slot.current,
    };
  }

  const token = await mux.jwt.signPlaybackId(stream.playbackId as string, {
    type: "video",
    expiration: `${PLAYBACK_TOKEN_MINUTES}m`,
  });

  return {
    angle,
    playbackId: stream.playbackId,

    /*
    | Handed over ready to play. Building the query string in the app
    | means every screen that ever plays a stream has to remember to do
    | it, and the one that forgets fails silently with a black player.
    */

    playbackUrl: `https://stream.mux.com/${stream.playbackId}.m3u8?token=${token}`,

    token,

    /*
    | The app refreshes at roughly 80% of this rather than on failure -
    | a token that expires mid-over stalls the player, and recovering
    | from a stall is visible to the viewer in a way a quiet refresh is
    | not.
    */

    expiresInSeconds: PLAYBACK_TOKEN_MINUTES * 60,

    signed: true,

    viewerCount: slot.current,
  };
};

/*
|--------------------------------------------------------------------------
| Live Streaming Feed
|--------------------------------------------------------------------------
|
| Every match being broadcast right now, for the "Live Streaming" category
| on Home and in the Matches tab.
|
| WHY IT IS NOT THE LIVE MATCHES FEED WITH A FLAG
| The existing feeds all filter by team membership (getManagedTeamIds) -
| they answer "your matches". This one answers "matches with a camera on
| them", which is a different question with a different audience: the
| whole point of streaming is that people who are in neither squad watch.
| Bolting a flag onto a personal feed would have made the streamed match
| visible only to the people who were at the ground anyway.
|
| Draft matches are excluded. A "Go Live" that has not had its teams
| filled in yet is a stream with no fixture behind it - showing it in a
| public list means a card with two blank team names.
|
*/

export const getLiveStreamingFeed = async (limit = 30) => {
  const active = await LiveStream.find({ status: "active" })
    .select("matchId angle status startedAt")
    .sort({ startedAt: -1 })
    .lean();

  if (!active.length) return [];

  /*
  | Two angles on one match are ONE card. Grouped by match before the
  | lookup so a two-camera game does not appear twice in the list.
  */

  const byMatch = new Map<string, any[]>();

  for (const s of active) {
    const key = String(s.matchId);

    byMatch.set(key, [...(byMatch.get(key) ?? []), s]);
  }

  const matches: any[] = await Match.find({
    _id: { $in: [...byMatch.keys()] },
    status: { $nin: ["draft", "cancelled"] },
  })
    .select(
      "matchTitle status venueName scheduledStartTime startTime overs matchType teamA teamB",
    )
    .populate("teamA", "teamName logo")
    .populate("teamB", "teamName logo")
    .lean();

  return matches.slice(0, limit).map((m) => {
    const streams = byMatch.get(String(m._id)) ?? [];

    const startedAt = streams
      .map((s) => s.startedAt)
      .filter(Boolean)
      .sort()[0];

    return {
      _id: m._id,
      matchTitle: m.matchTitle,
      status: m.status,
      venueName: m.venueName,
      startTime: m.startTime || m.scheduledStartTime,
      overs: m.overs,
      matchType: m.matchType,
      teamA: m.teamA,
      teamB: m.teamB,

      isStreaming: true,

      /*
      | The card shows "2 ANGLES" so a viewer knows before opening that
      | this is one they can switch cameras on.
      */

      angleCount: streams.length,

      angles: streams.map((s) => s.angle),

      streamStartedAt: startedAt || null,

      viewerCount: getViewerCount(String(m._id)),
    };
  });
};

/*
|--------------------------------------------------------------------------
| Stream Key
|--------------------------------------------------------------------------
|
| Its own endpoint rather than a field on the list response, so the key
| can never ride along on a call some future screen makes for a different
| reason. The broadcaster screen asks for it once, deliberately.
|
*/

export const getStreamKey = async (
  matchId: string,
  userId: string,
  angleInput: string,
) => {
  const angle = assertAngle(angleInput);

  const doc = await LiveStream.findOne({ matchId, angle }).select(
    "+streamKeyEnc",
  );

  if (!doc) {
    throw new AppError(
      "No stream found for this angle.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  /*
  | Two ways in: you run the match, or this specific angle was handed to
  | you. The assigned player is checked FIRST and cheaply - they are the
  | common case, and they would fail the manage check every time.
  |
  | Note the assignment is to one angle, so being the front-camera player
  | does not hand you the third-umpire key.
  */

  const isAssigned =
    doc.assignedTo &&
    String(doc.assignedTo) === String(userId) &&
    (doc as any).assignmentStatus === "accepted";

  if (!isAssigned) {
    await assertCanManage(matchId, userId);
  }

  /*
  |--------------------------------------------------------------------------
  | A Finished Match Issues No More Keys
  |--------------------------------------------------------------------------
  |
  | Without this the key outlives the game. Someone given the camera for one
  | Sunday keeps a working broadcast credential indefinitely, and could push
  | video onto a match page that followers still open for the replay - with
  | the app presenting it as that match's live feed.
  |
  | Checked here rather than swept up later, because the moment that matters
  | is the moment the key is handed out.
  |
  */

  const match: any = await Match.findById(matchId).select("status").lean();

  if (match && ["completed", "cancelled"].includes(match.status)) {
    throw new AppError(
      "This match has finished - streaming is closed.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const key = decrypt(doc.streamKeyEnc as string);

  return {
    angle: doc.angle,
    status: doc.status,
    rtmpsUrl: RTMPS_URL,
    streamKey: key,

    /*
    | Larix Broadcaster takes one URL with the key on the end rather than
    | a separate key field, so it is built here instead of in the app.
    */

    larixUrl: `${RTMPS_URL}/${key}`,
  };
};

/*
|--------------------------------------------------------------------------
| Delete Stream
|--------------------------------------------------------------------------
|
| Deletes at Mux too. A row removed only from Mongo leaves an orphaned
| Mux stream whose recording keeps billing storage every month with
| nothing in the app pointing at it.
|
*/

export const deleteStream = async (
  matchId: string,
  userId: string,
  angleInput: string,
) => {
  const angle = assertAngle(angleInput);

  await assertCanManage(matchId, userId);

  const doc = await LiveStream.findOne({ matchId, angle });

  if (!doc) {
    throw new AppError(
      "No stream found for this angle.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  try {
    await mux.video.liveStreams.delete(doc.muxLiveStreamId as string);
  } catch (error: any) {
    // Already gone at Mux is the desired end state, not a failure.
    if (error?.status !== 404) throw error;
  }

  await doc.deleteOne();

  return { deleted: true, angle };
};


/*
|--------------------------------------------------------------------------
| Keep It Running
|--------------------------------------------------------------------------
|
| The answer to an idle warning. Rain, an injury, a long argument about a
| decision - play stops for half an hour and comes back, and the stream
| should still be there when it does.
|
| Whoever is at the ground taps once and the auto-end clock is pushed back.
| Repeatable: a two-hour rain delay is three taps, and each one is a fresh
| statement that somebody is still there - which is exactly the signal the
| monitor cannot get on its own.
|
*/

export const keepAlive = async (
  matchId: string,
  userId: string,
  angleInput: string,
) => {
  const angle = assertAngle(angleInput);

  await assertCanManage(matchId, userId);

  const doc = await LiveStream.findOne({ matchId, angle });

  if (!doc) {
    throw new AppError(
      "No stream found for this angle.",
      HTTP_STATUS.NOT_FOUND,
    );
  }

  const until = new Date(Date.now() + IDLE_END_MINUTES * 60 * 1000);

  (doc as any).keepAliveUntil = until;
  (doc as any).autoEndWarnedAt = null;

  await doc.save();

  return {
    angle,
    keepAliveUntil: until,
    note: `Stream ${IDLE_END_MINUTES} minute aur chalegi. Zaroorat ho toh phir se dabana.`,
  };
};