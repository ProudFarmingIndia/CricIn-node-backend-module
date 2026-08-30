/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Team Management
|
| File:
| team.messages.ts
|
| Description:
| Centralized Team related success and error messages.
|
| NOTE:
| Avoid hardcoded strings inside services/controllers.
| Always use these constants.
|
|--------------------------------------------------------------------------
*/

export const TEAM_MESSAGES = {
  /*
  |--------------------------------------------------------------------------
  | Success Messages
  |--------------------------------------------------------------------------
  */

  TEAM_CREATED: "Team created successfully.",

  TEAM_UPDATED: "Team updated successfully.",

  TEAM_DELETED: "Team deleted successfully.",

  PLAYER_ADDED: "Player added successfully.",

  PLAYER_REMOVED: "Player removed successfully.",

  CAPTAIN_UPDATED: "Captain updated successfully.",

  VICE_CAPTAIN_UPDATED:
    "Vice captain updated successfully.",

  TEAM_STATS_UPDATED:
    "Team statistics updated successfully.",

  /*
  |--------------------------------------------------------------------------
  | Error Messages
  |--------------------------------------------------------------------------
  */

  TEAM_NOT_FOUND: "Team not found.",

  TEAM_ALREADY_EXISTS:
    "A team with this name already exists.",

  TEAM_INACTIVE:
    "This team is no longer active.",

  TEAM_DELETED_ERROR:
    "This team has already been deleted.",

  PLAYER_NOT_FOUND: "Player not found.",

  PLAYER_ALREADY_EXISTS:
    "Player already exists in the team.",

  PLAYER_NOT_IN_TEAM:
    "Player is not part of this team.",

  TEAM_FULL:
    "Team has reached the maximum player limit.",

  ONLY_OWNER:
    "Only the team owner can perform this action.",

  ONLY_CAPTAIN:
    "Only the captain can perform this action.",

  ONLY_VICE_CAPTAIN:
    "Only the vice captain can perform this action.",

  CAPTAIN_CANNOT_BE_REMOVED:
    "Captain cannot be removed from the team.",

  VICE_CAPTAIN_CANNOT_BE_REMOVED:
    "Vice captain cannot be removed from the team.",

  INVALID_CAPTAIN:
    "Selected captain is not a member of this team.",

  INVALID_VICE_CAPTAIN:
    "Selected vice captain is not a member of this team.",

  CANNOT_TRANSFER_TO_SELF:
    "Captain cannot transfer captaincy to himself.",

  MAX_PLAYERS_REACHED:
    "Maximum team size reached.",

  TEAM_ACCESS_DENIED:
    "You are not authorized to access this team.",
} as const;