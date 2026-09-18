/*
|--------------------------------------------------------------------------
| Notification Types
|--------------------------------------------------------------------------
|
| Central source of truth for every notification in CricIn.
| Every module (Team, Match, Tournament, Ground, Chat, etc.)
| should use these constants instead of hardcoded strings.
|
*/

export const NOTIFICATION_TYPES = {
  /*
  |--------------------------------------------------------------------------
  | Team
  |--------------------------------------------------------------------------
  */

  TEAM_CREATED: "TEAM_CREATED",

  TEAM_UPDATED: "TEAM_UPDATED",

  TEAM_DELETED: "TEAM_DELETED",

  PLAYER_JOINED_TEAM: "PLAYER_JOINED_TEAM",

  PLAYER_LEFT_TEAM: "PLAYER_LEFT_TEAM",

  CAPTAIN_ASSIGNED: "CAPTAIN_ASSIGNED",

  VICE_CAPTAIN_PROPOSED: "VICE_CAPTAIN_PROPOSED",

  VICE_CAPTAIN_ASSIGNED: "VICE_CAPTAIN_ASSIGNED",

  VICE_CAPTAIN_REJECTED: "VICE_CAPTAIN_REJECTED",

  VICE_CAPTAIN_CANCELLED: "VICE_CAPTAIN_CANCELLED",

  /*
  |--------------------------------------------------------------------------
  | Team Invitations
  |--------------------------------------------------------------------------
  */

  TEAM_INVITATION_RECEIVED: "TEAM_INVITATION_RECEIVED",

  TEAM_INVITATION_ACCEPTED: "TEAM_INVITATION_ACCEPTED",

  TEAM_INVITATION_REJECTED: "TEAM_INVITATION_REJECTED",

  TEAM_INVITATION_CANCELLED: "TEAM_INVITATION_CANCELLED",

  TEAM_INVITATION_EXPIRED: "TEAM_INVITATION_EXPIRED",

  /*
  |--------------------------------------------------------------------------
  | Match
  |--------------------------------------------------------------------------
  */

  MATCH_CREATED: "MATCH_CREATED",

  MATCH_REMINDER: "MATCH_REMINDER",

  MATCH_STARTED: "MATCH_STARTED",

  MATCH_COMPLETED: "MATCH_COMPLETED",

  MATCH_RESULT: "MATCH_RESULT",

  MATCH_CANCELLED: "MATCH_CANCELLED",

  MATCH_CONFIRMATION_REQUIRED: "MATCH_CONFIRMATION_REQUIRED",

  MATCH_CONFIRMED: "MATCH_CONFIRMED",

  MATCH_CONFIRMATION_REJECTED: "MATCH_CONFIRMATION_REJECTED",

  MATCH_PIN_SHARED: "MATCH_PIN_SHARED",

  /*
  |--------------------------------------------------------------------------
  | Match Challenges
  |--------------------------------------------------------------------------
  */

  MATCH_CHALLENGE_RECEIVED: "MATCH_CHALLENGE_RECEIVED",

  MATCH_CHALLENGE_ACCEPTED: "MATCH_CHALLENGE_ACCEPTED",

  MATCH_CHALLENGE_REJECTED: "MATCH_CHALLENGE_REJECTED",

  MATCH_CHALLENGE_CANCELLED: "MATCH_CHALLENGE_CANCELLED",

  MATCH_CHALLENGE_MODIFIED: "MATCH_CHALLENGE_MODIFIED",

  /*
  |--------------------------------------------------------------------------
  | Team Reviews
  |--------------------------------------------------------------------------
  */

  TEAM_REVIEW_RECEIVED: "TEAM_REVIEW_RECEIVED",

  /*
  |--------------------------------------------------------------------------
  | Tournament
  |--------------------------------------------------------------------------
  */

  TOURNAMENT_CREATED: "TOURNAMENT_CREATED",

  TOURNAMENT_INVITATION: "TOURNAMENT_INVITATION",

  TOURNAMENT_STARTED: "TOURNAMENT_STARTED",

  TOURNAMENT_COMPLETED: "TOURNAMENT_COMPLETED",

  /*
  |--------------------------------------------------------------------------
  | Tournament - the real flow
  |--------------------------------------------------------------------------
  |
  | The four types above predate the feature and nothing emits them.
  | These are the ones that actually fire.
  |
  | INVITE_RECEIVED goes to the team's CAPTAIN and nobody else - one team,
  | one answer. It is the only actionable one; the rest are news.
  |
  | SCORER_ASSIGNED / REVOKED are a pair, sent in the same operation when
  | the organizer moves scoring from one person to another. The revoke
  | matters: somebody who had rights a minute ago will otherwise open the
  | scoring pad and find every tap rejected with no explanation.
  |
  */

  TOURNAMENT_INVITE_RECEIVED: "TOURNAMENT_INVITE_RECEIVED",

  TOURNAMENT_INVITE_ACCEPTED: "TOURNAMENT_INVITE_ACCEPTED",

  TOURNAMENT_INVITE_DECLINED: "TOURNAMENT_INVITE_DECLINED",

  TOURNAMENT_JOIN_REQUEST: "TOURNAMENT_JOIN_REQUEST",

  TOURNAMENT_FIXTURES_READY: "TOURNAMENT_FIXTURES_READY",

  TOURNAMENT_MATCH_REMINDER: "TOURNAMENT_MATCH_REMINDER",

  TOURNAMENT_SCORER_ASSIGNED: "TOURNAMENT_SCORER_ASSIGNED",

  TOURNAMENT_SCORER_REVOKED: "TOURNAMENT_SCORER_REVOKED",

  TOURNAMENT_CANCELLED: "TOURNAMENT_CANCELLED",

  /*
  |--------------------------------------------------------------------------
  | Series
  |--------------------------------------------------------------------------
  |
  | A bilateral series has ONE invite, to the opponent team's captain, and
  | it is the only actionable notification here - everything else is news.
  |
  | Deliberately its own set rather than reusing the TOURNAMENT_* types.
  | They carry different data (a seriesId, not a tournamentId), route to a
  | different screen, and a user reading "Tournament invite" for a
  | three-match series would reasonably wonder what they had been entered
  | into.
  |
  | SCORER_ASSIGNED / REVOKED are a pair, sent in the same operation. The
  | revoke matters: somebody who had rights a minute ago will otherwise
  | open the scoring pad and find every tap rejected with no explanation.
  |
  */

  SERIES_INVITE_RECEIVED: "SERIES_INVITE_RECEIVED",

  SERIES_INVITE_ACCEPTED: "SERIES_INVITE_ACCEPTED",

  SERIES_INVITE_DECLINED: "SERIES_INVITE_DECLINED",

  SERIES_FIXTURES_READY: "SERIES_FIXTURES_READY",

  SERIES_MATCH_REMINDER: "SERIES_MATCH_REMINDER",

  SERIES_SCORER_ASSIGNED: "SERIES_SCORER_ASSIGNED",

  SERIES_SCORER_REVOKED: "SERIES_SCORER_REVOKED",

  SERIES_CANCELLED: "SERIES_CANCELLED",

  /*
  |--------------------------------------------------------------------------
  | Ground
  |--------------------------------------------------------------------------
  */

  GROUND_BOOKING_CREATED: "GROUND_BOOKING_CREATED",

  GROUND_BOOKING_APPROVED: "GROUND_BOOKING_APPROVED",

  GROUND_BOOKING_REJECTED: "GROUND_BOOKING_REJECTED",

  GROUND_BOOKING_CANCELLED: "GROUND_BOOKING_CANCELLED",

  /*
  |--------------------------------------------------------------------------
  | Chat
  |--------------------------------------------------------------------------
  */

  CHAT_MESSAGE: "CHAT_MESSAGE",

  /*
  |--------------------------------------------------------------------------
  | Social
  |--------------------------------------------------------------------------
  */

  FOLLOW_REQUEST: "FOLLOW_REQUEST",

  FOLLOW_ACCEPTED: "FOLLOW_ACCEPTED",

  FOLLOW_REJECTED: "FOLLOW_REJECTED",

  /*
  |--------------------------------------------------------------------------
  | Follows
  |--------------------------------------------------------------------------
  |
  | The three types above describe a follow REQUEST being approved or
  | refused - the private-profile flow, which is switched off (following is
  | instant). The types below are the ones that actually fire today.
  |
  | Deliberately one type per event rather than a single FOLLOW_ACTIVITY:
  | "a team I follow is playing right now" is by far the noisiest of these,
  | and separate types mean muting it later is a filter, not a rewrite.
  |
  */

  // Someone started following you, or a team you own.
  NEW_FOLLOWER: "NEW_FOLLOWER",

  // A team you follow has started a match.
  FOLLOWED_MATCH_LIVE: "FOLLOWED_MATCH_LIVE",

  // A team you follow finished a match.
  FOLLOWED_MATCH_RESULT: "FOLLOWED_MATCH_RESULT",

  // A player you follow won Player of the Match.
  FOLLOWED_PLAYER_AWARD: "FOLLOWED_PLAYER_AWARD",

  // A player you follow passed a milestone (50, 100, 5-wicket haul).
  FOLLOWED_PLAYER_MILESTONE: "FOLLOWED_PLAYER_MILESTONE",

  // You were named Player of the Match. Sent to the winner, not followers.
  PLAYER_OF_THE_MATCH: "PLAYER_OF_THE_MATCH",

  /*
  |--------------------------------------------------------------------------
  | Scoring Requests (Quick Score)
  |--------------------------------------------------------------------------
  |
  | Someone wants to score a match involving your team. Distinct from
  | MATCH_CHALLENGE_* because a challenge is one team inviting another to
  | play, while this is a scorer asking permission to record a match the
  | teams have already arranged between themselves.
  |
  */

  SCORING_REQUEST_RECEIVED: "SCORING_REQUEST_RECEIVED",

  SCORING_REQUEST_APPROVED: "SCORING_REQUEST_APPROVED",

  SCORING_REQUEST_REJECTED: "SCORING_REQUEST_REJECTED",

  /*
  |--------------------------------------------------------------------------
  | Live Streaming
  |--------------------------------------------------------------------------
  |
  | Filming a match is a job handed to a named person - often someone in
  | neither squad, which means nothing in their existing feed would ever
  | surface the match to them. The invite is how they find out at all.
  |
  */

  BROADCAST_INVITE_RECEIVED: "BROADCAST_INVITE_RECEIVED",

  BROADCAST_INVITE_ACCEPTED: "BROADCAST_INVITE_ACCEPTED",

  BROADCAST_INVITE_DECLINED: "BROADCAST_INVITE_DECLINED",

  BROADCAST_INVITE_REVOKED: "BROADCAST_INVITE_REVOKED",

  /*
  | A camera has actually connected on a match you follow - there is a
  | picture to watch.
  |
  | Deliberately NOT folded into FOLLOWED_MATCH_LIVE. That one fires when
  | scoring starts and offers a scorecard; this fires when a broadcaster
  | connects and offers video. They happen at different times, on
  | different matches, and one type for both would mean promising video on
  | every match - most of which never have a camera.
  |
  | This is also the only push anyone gets about a stream. Watching is
  | open to every user; being TOLD is for followers.
  */

  FOLLOWED_STREAM_LIVE: "FOLLOWED_STREAM_LIVE",

  /*
  | The full match recording is kept for a week, then deleted; the
  | highlights stay. Announced rather than silent - a video that vanishes
  | without warning reads as a bug, the same deletion with two days'
  | notice reads as a policy.
  */

  RECORDING_EXPIRING: "RECORDING_EXPIRING",

  /*
  |--------------------------------------------------------------------------
  | System
  |--------------------------------------------------------------------------
  */

  PROFILE_COMPLETED: "PROFILE_COMPLETED",

  ACCOUNT_VERIFIED: "ACCOUNT_VERIFIED",

  SYSTEM: "SYSTEM",

  APP_UPDATE: "APP_UPDATE",

} as const;

/*
|--------------------------------------------------------------------------
| Notification Type
|--------------------------------------------------------------------------
*/

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];