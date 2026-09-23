import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as GroundService from "./ground.service";
import * as BookingService from "./groundBooking.service";
import * as ReviewService from "./groundReview.service";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| ground.controller.ts
|
| Description:
| HTTP in, JSON out. No decisions.
|
| WHY THERE IS NO try/catch ANYWHERE IN THIS FILE
|
| Express 5 catches a rejected promise from an async handler and forwards
| it to the global error handler in app.ts, which already turns an AppError
| into the { success, message } shape the app's catch blocks read.
|
| A try/catch here would have to re-implement that, and the first one that
| got it slightly wrong would return a 200 with an error inside it.
|
| WHY EVERY HANDLER PASSES req.user.userId EXPLICITLY
|
| The service layer never reads the request. Ownership, permission and
| "whose bookings are these" are decided there, from an id handed in - so
| the same function is callable from a cron job or a script without
| inventing a fake request object. It also means no service function can
| accidentally trust something the client sent in place of the session.
|
|--------------------------------------------------------------------------
*/

const ok = (res: Response, data: any, status = 200) =>
  res.status(status).json({ success: true, data });

/*
|--------------------------------------------------------------------------
| Options - the lists the app builds its filters from
|--------------------------------------------------------------------------
|
| Unauthenticated on purpose: the discovery screen needs the facility chips
| before a user has done anything, and none of it is private.
*/

export const getOptions = async (_req: AuthRequest, res: Response) => {
  ok(res, await GroundService.getOptions());
};

/*
|--------------------------------------------------------------------------
| Discovery
|--------------------------------------------------------------------------
|
| Everything arrives as a query string, which means everything arrives as a
| string. The service does the coercion - one place, so "5" and 5 cannot
| behave differently depending on which screen sent the request.
*/

export const searchGrounds = async (req: AuthRequest, res: Response) => {
  ok(res, await GroundService.searchGrounds(req.query));
};

export const getGroundById = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await GroundService.getGroundById(
      req.params.id as string,
      req.user?.userId,
      {
        latitude: req.query.latitude,
        longitude: req.query.longitude,
      },
    ),
  );
};

/*
| A day's slots on a ground, with each one marked available, booked,
| blocked or past. The app renders it directly - it does no filtering of
| its own, because a slot that is hidden rather than explained makes a
| player think the app is broken.
*/

export const getAvailability = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await GroundService.getAvailability(
      req.params.id as string,
      (req.query.date as string) || new Date(),
      { unitType: req.query.unitType as string },
    ),
  );
};

export const getGroundReviews = async (req: AuthRequest, res: Response) => {
  ok(res, await ReviewService.getGroundReviews(req.params.id as string, req.query));
};

/*
|--------------------------------------------------------------------------
| Owner - the ground itself
|--------------------------------------------------------------------------
*/

export const createGround = async (req: AuthRequest, res: Response) => {
  ok(res, await GroundService.createGround(req.user.userId, req.body), 201);
};

export const getMyGrounds = async (req: AuthRequest, res: Response) => {
  ok(res, await GroundService.getMyGrounds(req.user.userId));
};

export const updateGround = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await GroundService.updateGround(
      req.params.id as string,
      req.user.userId,
      req.body,
    ),
  );
};

export const setGroundPaused = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await GroundService.setGroundPaused(
      req.params.id as string,
      req.user.userId,
      !!req.body?.paused,
    ),
  );
};

export const deleteGround = async (req: AuthRequest, res: Response) => {
  await GroundService.deleteGround(req.params.id as string, req.user.userId);

  res.status(200).json({ success: true, message: "Ground delete ho gaya." });
};

/*
|--------------------------------------------------------------------------
| Owner - units
|--------------------------------------------------------------------------
*/

export const getUnits = async (req: AuthRequest, res: Response) => {
  ok(res, await GroundService.getUnits(req.params.id as string));
};

export const createUnit = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await GroundService.createUnit(
      req.params.id as string,
      req.user.userId,
      req.body,
    ),
    201,
  );
};

export const updateUnit = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await GroundService.updateUnit(
      req.params.unitId as string,
      req.user.userId,
      req.body,
    ),
  );
};

export const deleteUnit = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await GroundService.deleteUnit(
      req.params.unitId as string,
      req.user.userId,
    ),
  );
};

/*
|--------------------------------------------------------------------------
| Owner - blackouts and calendar
|--------------------------------------------------------------------------
*/

export const addBlackout = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await GroundService.addBlackout(
      req.params.id as string,
      req.user.userId,
      req.body,
    ),
    201,
  );
};

export const removeBlackout = async (req: AuthRequest, res: Response) => {
  await GroundService.removeBlackout(
    req.params.blackoutId as string,
    req.user.userId,
  );

  res.status(200).json({ success: true, message: "Blackout hata diya." });
};

export const getOwnerCalendar = async (req: AuthRequest, res: Response) => {
  const now = new Date();

  ok(
    res,
    await GroundService.getOwnerCalendar(
      req.params.id as string,
      req.user.userId,
      (req.query.from as string) || now,
      (req.query.to as string) ||
        new Date(now.getFullYear(), now.getMonth() + 1, 0),
    ),
  );
};

/*
|--------------------------------------------------------------------------
| Bookings - the player's side
|--------------------------------------------------------------------------
*/

export const requestBooking = async (req: AuthRequest, res: Response) => {
  ok(res, await BookingService.requestBooking(req.user.userId, req.body), 201);
};

export const getMyBookings = async (req: AuthRequest, res: Response) => {
  ok(res, await BookingService.getMyBookings(req.user.userId, req.query));
};

export const getBookingById = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.getBookingById(
      req.params.bookingId as string,
      req.user.userId,
    ),
  );
};

export const respondToCounter = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.respondToCounter(
      req.params.bookingId as string,
      req.user.userId,
      !!req.body?.accept,
    ),
  );
};

/*
| Cancel is the one booking action either side can take, so it is not
| under an owner-only route. The service decides which of them did it from
| the session, and records it differently for each.
*/

export const cancelBooking = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.cancelBooking(
      req.params.bookingId as string,
      req.user.userId,
      req.body?.reason,
    ),
  );
};

/*
| Check-out is available to both as well - whoever is holding a phone when
| the game ends. Check-IN is owner-only, because it is the owner confirming
| the side is physically there, and a team marking its own arrival would
| make the delay timestamps worthless.
*/

export const checkOut = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.checkOut(
      req.params.bookingId as string,
      req.user.userId,
      req.body,
    ),
  );
};

export const getAttachableBookings = async (
  req: AuthRequest,
  res: Response,
) => {
  ok(res, await BookingService.getAttachableBookings(req.user.userId));
};

export const attachMatchToBooking = async (
  req: AuthRequest,
  res: Response,
) => {
  ok(
    res,
    await BookingService.attachMatchToBooking(
      req.params.bookingId as string,
      req.user.userId,
      req.body?.matchId,
    ),
  );
};

/*
|--------------------------------------------------------------------------
| Bookings - the owner's side
|--------------------------------------------------------------------------
*/

export const getOwnerBookings = async (req: AuthRequest, res: Response) => {
  ok(res, await BookingService.getOwnerBookings(req.user.userId, req.query));
};

export const approveBooking = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.approveBooking(
      req.params.bookingId as string,
      req.user.userId,
    ),
  );
};

export const rejectBooking = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.rejectBooking(
      req.params.bookingId as string,
      req.user.userId,
      req.body?.reason,
    ),
  );
};

export const counterBooking = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.counterBooking(
      req.params.bookingId as string,
      req.user.userId,
      req.body,
    ),
  );
};

export const checkIn = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.checkIn(
      req.params.bookingId as string,
      req.user.userId,
    ),
  );
};

export const markNoShow = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.markNoShow(
      req.params.bookingId as string,
      req.user.userId,
    ),
  );
};

export const setPaymentStatus = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await BookingService.setPaymentStatus(
      req.params.bookingId as string,
      req.user.userId,
      req.body?.paymentStatus,
    ),
  );
};

export const getOwnerEarnings = async (req: AuthRequest, res: Response) => {
  ok(res, await BookingService.getOwnerEarnings(req.user.userId, req.query));
};

/*
|--------------------------------------------------------------------------
| Reviews
|--------------------------------------------------------------------------
*/

export const getReviewForm = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await ReviewService.getReviewForm(
      req.params.bookingId as string,
      req.user.userId,
    ),
  );
};

export const createReview = async (req: AuthRequest, res: Response) => {
  ok(res, await ReviewService.createReview(req.user.userId, req.body), 201);
};

export const updateMyReview = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await ReviewService.updateMyReview(
      req.params.reviewId as string,
      req.user.userId,
      req.body,
    ),
  );
};

export const getMyReviews = async (req: AuthRequest, res: Response) => {
  ok(res, await ReviewService.getMyReviews(req.user.userId));
};

export const replyToReview = async (req: AuthRequest, res: Response) => {
  ok(
    res,
    await ReviewService.replyToReview(
      req.params.reviewId as string,
      req.user.userId,
      req.body?.text,
    ),
  );
};

/*
|--------------------------------------------------------------------------
| Back-compat
|--------------------------------------------------------------------------
|
| The app's current build calls GET /grounds and GET /grounds/all. Both are
| kept pointing at the new implementations so an older installed app does
| not break the day this ships - a released binary cannot be asked to
| update in step with the server.
*/

export const getGrounds = getMyGrounds;

export const getAllGrounds = searchGrounds;
