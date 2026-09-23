import { createNotification } from "../notifications/notification.service";

import { NOTIFICATION_TYPES } from "../notifications/notification.types";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| ground.notifications.ts
|
| Description:
| Every message the grounds feature sends, in one place.
|
| WHY NOT IN notification.helper.ts WITH THE REST
|
| That file is already 700 lines and covers teams, matches and series.
| Adding fourteen more senders to it would make the grounds feature
| impossible to read as a unit and would mean touching a shared file every
| time a booking message changes wording.
|
| They all call the same createNotification underneath, so nothing about
| delivery differs - this is purely about where the text lives.
|
| WHY EVERY ONE OF THESE IS FIRE-AND-FORGET
|
| A notification that fails must never fail the booking. A player who
| tapped "request" and got an error would request again, and now the owner
| has two. So every caller wraps these in `notify(...)` below, which
| swallows the error after logging it - the database write has already
| happened and is the thing that matters.
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| The swallow
|--------------------------------------------------------------------------
|
| One wrapper rather than a try/catch at each of the thirty call sites,
| because the thirtieth one would have been the one that forgot.
*/

export const notify = async (fn: () => Promise<any>): Promise<void> => {
  try {
    await fn();
  } catch (error) {
    console.error("[grounds] notification failed:", error);
  }
};

/*
|--------------------------------------------------------------------------
| Formatting
|--------------------------------------------------------------------------
|
| Times are formatted here rather than in each sender so every message
| reads the same way. "Sat, 12 Oct · 6:00 AM" - day first because the
| first thing anybody checks is whether it is the right date.
*/

const fmtDate = (d: Date | string): string =>
  new Date(d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const fmtTime = (d: Date | string): string =>
  new Date(d).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

export const slotLabel = (start: Date | string, end: Date | string): string =>
  `${fmtDate(start)} · ${fmtTime(start)} - ${fmtTime(end)}`;

/*
| The payload every booking notification carries. The app needs the
| booking id to open the right screen and the ground id to open the right
| ground, and it gets both on every single type so no screen has to
| special-case a missing field.
*/

const bookingData = (booking: any, extra: Record<string, any> = {}) => ({
  bookingId: String(booking?._id || ""),

  groundId: String(booking?.groundId?._id || booking?.groundId || ""),

  unitId: String(booking?.unitId?._id || booking?.unitId || ""),

  matchId: booking?.matchId ? String(booking.matchId) : null,

  startTime: booking?.startTime || null,

  endTime: booking?.endTime || null,

  status: booking?.status || "",

  ...extra,
});

/*
|--------------------------------------------------------------------------
| To the owner: somebody wants the slot
|--------------------------------------------------------------------------
|
| The flexibility line is included only when there is some, because "can
| move by 0 minutes" is noise. When there IS flexibility it is the single
| most useful thing in the message - it tells the owner they can counter
| rather than reject.
*/

export const sendBookingRequested = async ({
  ownerId,
  actorId,
  booking,
  groundName,
  unitName,
  requesterName,
}: {
  ownerId: string;
  actorId: string;
  booking: any;
  groundName: string;
  unitName: string;
  requesterName: string;
}) => {
  const flex = Number(booking?.flexibilityMinutes || 0);

  const flexLine = flex > 0 ? ` Can shift by up to ${flex} min.` : "";

  return createNotification({
    receiverId: ownerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_CREATED,

    title: "New booking request",

    message: `${requesterName} wants ${unitName} at ${groundName} - ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}.${flexLine}`,

    data: bookingData(booking, { groundName, unitName }),
  });
};

/*
|--------------------------------------------------------------------------
| To the player: confirmed
|--------------------------------------------------------------------------
|
| The amount is in the message because it is the one fact the player will
| want without opening anything, and because a total that first appears at
| the gate is how a ground gets a one-star review.
*/

export const sendBookingApproved = async ({
  playerId,
  actorId,
  booking,
  groundName,
  unitName,
}: {
  playerId: string;
  actorId: string;
  booking: any;
  groundName: string;
  unitName: string;
}) => {
  return createNotification({
    receiverId: playerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_APPROVED,

    title: "Booking confirmed",

    message: `${groundName} confirmed ${unitName} for ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}. Pay Rs ${booking.amount} at the ground.`,

    data: bookingData(booking, { groundName, unitName }),
  });
};

export const sendBookingRejected = async ({
  playerId,
  actorId,
  booking,
  groundName,
  reason,
}: {
  playerId: string;
  actorId: string;
  booking: any;
  groundName: string;
  reason?: string;
}) => {
  const why = reason ? ` Reason: ${reason}` : "";

  return createNotification({
    receiverId: playerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_REJECTED,

    title: "Booking declined",

    message: `${groundName} could not take ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}.${why}`,

    data: bookingData(booking, { groundName, reason: reason || "" }),
  });
};

/*
|--------------------------------------------------------------------------
| To the player: a different time is on offer
|--------------------------------------------------------------------------
|
| Both times are in the message - what they asked for and what is being
| offered - because a counter-offer that shows only the new time reads like
| a confirmation of something they never asked for.
*/

export const sendBookingCountered = async ({
  playerId,
  actorId,
  booking,
  groundName,
}: {
  playerId: string;
  actorId: string;
  booking: any;
  groundName: string;
}) => {
  const msg = booking?.counterOffer?.message
    ? ` "${booking.counterOffer.message}"`
    : "";

  return createNotification({
    receiverId: playerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_COUNTERED,

    title: "Different time offered",

    message: `${groundName} cannot do ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}, but offers ${slotLabel(
      booking.counterOffer.startTime,
      booking.counterOffer.endTime,
    )}.${msg}`,

    data: bookingData(booking, {
      groundName,

      counterStart: booking?.counterOffer?.startTime || null,

      counterEnd: booking?.counterOffer?.endTime || null,
    }),
  });
};

export const sendCounterAccepted = async ({
  ownerId,
  actorId,
  booking,
  requesterName,
  unitName,
}: {
  ownerId: string;
  actorId: string;
  booking: any;
  requesterName: string;
  unitName: string;
}) => {
  return createNotification({
    receiverId: ownerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_COUNTER_ACCEPTED,

    title: "New time accepted",

    message: `${requesterName} took your offer - ${unitName}, ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}.`,

    data: bookingData(booking, { unitName }),
  });
};

export const sendCounterDeclined = async ({
  ownerId,
  actorId,
  booking,
  requesterName,
}: {
  ownerId: string;
  actorId: string;
  booking: any;
  requesterName: string;
}) => {
  return createNotification({
    receiverId: ownerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_COUNTER_DECLINED,

    title: "Offer declined",

    message: `${requesterName} did not take the alternative time. The slot is free again.`,

    data: bookingData(booking),
  });
};

/*
|--------------------------------------------------------------------------
| Cancellation - goes to whoever did not do it
|--------------------------------------------------------------------------
*/

export const sendBookingCancelled = async ({
  receiverId,
  actorId,
  booking,
  groundName,
  byOwner,
  reason,
}: {
  receiverId: string;
  actorId: string | null;
  booking: any;
  groundName: string;
  byOwner: boolean;
  reason?: string;
}) => {
  const who = byOwner ? groundName : "The team";

  const why = reason ? ` Reason: ${reason}` : "";

  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_CANCELLED,

    title: "Booking cancelled",

    message: `${who} cancelled ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}.${why}`,

    data: bookingData(booking, { groundName, byOwner }),
  });
};

/*
|--------------------------------------------------------------------------
| To the player: nobody answered
|--------------------------------------------------------------------------
|
| Worth sending even though it is bad news. The alternative is a player
| who believes they have a ground and finds out on Sunday morning.
*/

export const sendBookingExpired = async ({
  playerId,
  booking,
  groundName,
}: {
  playerId: string;
  booking: any;
  groundName: string;
}) => {
  return createNotification({
    receiverId: playerId,

    actorId: null,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_EXPIRED,

    title: "Request expired",

    message: `${groundName} did not answer your request for ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}. Try another ground or another slot.`,

    data: bookingData(booking, { groundName }),
  });
};

export const sendBookingReminder = async ({
  receiverId,
  booking,
  groundName,
  address,
}: {
  receiverId: string;
  booking: any;
  groundName: string;
  address?: string;
}) => {
  const where = address ? ` ${address}.` : "";

  return createNotification({
    receiverId,

    actorId: null,

    type: NOTIFICATION_TYPES.GROUND_BOOKING_REMINDER,

    title: "Booking tomorrow",

    message: `${groundName} - ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}.${where}`,

    data: bookingData(booking, { groundName }),
  });
};

/*
|--------------------------------------------------------------------------
| Check-in
|--------------------------------------------------------------------------
|
| Sent to the player so there is a record on their side too. A ground that
| marks arrival at 7:30 for a 6:00 slot has told the player as much as it
| has told itself, which is what stops that timestamp being disputed
| later.
*/

export const sendCheckedIn = async ({
  playerId,
  actorId,
  booking,
  groundName,
}: {
  playerId: string;
  actorId: string;
  booking: any;
  groundName: string;
}) => {
  const late = Number(booking?.delayMinutes || 0);

  const lateLine =
    late > 0 && booking?.delayFault === "team"
      ? ` Started ${late} min late.`
      : "";

  return createNotification({
    receiverId: playerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_CHECKED_IN,

    title: "Checked in",

    message: `${groundName} marked your session as started.${lateLine}`,

    data: bookingData(booking, { groundName }),
  });
};

/*
|--------------------------------------------------------------------------
| The ground kept you waiting, and here is what was done about it
|--------------------------------------------------------------------------
|
| The most important message in the feature. Nobody had to complain and
| nobody had to be believed - the previous booking's check-out time made
| the call, the end time already moved, and this says so.
*/

export const sendDelayCompensation = async ({
  playerId,
  booking,
  groundName,
  minutes,
}: {
  playerId: string;
  booking: any;
  groundName: string;
  minutes: number;
}) => {
  return createNotification({
    receiverId: playerId,

    actorId: null,

    type: NOTIFICATION_TYPES.GROUND_DELAY_COMPENSATION,

    title: `${minutes} min added to your slot`,

    message: `The session before yours at ${groundName} ran over, so your slot now ends at ${fmtTime(
      booking.endTime,
    )}. No extra charge.`,

    data: bookingData(booking, { groundName, compensationMinutes: minutes }),
  });
};

export const sendSessionCompleted = async ({
  playerId,
  actorId,
  booking,
  groundName,
}: {
  playerId: string;
  actorId: string;
  booking: any;
  groundName: string;
}) => {
  const over = Number(booking?.overtimeMinutes || 0);

  const overLine =
    over > 0
      ? ` ${over} min overtime - Rs ${booking.overtimeAmount} extra, Rs ${booking.totalAmount} total.`
      : ` Rs ${booking.totalAmount} total.`;

  return createNotification({
    receiverId: playerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_SESSION_COMPLETED,

    title: "Session finished",

    message: `${groundName}, ${slotLabel(
      booking.startTime,
      booking.endTime,
    )}.${overLine}`,

    data: bookingData(booking, { groundName }),
  });
};

/*
|--------------------------------------------------------------------------
| Reviews
|--------------------------------------------------------------------------
|
| The request is sent after check-out rather than the next morning,
| because the pitch and the toilets are remembered accurately for about an
| hour.
*/

export const sendReviewRequest = async ({
  playerId,
  booking,
  groundName,
}: {
  playerId: string;
  booking: any;
  groundName: string;
}) => {
  return createNotification({
    receiverId: playerId,

    actorId: null,

    type: NOTIFICATION_TYPES.GROUND_REVIEW_REQUEST,

    title: `How was ${groundName}?`,

    message: "Rate the pitch, the facilities and whether they delivered what they promised.",

    data: bookingData(booking, { groundName }),
  });
};

export const sendReviewReceived = async ({
  ownerId,
  actorId,
  review,
  groundId,
  groundName,
  reviewerName,
}: {
  ownerId: string;
  actorId: string;
  review: any;
  groundId: string;
  groundName: string;
  reviewerName: string;
}) => {
  return createNotification({
    receiverId: ownerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_REVIEW_RECEIVED,

    title: `${review.overall}-star review`,

    message: `${reviewerName} rated ${groundName} ${review.overall}/5.${
      review.comment ? ` "${review.comment}"` : ""
    }`,

    data: {
      reviewId: String(review?._id || ""),

      groundId: String(groundId),

      groundName,

      overall: review.overall,
    },
  });
};

export const sendReviewReply = async ({
  playerId,
  actorId,
  review,
  groundId,
  groundName,
}: {
  playerId: string;
  actorId: string;
  review: any;
  groundId: string;
  groundName: string;
}) => {
  return createNotification({
    receiverId: playerId,

    actorId,

    type: NOTIFICATION_TYPES.GROUND_REVIEW_REPLY,

    title: `${groundName} replied`,

    message: review.ownerReply,

    data: {
      reviewId: String(review?._id || ""),

      groundId: String(groundId),

      groundName,
    },
  });
};
