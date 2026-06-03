import dotenv from "dotenv";
dotenv.config();

import http from "http";

import app from "./app";
import { connectDB } from "./config/db";

import { initSocket } from "./socket/socket";

const PORT = process.env.PORT || 5000;

connectDB();

const server = http.createServer(app);

initSocket(server);

server.listen(PORT, () => {
  console.log(
    `Server Running on ${PORT}`
  );
});