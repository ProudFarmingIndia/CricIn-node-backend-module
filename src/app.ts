import express from "express";
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

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/scores", scoreRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/grounds", groundRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/follows", followRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/upload", uploadRoutes);

app.get("/", (_, res) => {
  res.send("Backend Running");
});

export default app;
