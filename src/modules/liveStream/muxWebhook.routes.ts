/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| muxWebhook.routes.ts
|
| Mounted at /api/webhooks/mux - and it must be mounted BEFORE
| express.json() in app.ts.
|
| The signature is an HMAC over the raw request body. Once express.json()
| has parsed and re-serialised it, the bytes are no longer the bytes Mux
| signed and every webhook fails verification - with a 401 that looks
| exactly like a wrong secret.
|
|--------------------------------------------------------------------------
*/

import express, { Router } from "express";

import { handleMuxWebhook } from "./muxWebhook.controller";

const router = Router();

router.post(
  "/",
  express.raw({ type: "application/json" }),
  handleMuxWebhook,
);

export default router;
