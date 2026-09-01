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