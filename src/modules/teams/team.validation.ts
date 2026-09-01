/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Team Management
|
| File:
| team.validation.ts
|
| Description:
| Centralized validation methods for Team Module.
|
| These methods throw Errors directly.
|
|--------------------------------------------------------------------------
*/


/*
|--------------------------------------------------------------------------
| Validate Owner
|--------------------------------------------------------------------------
*/

export const validateOwner = (
  ownerId: string,
  teamOwnerId: string
) => {
  if (String(ownerId) !== String(teamOwnerId)) {
    throw new Error(
      "Only team owner can perform this action."
    );
  }
};

/*
|--------------------------------------------------------------------------
| Validate Captain
|--------------------------------------------------------------------------
*/

export const validateCaptain = (
  captainId: string,
  teamCaptainId: string
) => {
  if (
    String(captainId) !==
    String(teamCaptainId)
  ) {
    throw new Error(
      "Only captain can perform this action."
    );
  }
};

/*
|--------------------------------------------------------------------------
| Validate Player Not Already In Team
|--------------------------------------------------------------------------
*/

export const validateDuplicatePlayer = (
  players: any[],
  playerId: string
) => {
  const exists = players.some(
    (id) => String(id) === String(playerId)
  );

  if (exists) {
    throw new Error(
      "Player already exists in the team."
    );
  }
};

/*
|--------------------------------------------------------------------------
| Validate Squad Size
|--------------------------------------------------------------------------
*/

export const validateMaxPlayers = (
  currentPlayers: number,
  maxPlayers: number
) => {
  if (currentPlayers >= maxPlayers) {
    throw new Error(
      `Team can have maximum ${maxPlayers} players.`
    );
  }
};