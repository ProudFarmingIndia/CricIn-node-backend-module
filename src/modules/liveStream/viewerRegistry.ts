/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| viewerRegistry.ts
|
| Description:
| Counts who is currently watching each match, so the concurrent viewer
| cap can be enforced.
|
| WHY THIS EXISTS
| Mux bills delivery per viewer per minute. One three-hour match watched
| by two hundred people is 36,000 delivered minutes - a third of the whole
| monthly free allowance, on a single match. Nothing in phase one is
| expected to come close, but "expected" is not a billing control.
|
| WHY IT IS COUNTED HERE AND NOT ON THE SOCKET
| Socket.IO room membership would be the obvious counter, but a viewer can
| hold a socket without watching (the scorer, the match centre) and can
| watch without a working socket (the socket drops, HLS keeps playing).
| The playback TOKEN is the thing you cannot watch without, so counting
| token holders counts actual viewers.
|
| WHY IN MEMORY
| A viewer count is worth nothing thirty seconds after it is taken, so
| there is no reason to write it to Mongo. The trade is honest and worth
| stating: this counts per PROCESS. On one server it is exact. Behind two
| servers each would allow the full cap, so the real ceiling doubles -
| still a ceiling, and the moment there are two servers this moves to
| Redis with the same interface.
|
|--------------------------------------------------------------------------
*/

import { MAX_VIEWERS_PER_MATCH } from "../../config/mux";

/*
| matchId -> (userId -> when their lease expires).
|
| Keyed by user rather than by request so the same person on two screens,
| or refreshing their token, counts once. Two devices genuinely watching
| twice do cost twice - but that is a rare case, and counting it would
| mean tracking devices, which is a lot of machinery for a safety net.
*/

const viewers = new Map<string, Map<string, number>>();

/*
| Leases outlive the token deliberately. A token good for 40 minutes with
| a 40-minute lease would free the slot at the exact moment the app asks
| to renew it; the extra five minutes means a renewal always finds its own
| slot still held.
*/

const LEASE_GRACE_MS = 5 * 60 * 1000;

const prune = (matchId: string) => {
  const room = viewers.get(matchId);

  if (!room) return null;

  const now = Date.now();

  for (const [userId, expiresAt] of room) {
    if (expiresAt <= now) room.delete(userId);
  }

  if (room.size === 0) {
    viewers.delete(matchId);

    return null;
  }

  return room;
};

/*
|--------------------------------------------------------------------------
| Claim A Slot
|--------------------------------------------------------------------------
|
| Returns false only when the match is genuinely full AND this user is not
| already one of the people watching it. A renewal is never refused - the
| worst possible moment to hit the cap is halfway through a match somebody
| is already watching.
|
*/

export const claimViewerSlot = (
  matchId: string,
  userId: string,
  leaseMinutes: number,
): { ok: boolean; current: number; limit: number } => {
  const limit = MAX_VIEWERS_PER_MATCH;

  const room = prune(matchId) ?? new Map<string, number>();

  const alreadyIn = room.has(userId);

  if (limit > 0 && !alreadyIn && room.size >= limit) {
    return { ok: false, current: room.size, limit };
  }

  room.set(userId, Date.now() + leaseMinutes * 60 * 1000 + LEASE_GRACE_MS);

  viewers.set(matchId, room);

  return { ok: true, current: room.size, limit };
};

/*
| Called when the player is closed. Not load-bearing - the lease expires
| on its own - but it makes the count accurate for the common case of
| someone opening a match and leaving straight away.
*/

export const releaseViewerSlot = (matchId: string, userId: string) => {
  const room = viewers.get(matchId);

  if (!room) return;

  room.delete(userId);

  if (room.size === 0) viewers.delete(matchId);
};

export const getViewerCount = (matchId: string): number => {
  const room = prune(matchId);

  return room ? room.size : 0;
};

/*
| Housekeeping for matches nobody ever formally left. Cheap - it walks
| only the matches that have had a viewer since the last sweep.
*/

setInterval(
  () => {
    for (const matchId of [...viewers.keys()]) prune(matchId);
  },
  10 * 60 * 1000,
).unref?.();