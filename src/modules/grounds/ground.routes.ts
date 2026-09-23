import { Router } from "express";

import { authMiddleware } from "../../shared/middleware/auth.middleware";

import * as C from "./ground.controller";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| ground.routes.ts
|
| Description:
| Every grounds endpoint, mounted at /api/grounds.
|
| WHAT WAS WRONG WITH THE OLD FILE
|
| PUT /:id and DELETE /:id had authMiddleware and nothing else. Any logged
| in user could edit or delete any ground in the database - not a
| theoretical hole, a working one. The fix is not in this file: every owner
| handler now goes through a service that calls assertOwner, so the check
| cannot be forgotten at the routing layer again.
|
| ORDER MATTERS, AND THIS IS WHERE IT BITES
|
| Express matches top to bottom, so every literal path has to come before
| /:id. With /:id first, a request to /options would match it with
| id = "options", the service would fail to cast that to an ObjectId, and
| the error would say "Ground nahi mila" - which sends you looking in
| completely the wrong place.
|
| Hence the layout below: literals, then bookings and reviews (which have
| their own prefixes), then the /:id family last.
|
| WHY BOOKINGS LIVE HERE AND NOT AT /api/bookings
|
| They are only ever bookings OF a ground, and mounting them separately
| would mean a second route file, a second mount in app.ts and two places
| to look when a booking endpoint 404s. If shop orders later need bookings
| of their own, that is when a split earns its keep.
|
|--------------------------------------------------------------------------
*/

const router = Router();

/*
|--------------------------------------------------------------------------
| Open
|--------------------------------------------------------------------------
|
| The filter lists are needed before the discovery screen can render, and
| there is nothing private in them.
*/

router.get("/options", C.getOptions);

/*
| Back-compat: the installed app calls GET /grounds/all. It has to sit up
| here with the other literal paths - below /:id it would be read as a
| ground whose id is "all".
*/

router.get("/all", authMiddleware, C.getAllGrounds);

/*
|--------------------------------------------------------------------------
| Discovery
|--------------------------------------------------------------------------
|
| Authenticated because the response is personalised - distance from the
| user, and whether they have an existing booking at each ground.
*/

router.get("/search", authMiddleware, C.searchGrounds);

/*
|--------------------------------------------------------------------------
| The owner's own things
|--------------------------------------------------------------------------
|
| /mine before /:id, or "mine" is read as an id.
*/

router.get("/mine", authMiddleware, C.getMyGrounds);

router.get("/mine/bookings", authMiddleware, C.getOwnerBookings);

router.get("/mine/earnings", authMiddleware, C.getOwnerEarnings);

/*
|--------------------------------------------------------------------------
| The player's own things
|--------------------------------------------------------------------------
*/

router.get("/my-bookings", authMiddleware, C.getMyBookings);

router.get("/my-reviews", authMiddleware, C.getMyReviews);

/*
| Bookings of the player's that have no match attached yet - what the
| "add a ground to this match" screen offers.
*/

router.get("/attachable-bookings", authMiddleware, C.getAttachableBookings);

/*
|--------------------------------------------------------------------------
| Bookings
|--------------------------------------------------------------------------
|
| Created at /bookings rather than /:id/bookings because the request body
| already carries the ground and the unit, and a ground id in the path as
| well would be a second source of truth for the same fact.
*/

router.post("/bookings", authMiddleware, C.requestBooking);

router.get("/bookings/:bookingId", authMiddleware, C.getBookingById);

/* Either side. */

router.patch("/bookings/:bookingId/cancel", authMiddleware, C.cancelBooking);

router.patch("/bookings/:bookingId/check-out", authMiddleware, C.checkOut);

/* Player only - enforced in the service, not here. */

router.patch(
  "/bookings/:bookingId/counter-response",
  authMiddleware,
  C.respondToCounter,
);

router.patch(
  "/bookings/:bookingId/attach-match",
  authMiddleware,
  C.attachMatchToBooking,
);

/* Owner only - enforced in the service. */

router.patch("/bookings/:bookingId/approve", authMiddleware, C.approveBooking);

router.patch("/bookings/:bookingId/reject", authMiddleware, C.rejectBooking);

router.patch("/bookings/:bookingId/counter", authMiddleware, C.counterBooking);

router.patch("/bookings/:bookingId/check-in", authMiddleware, C.checkIn);

router.patch("/bookings/:bookingId/no-show", authMiddleware, C.markNoShow);

router.patch("/bookings/:bookingId/payment", authMiddleware, C.setPaymentStatus);

/*
|--------------------------------------------------------------------------
| Reviews
|--------------------------------------------------------------------------
|
| The form is fetched per BOOKING rather than per ground, because the
| questions depend on what that ground promised and the answer depends on
| whether this booking was actually played.
*/

router.get(
  "/reviews/form/:bookingId",
  authMiddleware,
  C.getReviewForm,
);

router.post("/reviews", authMiddleware, C.createReview);

router.patch("/reviews/:reviewId", authMiddleware, C.updateMyReview);

router.patch("/reviews/:reviewId/reply", authMiddleware, C.replyToReview);

/*
|--------------------------------------------------------------------------
| Units, blackouts and the calendar - all under a ground
|--------------------------------------------------------------------------
|
| These come before the bare /:id routes below but after every literal
| path, because they are still /:id/... and would swallow nothing, while
| /:id itself would swallow them.
*/

router.get("/:id/units", authMiddleware, C.getUnits);

router.post("/:id/units", authMiddleware, C.createUnit);

router.put("/:id/units/:unitId", authMiddleware, C.updateUnit);

router.delete("/:id/units/:unitId", authMiddleware, C.deleteUnit);

router.get("/:id/availability", authMiddleware, C.getAvailability);

router.get("/:id/calendar", authMiddleware, C.getOwnerCalendar);

router.get("/:id/reviews", authMiddleware, C.getGroundReviews);

router.post("/:id/blackouts", authMiddleware, C.addBlackout);

router.delete(
  "/:id/blackouts/:blackoutId",
  authMiddleware,
  C.removeBlackout,
);

/*
|--------------------------------------------------------------------------
| The ground itself
|--------------------------------------------------------------------------
*/

router.post("/", authMiddleware, C.createGround);

router.get("/:id", authMiddleware, C.getGroundById);

router.put("/:id", authMiddleware, C.updateGround);

router.patch("/:id/pause", authMiddleware, C.setGroundPaused);

router.delete("/:id", authMiddleware, C.deleteGround);

/*
|--------------------------------------------------------------------------
| Back-compat
|--------------------------------------------------------------------------
|
| The installed app calls GET /grounds for its own list (/all is up with
| the literal paths, where it has to be).
|
| GET "/" is registered last because it cannot conflict with anything - a
| bare root path never matches /:id or /bookings/... - so it is the one
| legacy line that is safe at the bottom.
*/

router.get("/", authMiddleware, C.getGrounds);

export default router;
