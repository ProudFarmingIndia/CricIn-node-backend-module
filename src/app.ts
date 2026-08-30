import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

import authRoutes from "./modules/auth/auth.routes";
import userRoutes from "./modules/users/user.routes";
import playerRoutes from "./modules/players/player.routes";
import teamRoutes from "./modules/teams/team.routes";
import matchRoutes from "./modules/matches/match.routes";
import scoreRoutes from "./modules/scoring/scoring.routes";
import tournamentRoutes from "./modules/tournaments/tournament.routes";
import groundRoutes from "./modules/grounds/ground.routes";
import notificationRoutes from "./modules/notifications/notification.routes";
import followRoutes from "./modules/follows/follow.routes";
import chatRoutes from "./modules/chat/chat.routes";
import feedRoutes from "./modules/feed/feed.routes";
import uploadRoutes from "./modules/upload/upload.routes";
import invitationRoutes from "./modules/teamInvitations/invitation.routes";
import viceCaptainProposalRoutes from "./modules/viceCaptain/viceCaptainProposal.routes";
import matchChallengeRoutes from "./modules/matchChallenges/matchChallenge.routes";
import teamReviewRoutes from "./modules/teamReviews/teamReview.routes";
import searchRoutes from "./modules/search/search.routes";
import scoringRequestRoutes from "./modules/scoringRequests/scoringRequest.routes";
import highlightRoutes from "./modules/highlights/highlight.routes";
import statsRoutes from "./modules/stats/stats.routes";  

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/scoring", scoreRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/grounds", groundRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/follows", followRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/team-invitations", invitationRoutes);
app.use("/api/vice-captain-proposals", viceCaptainProposalRoutes);
app.use("/api/match-challenges", matchChallengeRoutes);
app.use("/api/team-reviews", teamReviewRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/scoring-requests", scoringRequestRoutes);
app.use("/api/highlights", highlightRoutes);
app.use("/api/stats", statsRoutes);



app.get("/", (_, res) => {
  res.send("Backend Running");
});

/*
|--------------------------------------------------------------------------
| Global Error Handler
|--------------------------------------------------------------------------
|
| Express 5 auto-catches rejected promises from async route handlers and
| forwards them here - but without this, its own default handler sends
| back plain HTML/text, not the { success, message } JSON shape every
| frontend catch block expects (error.response?.data?.message). Without
| this, ANY unhandled error anywhere in the API (not just one route)
| surfaces to the user as a generic, unhelpful fallback message instead
| of the real reason.
|
| Must be registered last, and must take all four (err, req, res, next)
| params - that's how Express recognizes error-handling middleware.
|
*/

app.use(
  (
    err: any,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    console.error(err);

    const status =
      err.name === "ValidationError" || err.name === "CastError" ? 400 : 500;

    res.status(status).json({
      success: false,
      message: err.message || "Something went wrong.",
    });
  },
);

export default app;