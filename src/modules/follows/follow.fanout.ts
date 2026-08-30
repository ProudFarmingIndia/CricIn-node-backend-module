import Follow from "./follow.model";
import Player from "../players/player.model";
import Team from "../teams/team.model";

import { createNotification } from "../notifications/notification.service";
import { NOTIFICATION_TYPES } from "../notifications/notification.types";

import { FOLLOWABLE_TYPES, FollowableType } from "./follow.service";

/*
|--------------------------------------------------------------------------
| Follower Fan-Out
|--------------------------------------------------------------------------
|
| Turns "this team won" into a notification for everyone following that
| team, and "this player was Player of the Match" into one for everyone
| following that player.
|
| Three rules run through all of it:
|
|   NEVER THROW. Every function here is called from inside a match
|   lifecycle transition - starting a match, saving a result. A follower
|   with a dead push token must not roll back the match result, so failures
|   are logged and swallowed.
|
|   DE-DUPLICATE RECIPIENTS. Someone following both teams in a match would
|   otherwise get the same result notification twice. Recipients are
|   collected into a Set before anything is sent.
|
|   NEVER NOTIFY THE ACTOR. The captain who saved the result does not need
|   to be told what they just did, and a player following their own team
|   does not need a notification about their own match.
|
| Fan-out is sequential rather than Promise.all: each createNotification
| writes a row, emits a socket event and posts to Expo, and firing a few
| hundred of those at once would open a few hundred sockets at once. A
| followed team's match result is not latency-critical.
|
*/

const notifyMany = async (
  recipientUserIds: Set<string>,
  build: (receiverId: string) => Parameters<typeof createNotification>[0],
) => {
  for (const receiverId of recipientUserIds) {
    try {
      await createNotification(build(receiverId));
    } catch (error) {
      console.error(
        `Follower fan-out failed for receiver ${receiverId}:`,
        error,
      );
    }
  }
};

/*
| targets carries targetType as a plain string because it is assembled from
| match documents. Mongoose infers the schema enum as a literal union, so
| the $or below has to be narrowed before it will type-check - see the
| longer note in follow.service.ts.
|
| An unrecognised type is dropped rather than thrown: this runs inside a
| match transition, and a bad entry must not take the whole fan-out down.
*/

const collectFollowers = async (
  targets: { targetType: string; targetId: string }[],
  excludeUserIds: string[] = [],
) => {
  const conditions = targets
    .filter((t) =>
      FOLLOWABLE_TYPES.includes(t.targetType as FollowableType),
    )
    .map((t) => ({
      targetType: t.targetType as FollowableType,
      targetId: t.targetId,
    }));

  if (conditions.length === 0) {
    return new Set<string>();
  }

  const follows = await Follow.find({
    status: "ACCEPTED",

    $or: conditions,
  }).select("followerId");

  const excluded = new Set(excludeUserIds.filter(Boolean).map(String));

  const recipients = new Set<string>();

  for (const f of follows) {
    const id = String(f.followerId);

    if (!excluded.has(id)) {
      recipients.add(id);
    }
  }

  return recipients;
};

/*
|--------------------------------------------------------------------------
| Match Going Live
|--------------------------------------------------------------------------
|
| Sent to followers of either team the moment scoring starts, so they can
| open the live score. This is the noisiest of the fan-outs - it fires for
| every match, won or lost - which is why it carries its own notification
| type: muting it later is then a filter on one type rather than a code
| change.
|
*/

export const notifyFollowersMatchLive = async (match: any) => {
  try {
    const teamA = match?.teamA?._id || match?.teamA;

    const teamB = match?.teamB?._id || match?.teamB;

    if (!teamA || !teamB) {
      return;
    }

    const [teamADoc, teamBDoc] = await Promise.all([
      Team.findById(teamA).select("teamName"),
      Team.findById(teamB).select("teamName"),
    ]);

    const recipients = await collectFollowers(
      [
        { targetType: "TEAM", targetId: String(teamA) },
        { targetType: "TEAM", targetId: String(teamB) },
      ],
      [String(match?.userId || ""), String(match?.scorerUserId || "")],
    );

    const fixture = `${teamADoc?.teamName || "Team A"} vs ${
      teamBDoc?.teamName || "Team B"
    }`;

    await notifyMany(recipients, (receiverId) => ({
      receiverId,

      actorId: null,

      type: NOTIFICATION_TYPES.FOLLOWED_MATCH_LIVE,

      title: "Match Started",

      message: `${fixture} is live now. Follow the score.`,

      data: {
        matchId: String(match?._id),

        teamAId: String(teamA),

        teamBId: String(teamB),
      },
    }));
  } catch (error) {
    console.error("notifyFollowersMatchLive failed:", error);
  }
};

/*
|--------------------------------------------------------------------------
| Match Result
|--------------------------------------------------------------------------
|
| Sent to followers of either team once a winner is recorded. The message
| is written from the winning team's side, which reads naturally whichever
| team the recipient follows.
|
*/

export const notifyFollowersMatchResult = async (
  match: any,
  actorUserId?: string,
) => {
  try {
    const teamA = match?.teamA?._id || match?.teamA;

    const teamB = match?.teamB?._id || match?.teamB;

    const winner = match?.winnerTeam?._id || match?.winnerTeam;

    if (!teamA || !teamB) {
      return;
    }

    const [teamADoc, teamBDoc] = await Promise.all([
      Team.findById(teamA).select("teamName"),
      Team.findById(teamB).select("teamName"),
    ]);

    const recipients = await collectFollowers(
      [
        { targetType: "TEAM", targetId: String(teamA) },
        { targetType: "TEAM", targetId: String(teamB) },
      ],
      [String(actorUserId || "")],
    );

    const teamAName = teamADoc?.teamName || "Team A";

    const teamBName = teamBDoc?.teamName || "Team B";

    /*
    | match.result is free text the captain typed ("by 24 runs"), so it is
    | appended rather than parsed. A drawn or abandoned match has no
    | winnerTeam, and gets a neutral message instead of a fabricated one.
    */

    let message: string;

    if (winner) {
      const winnerName =
        String(winner) === String(teamA) ? teamAName : teamBName;

      message = match?.result
        ? `${winnerName} won ${match.result}.`
        : `${winnerName} won against ${
            String(winner) === String(teamA) ? teamBName : teamAName
          }.`;
    } else {
      message = `${teamAName} vs ${teamBName} ended${
        match?.result ? ` - ${match.result}` : " without a result"
      }.`;
    }

    await notifyMany(recipients, (receiverId) => ({
      receiverId,

      actorId: actorUserId || null,

      type: NOTIFICATION_TYPES.FOLLOWED_MATCH_RESULT,

      title: "Match Result",

      message,

      data: {
        matchId: String(match?._id),

        teamAId: String(teamA),

        teamBId: String(teamB),

        winnerTeamId: winner ? String(winner) : null,
      },
    }));
  } catch (error) {
    console.error("notifyFollowersMatchResult failed:", error);
  }
};

/*
|--------------------------------------------------------------------------
| Player Of The Match
|--------------------------------------------------------------------------
|
| Goes to the followers of the player who won it. The player themselves is
| notified too - separately, and with a message written to them rather than
| about them - because being told you won it is the point.
|
*/

export const notifyFollowersPlayerOfTheMatch = async (
  match: any,
  playerId: string,
  actorUserId?: string,
) => {
  try {
    if (!playerId) {
      return;
    }

    const player = await Player.findById(playerId).select("playerName userId");

    if (!player) {
      return;
    }

    const recipients = await collectFollowers(
      [{ targetType: "PLAYER", targetId: String(playerId) }],
      [String(player.userId || ""), String(actorUserId || "")],
    );

    await notifyMany(recipients, (receiverId) => ({
      receiverId,

      actorId: actorUserId || null,

      type: NOTIFICATION_TYPES.FOLLOWED_PLAYER_AWARD,

      title: "Player of the Match",

      message: `${player.playerName} was Player of the Match.`,

      data: {
        matchId: String(match?._id),

        playerId: String(playerId),
      },
    }));

    // The award itself, to the player who won it.
    if (player.userId) {
      try {
        await createNotification({
          receiverId: String(player.userId),

          actorId: actorUserId || null,

          type: NOTIFICATION_TYPES.PLAYER_OF_THE_MATCH,

          title: "Player of the Match",

          message: "You were named Player of the Match. Well played.",

          data: {
            matchId: String(match?._id),

            playerId: String(playerId),
          },
        });
      } catch (error) {
        console.error("Player-of-the-match self notification failed:", error);
      }
    }
  } catch (error) {
    console.error("notifyFollowersPlayerOfTheMatch failed:", error);
  }
};

/*
|--------------------------------------------------------------------------
| Player Milestone
|--------------------------------------------------------------------------
|
| Fifties, hundreds, five-wicket hauls.
|
| Nothing calls this yet. It is deliberately written against a plain
| { label, detail } input rather than against the scoring engine, because
| the scoring engine does not persist per-innings player figures anywhere
| durable today - Player.stats is all zeroes and is never written to. Once
| an innings writes a player's figures, that code calls this with the
| milestone it just crossed; no change is needed here.
|
| Guarding against duplicates is the caller's job: a batsman passing 50
| then 100 should produce two notifications, but re-saving the same innings
| must not produce four.
|
*/

export const notifyFollowersPlayerMilestone = async (
  match: any,
  playerId: string,
  milestone: { label: string; detail?: string },
) => {
  try {
    if (!playerId || !milestone?.label) {
      return;
    }

    const player = await Player.findById(playerId).select("playerName userId");

    if (!player) {
      return;
    }

    const recipients = await collectFollowers(
      [{ targetType: "PLAYER", targetId: String(playerId) }],
      [String(player.userId || "")],
    );

    await notifyMany(recipients, (receiverId) => ({
      receiverId,

      actorId: null,

      type: NOTIFICATION_TYPES.FOLLOWED_PLAYER_MILESTONE,

      title: "Milestone",

      message: `${player.playerName} ${milestone.label}${
        milestone.detail ? ` (${milestone.detail})` : ""
      }.`,

      data: {
        matchId: String(match?._id),

        playerId: String(playerId),

        milestone: milestone.label,
      },
    }));
  } catch (error) {
    console.error("notifyFollowersPlayerMilestone failed:", error);
  }
};
