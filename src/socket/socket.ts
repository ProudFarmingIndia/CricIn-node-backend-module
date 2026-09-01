import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io: Server;

/*
|--------------------------------------------------------------------------
| Init Socket
|--------------------------------------------------------------------------
|
| JWT-based auth middleware for socket connections. On a valid token the
| socket joins a personal room (`user:${userId}`) so the rest of the app
| can push real-time events to a specific user via emitToUser().
|
| The token is verified against JWT_ACCESS_SECRET (the same secret the
| REST auth middleware uses to sign/verify), falling back to JWT_SECRET
| and finally a literal "secret" so the socket still boots in dev.
|
*/

const getJwtSecret = (): string =>
  (process.env.JWT_ACCESS_SECRET as string) ||
  (process.env.JWT_SECRET as string) ||
  "secret";

export const initSocket = (server: any) => {
  io = new Server(server, {
    cors: { origin: "*" },
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      // Allow unauthenticated connections; room join simply won't happen.
      return next();
    }

    try {
      const decoded: any = jwt.verify(token as string, getJwtSecret());
      (socket as any).userId = decoded.userId;
      next();
    } catch {
      // Invalid token - still allow the connection, just without a userId.
      next();
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket as any).userId;

    console.log(
      "Client Connected:",
      socket.id,
      userId ? `(user: ${userId})` : "",
    );

    if (userId) {
      socket.join(`user:${userId}`);
    }

    socket.on("disconnect", () => {
      console.log("Client Disconnected:", socket.id);
    });
  });

  return io;
};

export const getIO = () => io;

export const emitToUser = (userId: string, event: string, data: any) => {
  if (io && userId) {
    io.to(`user:${userId}`).emit(event, data);
  }
};
