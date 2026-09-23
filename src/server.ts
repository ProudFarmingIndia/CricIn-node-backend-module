import dotenv from "dotenv";
dotenv.config();

import http from "http";

import app from "./app";
import { connectDB } from "./config/db";

import { initSocket } from "./socket/socket";

import cleanupDraftMatches from "./jobs/cleanupDraftMatches";
import monitorLiveStreams from "./jobs/monitorLiveStreams";
import manageRecordings from "./jobs/manageRecordings";
import {
  runGroundExpiry,
  runGroundReminders,
} from "./jobs/groundBookingJobs";

const PORT = process.env.PORT || 5000;

connectDB();

const server = http.createServer(app);

initSocket(server);

/*
|--------------------------------------------------------------------------
| Abandoned Draft Cleanup
|--------------------------------------------------------------------------
|
| "Go Live" creates a draft match up front, and the ones nobody comes back
| to leave a Mux stream behind that bills storage every month against a
| match no screen in the app links to.
|
| Runs on boot and every six hours after. Deliberately not a cron package -
| this is one function on a timer and does not need a scheduler.
|
*/

setInterval(cleanupDraftMatches, 6 * 60 * 60 * 1000);

cleanupDraftMatches();

/*
|--------------------------------------------------------------------------
| Live Stream Monitor
|--------------------------------------------------------------------------
|
| Ends streams nobody ended themselves - the match was never marked
| complete, the phones went in pockets, and it would otherwise run to
| Mux's twelve-hour ceiling recording the inside of a bag.
|
| It also reconciles each stream's status against Mux, which is what makes
| the LIVE badge work when no webhook can reach this server - on a laptop,
| after a missed delivery, or with a wrong signing secret.
|
| Sixty seconds, not two minutes. The idle warning does not care either
| way, but the status reconcile does: it is the only thing telling the app
| a camera came on, and two minutes of a broadcaster staring at "not
| connected yet" while they are plainly broadcasting reads as broken.
|
*/

setInterval(monitorLiveStreams, 60 * 1000);

monitorLiveStreams();

/*
|--------------------------------------------------------------------------
| Recording Sweep
|--------------------------------------------------------------------------
|
| Phase one keeps no post-match video at all. The webhook deletes each
| recording the moment Mux finishes it; this is the net underneath, for
| the streams recorded while no webhook was configured and the deletes
| that failed.
|
| Hourly is plenty - storage is prorated, so an asset that slips through
| for an hour costs a fraction of a paisa.
|
*/

setInterval(manageRecordings, 60 * 60 * 1000);

manageRecordings();

/*
|--------------------------------------------------------------------------
| Ground Booking Expiry
|--------------------------------------------------------------------------
|
| A booking request holds its slot on the availability screen - it has to,
| because it could still be approved. So an owner who stops opening the app
| would otherwise freeze every slot anybody ever asked for, while each of
| those players believes they have a ground.
|
| Fifteen minutes. It is one indexed query that usually returns nothing,
| and the tighter the interval the closer a released slot is to being
| honestly bookable again by somebody else.
|
*/

setInterval(runGroundExpiry, 15 * 60 * 1000);

runGroundExpiry();

/*
|--------------------------------------------------------------------------
| Ground Booking Reminders
|--------------------------------------------------------------------------
|
| Tomorrow's confirmed bookings, to both the team and the ground. The
| single most valuable message in the feature: a ground owner who knows a
| side is coming at 6 AM opens the gate at 6 AM.
|
| Daily, because the query covers a whole day - running it more often would
| simply send everything again. See the note in the job file on why that is
| a timer rather than a `reminderSentAt` column.
|
*/

setInterval(runGroundReminders, 24 * 60 * 60 * 1000);

runGroundReminders();

server.listen(PORT, () => {
  console.log(
    `Server Running on ${PORT}`
  );
});