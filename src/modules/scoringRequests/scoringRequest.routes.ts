import { Router } from "express";

import {
  create,
  respond,
  listMine,
  listForMyTeams,
  cancel,
} from "./scoringRequest.controller";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Scoring Request Routes
|--------------------------------------------------------------------------
|
| Mounted at /api/scoring-requests.
|
| The literal paths are registered before anything with a ":requestId"
| parameter, or Express matches "mine" and "for-my-teams" as ids and those
| routes never fire.
|
*/

// POST /api/scoring-requests - start a Quick Score setup
router.post("/", authMiddleware, create);

// GET /api/scoring-requests/mine - the scorer's own list (sidebar)
router.get("/mine", authMiddleware, listMine);

// GET /api/scoring-requests/for-my-teams - a captain's inbox
router.get("/for-my-teams", authMiddleware, listForMyTeams);

// PUT /api/scoring-requests/:requestId/respond - body: { decision }
router.put("/:requestId/respond", authMiddleware, respond);

// DELETE /api/scoring-requests/:requestId - requester withdraws
router.delete("/:requestId", authMiddleware, cancel);

export default router;
