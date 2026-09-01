import { Router } from "express";

import {
  globalSearch,
  searchPlayers,
  searchPlayerByMobile,
  searchTeams,
  searchGrounds,
  searchTournaments,
} from "./search.controller";

import {
  authMiddleware,
} from "../../shared/middleware/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Global Search
|--------------------------------------------------------------------------
|
| Header Search
|
| Search:
| Players
| Teams
| Grounds
| Tournaments
|
*/

router.get(
  "/",
  authMiddleware,
  globalSearch
);

/*
|--------------------------------------------------------------------------
| Players
|--------------------------------------------------------------------------
*/

/*
Search Player By Name
*/

router.get(
  "/players",
  authMiddleware,
  searchPlayers
);

/*
Search Player By Mobile
Used while sending Team Invitation
*/

router.get(
  "/players/mobile",
  authMiddleware,
  searchPlayerByMobile
);

/*
|--------------------------------------------------------------------------
| Teams
|--------------------------------------------------------------------------
*/

router.get(
  "/teams",
  authMiddleware,
  searchTeams
);

/*
|--------------------------------------------------------------------------
| Grounds
|--------------------------------------------------------------------------
*/

router.get(
  "/grounds",
  authMiddleware,
  searchGrounds
);

/*
|--------------------------------------------------------------------------
| Tournaments
|--------------------------------------------------------------------------
*/

router.get(
  "/tournaments",
  authMiddleware,
  searchTournaments
);

export default router;