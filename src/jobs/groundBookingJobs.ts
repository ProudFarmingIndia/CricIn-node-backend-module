import {
  expireStaleRequests,
  sendTomorrowReminders,
} from "../modules/grounds/groundBooking.service";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Jobs
|
| File:
| groundBookingJobs.ts
|
| Description:
| The two things the grounds feature needs a clock for.
|
| WHY EXPIRY IS NOT OPTIONAL
|
| A booking request is not a hold, but it LOOKS like one: while it sits
| there the slot shows as taken on the availability screen, because a
| request that could still be approved has to. So an owner who stops
| opening the app quietly freezes every slot anybody ever asked for, and
| every one of those players believes they have a ground until Sunday
| morning.
|
| Twelve hours by default, per-ground configurable, and never past the slot
| itself.
|
| WHY THE REMINDER RUNS ONCE A DAY AND NOT HOURLY
|
| It queries a whole day's window - everything confirmed for tomorrow - so
| running it twice would send everything twice. Rather than add a
| `reminderSentAt` column to guard against that, it runs on a daily timer
| and the window matches the timer. One fewer field, and no chance of a
| duplicate from a restart mid-window.
|
| The trade-off: a server that restarts at 9 PM sends the reminders again,
| because the boot call has no memory of the 8 AM run. That is a real cost
| and it is accepted - a duplicate reminder is a minor annoyance, a missed
| one means an empty ground. If restarts become frequent enough for anybody
| to complain, `reminderSentAt` is the fix.
|
| BOTH ARE SAFE TO RUN CONCURRENTLY WITH ANYTHING
|
| expireStaleRequests only touches bookings whose expiresAt has already
| passed, and sets a terminal status - so an owner approving one at the same
| instant either wins (expiresAt is cleared, the job's filter no longer
| matches) or loses harmlessly (the approve finds an expired booking and
| refuses with a clear message).
|
|--------------------------------------------------------------------------
*/

export const runGroundExpiry = async (): Promise<void> => {
  try {
    const count = await expireStaleRequests();

    if (count) {
      console.log(`[grounds] ${count} stale booking request(s) expired`);
    }
  } catch (error: any) {
    console.error("[grounds] expiry job failed:", error?.message || error);
  }
};

export const runGroundReminders = async (): Promise<void> => {
  try {
    const count = await sendTomorrowReminders();

    if (count) {
      console.log(`[grounds] reminders sent for ${count} booking(s)`);
    }
  } catch (error: any) {
    console.error("[grounds] reminder job failed:", error?.message || error);
  }
};

export default runGroundExpiry;
