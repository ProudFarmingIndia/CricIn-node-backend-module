/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Team Management
|
| File:
| team.helper.ts
|
| Description:
| Pure helper functions used by Team Service.
|
| NOTE
| These helpers DO NOT access MongoDB.
| They only perform calculations or reusable utility logic.
|
|--------------------------------------------------------------------------
*/


/*
|--------------------------------------------------------------------------
| Calculate Win Percentage
|--------------------------------------------------------------------------
*/

export const calculateWinPercentage = (
  wins: number,
  totalMatches: number
): number => {
  if (totalMatches <= 0) {
    return 0;
  }

  return Number(
    ((wins / totalMatches) * 100).toFixed(2)
  );
};

/*
|--------------------------------------------------------------------------
| Player Count
|--------------------------------------------------------------------------
*/

export const getPlayerCount = (
  players: unknown[]
): number => {
  return players?.length ?? 0;
};