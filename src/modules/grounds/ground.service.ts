import mongoose from "mongoose";

import Ground from "./ground.model";
import GroundUnit from "./groundUnit.model";
import GroundBooking from "./groundBooking.model";
import GroundBlackout from "./groundBlackout.model";
import GroundReview from "./groundReview.model";

import User from "../users/user.model";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

import {
  GROUND_FACILITIES,
  PITCH_TYPES,
  GROUND_SORTS,
  DISTANCE_OPTIONS_KM,
  GROUND_DEFAULTS,
  UNIT_TYPES,
} from "./ground.constants";

import {
  toMinutes,
  toHHMM,
  atTime,
  addMinutes,
  minutesBetween,
  startOfLocalDay,
  endOfLocalDay,
  overlaps,
  blockRate,
  netAmount,
  netHourlyRate,
  hoursForDate,
  isNightSlot,
  haversineKm,
} from "./ground.helpers";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| ground.service.ts
|
| Description:
| Listing a ground, finding one, and working out what is free.
|
| THE HOLE THIS CLOSES
|
| The previous version of this file had six functions and not one of them
| checked who was calling:
|
|     export const updateGround = async (groundId, payload) =>
|       await Ground.findByIdAndUpdate(groundId, payload, { new: true });
|
| No owner argument. The route had authMiddleware, so the caller had to be
| SOMEBODY - but any logged-in user could rewrite or delete any ground in
| the database, including its price and its phone number. Every write below
| takes a userId and proves ownership first.
|
| THE OTHER HOLE
|
| Discovery could not exist. Grounds stored latitude and longitude as two
| plain numbers, which Mongo cannot answer a "within 5 km" query against -
| so the only way to build the screen would have been to load every ground
| and measure in JavaScript. searchGrounds below uses a $geoNear stage
| against the 2dsphere index instead, which does the distance, the filter
| and the sort in one pass and returns the distance as a field.
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Guards
|--------------------------------------------------------------------------
*/

const assertOwner = async (groundId: string, userId: string) => {
  const ground: any = await Ground.findById(groundId);

  if (!ground) {
    throw new AppError("Ground nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(ground.userId) !== String(userId)) {
    throw new AppError(
      "Ye ground tumhara nahi hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  return ground;
};

/*
|--------------------------------------------------------------------------
| A ground is only listable once it can actually be booked
|--------------------------------------------------------------------------
|
| Two things make the difference between a listing and a dead end: a pin on
| the map, and at least one active pitch or net. Without the pin it cannot
| appear in any distance search; without a unit there is nothing to book.
|
| So `draft` is not a state the owner chooses - it is simply what a ground
| is until both exist, and it flips to `active` the moment they do. Asking
| the owner to remember to publish would leave finished grounds invisible
| and half-finished ones listed.
*/

const refreshPublishState = async (groundId: string) => {
  const ground: any = await Ground.findById(groundId);

  if (!ground || ground.status === "paused") return ground;

  const hasPin =
    Array.isArray(ground.location?.coordinates) &&
    ground.location.coordinates.length === 2;

  const unitCount = await GroundUnit.countDocuments({
    groundId,
    isActive: true,
  });

  const next = hasPin && unitCount > 0 ? "active" : "draft";

  if (ground.status !== next) {
    ground.status = next;
    await ground.save();
  }

  return ground;
};

/*
| Location arrives from the app as plain lat/lng, because that is what a
| map pin hands back. Turning it into GeoJSON is done here rather than
| trusting the client to send [lng, lat] in the right order - the one
| mistake that silently drops a ground off the map forever.
*/

const applyLocation = (payload: any) => {
  const lat = Number(payload?.latitude);
  const lng = Number(payload?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return payload;

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError(
      "Location ke coordinates galat hain.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  return {
    ...payload,
    latitude: lat,
    longitude: lng,
    location: { type: "Point", coordinates: [lng, lat] },
  };
};

/*
|--------------------------------------------------------------------------
| Options
|--------------------------------------------------------------------------
|
| The app draws its filter chips and its add-ground checkboxes from this
| rather than keeping its own copy of the lists. A new facility then shows
| up everywhere without an app release - and, more importantly, the filter
| can never offer something the schema will reject.
*/

export const getOptions = async () => ({
  facilities: GROUND_FACILITIES,
  pitchTypes: PITCH_TYPES,
  sorts: GROUND_SORTS,
  distances: DISTANCE_OPTIONS_KM,
  unitTypes: UNIT_TYPES,
  defaults: GROUND_DEFAULTS,
});

/*
|--------------------------------------------------------------------------
| Owner - the ground itself
|--------------------------------------------------------------------------
*/

export const createGround = async (userId: string, payload: any) => {
  if (!payload?.groundName?.trim()) {
    throw new AppError("Ground ka naam zaroori hai.", HTTP_STATUS.BAD_REQUEST);
  }

  const ground = await Ground.create({
    ...applyLocation(payload),
    userId,
    status: "draft",
  });

  await refreshPublishState(String(ground._id));

  /*
  | Listing a ground makes you a ground owner - the app's role switcher
  | reads this, so the owner menu appears without them being told to go
  | and enable something.
  |
  | It does not take anything away: `roles` is a set, so they are still a
  | player, and `activeRole` is deliberately untouched here. Switching the
  | navigator out from under somebody who is halfway through adding a
  | ground would be the app deciding what screen they wanted.
  |
  | Best-effort, and not inside a transaction with the create. A role flag
  | that failed to write costs them one tap on the switcher; a ground that
  | failed to save because of it would cost them the whole form.
  */

  try {
    await User.findByIdAndUpdate(userId, {
      $addToSet: { roles: "ground_owner" },
    });
  } catch (error) {
    console.error("[grounds] could not grant ground_owner role:", error);
  }

  return await Ground.findById(ground._id);
};

export const updateGround = async (
  groundId: string,
  userId: string,
  payload: any,
) => {
  const ground: any = await assertOwner(groundId, userId);

  /*
  | None of these are editable through the generic update. The owner does
  | not get to mark their own ground verified, hand it to somebody else, or
  | write their own rating - and the add-ground form posts the whole object
  | back, so this is the normal path rather than an attack.
  */

  const clean = { ...payload };

  delete clean.userId;
  delete clean.isVerified;
  delete clean.rating;
  delete clean.promiseScore;
  delete clean.stats;
  delete clean.status;

  Object.assign(ground, applyLocation(clean));

  await ground.save();

  return await refreshPublishState(groundId);
};

/*
| Pause and resume. Separate from update because it is the one status
| change the owner DOES control, and it must not be reachable by posting
| `status` into the generic update above.
*/

export const setGroundPaused = async (
  groundId: string,
  userId: string,
  paused: boolean,
) => {
  const ground: any = await assertOwner(groundId, userId);

  if (paused) {
    ground.status = "paused";
    await ground.save();

    return ground;
  }

  ground.status = "draft"; /* refreshPublishState decides if it can go live */
  await ground.save();

  return await refreshPublishState(groundId);
};

export const deleteGround = async (groundId: string, userId: string) => {
  await assertOwner(groundId, userId);

  /*
  | A ground with future bookings on it cannot be deleted. Somebody has
  | planned a Sunday around it, and a delete would leave them holding a
  | confirmation for a place that no longer exists.
  */

  const upcoming = await GroundBooking.countDocuments({
    groundId,
    status: { $in: ["requested", "countered", "confirmed"] },
    startTime: { $gte: new Date() },
  });

  if (upcoming > 0) {
    throw new AppError(
      `Is ground pe ${upcoming} booking baaki hain. Pehle unhe cancel karo, ya ground ko pause kar do.`,
      HTTP_STATUS.CONFLICT,
    );
  }

  await GroundUnit.deleteMany({ groundId });
  await GroundBlackout.deleteMany({ groundId });
  await Ground.findByIdAndDelete(groundId);

  return { deleted: true };
};

export const getMyGrounds = async (userId: string) => {
  const grounds: any[] = await Ground.find({ userId })
    .sort({ createdAt: -1 })
    .lean();

  if (!grounds.length) return [];

  const ids = grounds.map((g) => g._id);

  /* Unit counts and today's load, in two queries rather than per ground. */

  const units: any[] = await GroundUnit.aggregate([
    { $match: { groundId: { $in: ids }, isActive: true } },
    { $group: { _id: { g: "$groundId", t: "$unitType" }, n: { $sum: 1 } } },
  ]);

  const pending: any[] = await GroundBooking.aggregate([
    { $match: { groundId: { $in: ids }, status: "requested" } },
    { $group: { _id: "$groundId", n: { $sum: 1 } } },
  ]);

  const unitMap = new Map<string, { match: number; net: number }>();

  units.forEach((u) => {
    const key = String(u._id.g);
    const row = unitMap.get(key) || { match: 0, net: 0 };

    if (u._id.t === "net") row.net = u.n;
    else row.match = u.n;

    unitMap.set(key, row);
  });

  const pendingMap = new Map(pending.map((p) => [String(p._id), p.n]));

  return grounds.map((g) => ({
    ...g,
    pitchCount: unitMap.get(String(g._id))?.match ?? 0,
    netCount: unitMap.get(String(g._id))?.net ?? 0,
    pendingRequests: pendingMap.get(String(g._id)) ?? 0,
  }));
};

/*
|--------------------------------------------------------------------------
| Owner - the bookable units
|--------------------------------------------------------------------------
*/

const validateUnit = (payload: any) => {
  if (!payload?.name?.trim()) {
    throw new AppError("Unit ka naam do.", HTTP_STATUS.BAD_REQUEST);
  }

  if (!UNIT_TYPES.includes(payload.unitType)) {
    throw new AppError(
      `Unit type "match" ya "net" hona chahiye.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (payload.unitType === "match") {
    const blocks = payload.matchBlocks || [];

    if (!blocks.length) {
      throw new AppError(
        "Match unit me kam se kam ek time block chahiye.",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    blocks.forEach((b: any) => {
      if (toMinutes(b.end) <= toMinutes(b.start)) {
        throw new AppError(
          `Block "${b.label || b.start}" ka end time start se baad me hona chahiye.`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!(Number(b.weekdayRate) >= 0)) {
        throw new AppError(
          `Block "${b.label || b.start}" ka rate daalo.`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }
    });

    /*
    | Two blocks that overlap would offer the same hour twice at two
    | different prices, and whichever one somebody booked would make the
    | other look mysteriously unavailable.
    */

    const sorted = [...blocks].sort(
      (a: any, b: any) => toMinutes(a.start) - toMinutes(b.start),
    );

    for (let i = 1; i < sorted.length; i += 1) {
      if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
        throw new AppError(
          `Blocks "${sorted[i - 1].label || sorted[i - 1].start}" aur "${
            sorted[i].label || sorted[i].start
          }" aapas me overlap kar rahe hain.`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }
    }
  }

  if (payload.unitType === "net" && !(Number(payload.hourlyRate) > 0)) {
    throw new AppError(
      "Net ka hourly rate daalo.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }
};

export const createUnit = async (
  groundId: string,
  userId: string,
  payload: any,
) => {
  await assertOwner(groundId, userId);

  validateUnit(payload);

  const unit = await GroundUnit.create({
    ...payload,
    groundId,
    ownerId: userId,
  });

  await refreshPublishState(groundId);

  return unit;
};

export const updateUnit = async (
  unitId: string,
  userId: string,
  payload: any,
) => {
  const unit: any = await GroundUnit.findById(unitId);

  if (!unit) {
    throw new AppError("Unit nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  await assertOwner(String(unit.groundId), userId);

  const clean = { ...payload };

  delete clean.groundId;
  delete clean.ownerId;

  validateUnit({ ...unit.toObject(), ...clean });

  Object.assign(unit, clean);

  await unit.save();

  await refreshPublishState(String(unit.groundId));

  return unit;
};

export const deleteUnit = async (unitId: string, userId: string) => {
  const unit: any = await GroundUnit.findById(unitId);

  if (!unit) {
    throw new AppError("Unit nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  await assertOwner(String(unit.groundId), userId);

  const upcoming = await GroundBooking.countDocuments({
    unitId,
    status: { $in: ["requested", "countered", "confirmed"] },
    startTime: { $gte: new Date() },
  });

  /*
  | Deactivated rather than deleted when it has history. Removing the
  | document would orphan every past booking that points at it, and a
  | season of bookings suddenly showing "unit not found" is worse than a
  | row the owner cannot see any more.
  */

  if (upcoming > 0) {
    throw new AppError(
      `Is unit pe ${upcoming} booking baaki hain.`,
      HTTP_STATUS.CONFLICT,
    );
  }

  const hasHistory = await GroundBooking.exists({ unitId });

  if (hasHistory) {
    unit.isActive = false;
    await unit.save();
  } else {
    await GroundUnit.findByIdAndDelete(unitId);
  }

  await refreshPublishState(String(unit.groundId));

  return { deleted: true };
};

export const getUnits = async (groundId: string) =>
  await GroundUnit.find({ groundId, isActive: true }).sort({ unitType: 1, name: 1 });

/*
|--------------------------------------------------------------------------
| Owner - blackouts
|--------------------------------------------------------------------------
*/

export const addBlackout = async (
  groundId: string,
  userId: string,
  payload: any,
) => {
  await assertOwner(groundId, userId);

  if (!payload?.date) {
    throw new AppError("Date do.", HTTP_STATUS.BAD_REQUEST);
  }

  return await GroundBlackout.create({
    groundId,
    ownerId: userId,
    unitId: payload.unitId || null,
    date: startOfLocalDay(payload.date),
    allDay: payload.allDay !== false,
    startTime: payload.startTime || "",
    endTime: payload.endTime || "",
    reason: payload.reason || "",
  });
};

export const removeBlackout = async (blackoutId: string, userId: string) => {
  const b: any = await GroundBlackout.findById(blackoutId);

  if (!b) {
    throw new AppError("Blackout nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(b.ownerId) !== String(userId)) {
    throw new AppError("Ye tumhara nahi hai.", HTTP_STATUS.FORBIDDEN);
  }

  await GroundBlackout.findByIdAndDelete(blackoutId);

  return { deleted: true };
};

/*
|--------------------------------------------------------------------------
| Discovery
|--------------------------------------------------------------------------
|
| One function, two code paths, because a user who grants location and one
| who refuses it are asking genuinely different questions.
|
|   WITH coordinates    $geoNear: distance-filtered, distance-sorted, and
|                       the distance comes back as a field so the card can
|                       print "2.4 km" without a second calculation
|
|   WITHOUT             a plain find on city and area, because "5 km from
|                       where?" has no answer. The app falls back to a city
|                       dropdown rather than demanding the permission - a
|                       user who says no should still be able to use the
|                       feature, just without the distance chips.
|
| $geoNear has to be the FIRST stage of an aggregation - that is a Mongo
| rule, not a preference - so every other filter is applied in its `query`
| option rather than as a later $match. Putting them in a $match afterwards
| would still work but would make Mongo measure distances to grounds it was
| about to throw away.
*/

const buildFilter = (q: any) => {
  const filter: any = { status: "active", isActive: true };

  if (q.city) filter.city = new RegExp(`^${String(q.city).trim()}$`, "i");

  /* Area is a contains-match: "Sector 62" should find "Sector 62A". */
  if (q.area) filter.area = new RegExp(String(q.area).trim(), "i");

  if (q.pitchType) filter.pitchTypes = q.pitchType;

  if (String(q.floodlights) === "true") filter.hasFloodlights = true;

  if (String(q.verified) === "true") filter.isVerified = true;

  /*
  | Every requested facility must be present, not any of them. Somebody
  | filtering for parking AND washroom wants both.
  */
  const facilities = String(q.facilities || "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  if (facilities.length) filter.facilities = { $all: facilities };

  if (q.minRating) filter["rating.overall"] = { $gte: Number(q.minRating) };

  if (q.minPromiseScore) {
    filter.promiseScore = { $gte: Number(q.minPromiseScore) };
  }

  if (q.search) {
    const rx = new RegExp(String(q.search).trim(), "i");

    filter.$or = [{ groundName: rx }, { area: rx }, { city: rx }];
  }

  return filter;
};

export const searchGrounds = async (q: any) => {
  const filter = buildFilter(q);

  const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);

  const lat = Number(q.latitude);
  const lng = Number(q.longitude);

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const radiusKm = Number(q.radiusKm) || 25;

  let grounds: any[] = [];

  if (hasCoords) {
    grounds = await Ground.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "distanceMeters",
          maxDistance: radiusKm * 1000,
          query: filter,
          spherical: true,
        },
      },
      { $limit: 200 },
    ]);

    grounds = grounds.map((g) => ({
      ...g,
      distanceKm: Number((g.distanceMeters / 1000).toFixed(2)),
    }));
  } else {
    grounds = await Ground.find(filter).limit(200).lean();

    grounds = grounds.map((g) => ({ ...g, distanceKm: null }));
  }

  if (!grounds.length) return [];

  /*
  |--------------------------------------------------------------------------
  | Price, attached after the fact
  |--------------------------------------------------------------------------
  |
  | The cheapest rate lives on the units, not on the ground, so it cannot
  | be filtered or sorted inside the query above. Fetching the units for
  | the page of grounds we already have is one extra query; denormalising a
  | "from" price onto the ground would be a second writer for a number that
  | changes whenever any block's rate does, and those drift.
  */

  const ids = grounds.map((g) => g._id);

  const units: any[] = await GroundUnit.find({
    groundId: { $in: ids },
    isActive: true,
  }).lean();

  const priceMap = new Map<string, { match: number | null; net: number | null }>();

  units.forEach((u) => {
    const key = String(u.groundId);
    const row = priceMap.get(key) || { match: null, net: null };

    if (u.unitType === "match") {
      (u.matchBlocks || [])
        .filter((b: any) => b.isActive !== false)
        .forEach((b: any) => {
          const r = Number(b.weekdayRate) || 0;

          if (row.match == null || r < row.match) row.match = r;
        });
    } else {
      const r = Number(u.hourlyRate) || 0;

      if (r > 0 && (row.net == null || r < row.net)) row.net = r;
    }

    priceMap.set(key, row);
  });

  let rows = grounds.map((g) => {
    const p = priceMap.get(String(g._id)) || { match: null, net: null };

    const candidates = [p.match, p.net].filter(
      (n): n is number => typeof n === "number",
    );

    return {
      ...g,
      matchFromPrice: p.match,
      netFromPrice: p.net,
      fromPrice: candidates.length ? Math.min(...candidates) : null,
    };
  });

  /* Price range, applied here because the numbers only exist here. */

  if (q.maxPrice) {
    const max = Number(q.maxPrice);

    rows = rows.filter((r) => r.fromPrice != null && r.fromPrice <= max);
  }

  if (q.minPrice) {
    const min = Number(q.minPrice);

    rows = rows.filter((r) => r.fromPrice != null && r.fromPrice >= min);
  }

  /*
  | Sorting. `distance` is already done by $geoNear, so it is left alone -
  | re-sorting it would only risk undoing Mongo's own ordering.
  |
  | Grounds with no price and grounds with no reviews sort LAST rather
  | than first, in every mode. A brand new ground at the top of "cheapest"
  | because its price is null would be actively misleading.
  */

  const last = (n: any) => (typeof n === "number" && n > 0 ? n : null);

  const sort = String(q.sort || (hasCoords ? "distance" : "rating"));

  if (sort === "price") {
    rows.sort((a, b) => {
      const x = last(a.fromPrice);
      const y = last(b.fromPrice);

      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;

      return x - y;
    });
  } else if (sort === "rating") {
    rows.sort(
      (a, b) =>
        (b.rating?.overall || 0) - (a.rating?.overall || 0) ||
        (b.rating?.count || 0) - (a.rating?.count || 0),
    );
  } else if (sort === "hygiene") {
    rows.sort(
      (a, b) =>
        (b.rating?.hygiene || 0) - (a.rating?.hygiene || 0) ||
        (b.rating?.count || 0) - (a.rating?.count || 0),
    );
  } else if (sort === "reliability") {
    /*
    | Reliability blends two things an owner controls: do they answer, and
    | do they start on time. A ground that never replies is unreliable even
    | if it has never once started late.
    */
    const score = (g: any) => {
      const s = g.stats || {};

      const answered = s.requestsReceived
        ? s.requestsAnswered / s.requestsReceived
        : 0.5;

      const onTime = s.completedBookings
        ? 1 - s.lateStarts / s.completedBookings
        : 0.5;

      return answered * 40 + onTime * 40 + (g.promiseScore || 0) * 0.2;
    };

    rows.sort((a, b) => score(b) - score(a));
  }

  return rows.slice(0, limit);
};

/*
|--------------------------------------------------------------------------
| One ground, in full
|--------------------------------------------------------------------------
*/

export const getGroundById = async (
  groundId: string,
  userId?: string,
  coords?: { latitude?: any; longitude?: any },
) => {
  const ground: any = await Ground.findById(groundId)
    .populate("userId", "fullName phone")
    .lean();

  if (!ground) {
    throw new AppError("Ground nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  const units = await GroundUnit.find({ groundId, isActive: true })
    .sort({ unitType: 1, name: 1 })
    .lean();

  const reviews = await GroundReview.find({ groundId, isHidden: false })
    .populate("userId", "fullName profileImage")
    .populate("teamId", "teamName logo")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const isOwner = String(ground.userId?._id ?? ground.userId) === String(userId);

  const lat = Number(coords?.latitude);
  const lng = Number(coords?.longitude);

  const distanceKm =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    typeof ground.latitude === "number" &&
    typeof ground.longitude === "number"
      ? haversineKm(lat, lng, ground.latitude, ground.longitude)
      : null;

  /*
  | The owner's phone number is released only to somebody who has a
  | confirmed booking - or to the owner themselves. Publishing it on the
  | listing would turn the whole booking flow into a directory: people
  | would call and book off-app, and none of the availability, reliability
  | or review data would ever exist.
  */

  let contactVisible = isOwner;

  if (!contactVisible && userId) {
    contactVisible = !!(await GroundBooking.exists({
      groundId,
      bookedBy: userId,
      status: { $in: ["confirmed", "completed"] },
    }));
  }

  return {
    ...ground,

    units,

    reviews,

    distanceKm,

    isOwner,

    contactPerson: contactVisible ? ground.contactPerson : "",
    contactNumber: contactVisible ? ground.contactNumber : "",
    contactVisible,

    /*
    | The two headline numbers, precomputed so three screens do not each
    | derive them slightly differently.
    */
    responseRate: ground.stats?.requestsReceived
      ? Math.round(
          (ground.stats.requestsAnswered / ground.stats.requestsReceived) * 100,
        )
      : null,

    onTimeRate: ground.stats?.completedBookings
      ? Math.round(
          (1 - ground.stats.lateStarts / ground.stats.completedBookings) * 100,
        )
      : null,
  };
};

/*
|--------------------------------------------------------------------------
| Availability
|--------------------------------------------------------------------------
|
| The heart of the feature: for one ground on one date, which slots can
| actually be booked.
|
| HOW THE BUFFER IS ENFORCED
|
| Each existing booking is treated as occupying its own time PLUS the
| ground's buffer on either side. A candidate slot clashes if it overlaps
| that widened window - which is the same as saying "there must be at
| least `buffer` minutes between any two bookings", but expressed as one
| overlap test rather than two gap tests that can disagree.
|
| The overlap test itself is half-open, so a slot ending at 09:00 does not
| clash with one starting at 09:00. Using a closed test would flag every
| back-to-back pair as a conflict and quietly halve the day's inventory.
|
| WHY EVERY SLOT COMES BACK, NOT JUST THE FREE ONES
|
| A picker that shows only free slots leaves somebody staring at a gap in
| the morning with no idea whether it is booked, closed or never offered.
| Each slot carries its own reason, so the screen can grey it out and say
| why.
*/

export const getAvailability = async (
  groundId: string,
  dateInput: Date | string,
  opts: { unitType?: string } = {},
) => {
  const ground: any = await Ground.findById(groundId).lean();

  if (!ground) {
    throw new AppError("Ground nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  const date = startOfLocalDay(dateInput || new Date());

  const unitQuery: any = { groundId, isActive: true };

  if (opts.unitType) unitQuery.unitType = opts.unitType;

  const units: any[] = await GroundUnit.find(unitQuery)
    .sort({ unitType: 1, name: 1 })
    .lean();

  if (!units.length) return { date, units: [] };

  /*
  | Everything already held on this date, in one query for all units -
  | including the day before and after, because a buffer can reach across
  | midnight on a late slot.
  */

  const held: any[] = await GroundBooking.find({
    groundId,
    status: { $in: ["requested", "countered", "confirmed"] },
    startTime: { $lt: addMinutes(endOfLocalDay(date), 180) },
    endTime: { $gt: addMinutes(date, -180) },
  }).lean();

  const blackouts: any[] = await GroundBlackout.find({
    groundId,
    date,
  }).lean();

  const now = new Date();

  const buildSlot = (
    unit: any,
    start: Date,
    end: Date,
    amount: number,
    block: any = null,
  ) => {
    const buffer =
      unit.unitType === "net"
        ? Number(ground.bufferNetMinutes ?? 5)
        : Number(ground.bufferMatchMinutes ?? 30);

    const clash = held.find(
      (b) =>
        String(b.unitId) === String(unit._id) &&
        overlaps(
          start,
          end,
          addMinutes(new Date(b.startTime), -buffer),
          addMinutes(new Date(b.endTime), buffer),
        ),
    );

    const blackout = blackouts.find((bo) => {
      if (bo.unitId && String(bo.unitId) !== String(unit._id)) return false;

      if (bo.allDay) return true;

      return overlaps(
        start,
        end,
        atTime(date, bo.startTime || "00:00"),
        atTime(date, bo.endTime || "23:59"),
      );
    });

    let status: string = "available";
    let reason = "";

    if (blackout) {
      status = "blocked";
      reason = blackout.reason || "Ground band hai";
    } else if (clash) {
      status = "booked";
      reason = "Already booked";
    } else if (end <= now) {
      status = "past";
      reason = "Nikal chuka";
    }

    return {
      unitId: unit._id,
      unitName: unit.name,
      unitType: unit.unitType,
      blockId: block?._id ?? null,
      label:
        block?.label || toHHMM(start.getHours() * 60 + start.getMinutes()),
      start,
      end,
      startLabel: toHHMM(start.getHours() * 60 + start.getMinutes()),
      endLabel: toHHMM(end.getHours() * 60 + end.getMinutes()),
      durationMinutes: minutesBetween(start, end),
      amount,
      isNight: isNightSlot(start),
      needsFloodlights: !!block?.needsFloodlights,
      status,
      reason,
    };
  };

  const result = units.map((unit) => {
    const hours = hoursForDate(unit, date);

    if (!hours) {
      return {
        unitId: unit._id,
        name: unit.name,
        unitType: unit.unitType,
        closed: true,
        slots: [],
      };
    }

    const openMin = toMinutes(hours.open);
    const closeMin = toMinutes(hours.close);

    let slots: any[] = [];

    if (unit.unitType === "match") {
      slots = (unit.matchBlocks || [])
        .filter((b: any) => b.isActive !== false)
        /* A block outside the day's opening hours is not offered. */
        .filter(
          (b: any) =>
            toMinutes(b.start) >= openMin && toMinutes(b.end) <= closeMin,
        )
        /*
        | An evening block at a ground with no lights is hidden rather
        | than shown and refused - the owner may have copied it from
        | another unit, and there is nothing the player can do about it.
        */
        .filter((b: any) => !b.needsFloodlights || unit.hasFloodlights)
        .sort((a: any, b: any) => toMinutes(a.start) - toMinutes(b.start))
        .map((b: any) =>
          buildSlot(
            unit,
            atTime(date, b.start),
            atTime(date, b.end),
            blockRate(b, date),
            b,
          ),
        );
    } else {
      /* Nets: one slot per hour across the opening window. */
      for (let m = openMin; m + 60 <= closeMin; m += 60) {
        const start = atTime(date, toHHMM(m));
        const end = atTime(date, toHHMM(m + 60));

        slots.push(
          buildSlot(unit, start, end, netAmount(unit, date, start, end)),
        );
      }
    }

    return {
      unitId: unit._id,
      name: unit.name,
      unitType: unit.unitType,
      pitchType: unit.pitchType,
      hasFloodlights: unit.hasFloodlights,
      hourlyRate: unit.unitType === "net" ? netHourlyRate(unit, date) : null,
      minHours: unit.minHours,
      maxHours: unit.maxHours,
      open: hours.open,
      close: hours.close,
      closed: false,
      slots,
    };
  });

  return {
    date,
    bufferMatchMinutes: ground.bufferMatchMinutes,
    bufferNetMinutes: ground.bufferNetMinutes,
    units: result,
  };
};

/*
|--------------------------------------------------------------------------
| The owner's calendar
|--------------------------------------------------------------------------
|
| A month at a glance: how many slots each day holds and how many are
| taken, so the owner can see a quiet week without opening seven screens.
*/

export const getOwnerCalendar = async (
  groundId: string,
  userId: string,
  from: Date | string,
  to: Date | string,
) => {
  await assertOwner(groundId, userId);

  const start = startOfLocalDay(from);
  const end = endOfLocalDay(to);

  const bookings: any[] = await GroundBooking.find({
    groundId,
    startTime: { $gte: start, $lte: end },
    status: { $in: ["requested", "countered", "confirmed", "completed"] },
  })
    .select("date status startTime endTime totalAmount amount")
    .lean();

  const blackouts: any[] = await GroundBlackout.find({
    groundId,
    date: { $gte: start, $lte: end },
  }).lean();

  const byDay = new Map<string, any>();

  const key = (d: Date | string) =>
    startOfLocalDay(d).toISOString().slice(0, 10);

  bookings.forEach((b) => {
    const k = key(b.startTime);

    const row = byDay.get(k) || {
      date: k,
      confirmed: 0,
      pending: 0,
      completed: 0,
      revenue: 0,
      blocked: false,
    };

    if (b.status === "confirmed") row.confirmed += 1;
    if (b.status === "requested" || b.status === "countered") row.pending += 1;
    if (b.status === "completed") {
      row.completed += 1;
      row.revenue += Number(b.totalAmount || b.amount || 0);
    }

    byDay.set(k, row);
  });

  blackouts.forEach((bo) => {
    const k = key(bo.date);

    const row = byDay.get(k) || {
      date: k,
      confirmed: 0,
      pending: 0,
      completed: 0,
      revenue: 0,
      blocked: false,
    };

    row.blocked = true;

    byDay.set(k, row);
  });

  return {
    from: start,
    to: end,
    days: Array.from(byDay.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    blackouts,
  };
};

/*
| Kept so anything still importing the old name resolves. The old
| signature took no user and returned every ground in the database; this
| one is the discovery search with no filters.
*/

export const getAllGrounds = async () => await searchGrounds({});

export const getGrounds = async (userId: string) => await getMyGrounds(userId);

export { assertOwner };
