import express from "express";
import cors from "cors";

import authRoutes from "./modules/auth/auth.routes";
import userRoutes from "./modules/users/user.routes";
import playerRoutes from "./modules/players/player.routes"; 
import teamRoutes from "./modules/teams/team.routes";
import matchRoutes from "./modules/matches/match.routes";
import scoreRoutes from "./modules/scoring/scoring.routes";


const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes );
app.use("/api/users", userRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/scores", scoreRoutes);


app.get("/", (_, res) => {
  res.send("Backend Running");
});

export default app;