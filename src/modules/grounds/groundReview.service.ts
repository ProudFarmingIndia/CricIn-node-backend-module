import mongoose from "mongoose";

import Ground from "./ground.model";
import GroundBooking from "./groundBooking.model";
import GroundReview from "./groundReview.model";

import User from "../users/user.model";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

import {
  FACILITY_KEYS,
  GROUND_FACILITIES,
  type FacilityKey,
} from "./ground.constants";

import {
  notify,
  sendReviewReceived,
  sendReviewReply,
} from "./ground.notifications";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| groundReview.service.ts
|
| Description:
| Ratings, and the one number that is worth more than all of them.
|
| WHY A REVIEW NEEDS A COMPLETED BOOKING
|
| `bookingId` is required and unique on the model, so the database itself
| refuses a second review for one session and refuses any review with no
| session behind it. This service adds the two checks a unique index
| cannot: the booking must belong to this user, and it must actually have
| been played.
|
| Between them that is the whole of review moderation. A rival owner cannot
| leave ten one-stars because he has no bookings. A ground cannot farm
| five-stars from friends because a friend with no booking cannot post. No
| admin has to read anything.
|
| THE PROMISE SCORE
|
| Five star ratings tell a captain very little - everybody averages 4.1 and
| the differences are noise. "Did this ground deliver what it said it
| would" is a different kind of question: it is specific, it is checkable,
| and a ground that fails it fails it consistently.
|
| The owner ticks what they commit to. After the game the players are asked
| about those items only - not "rate the facilities" but "they said there
| would be floodlights; were there". The percentage of promises kept,
| across every review, is `promiseScore`, and it is the number the
| discovery screen's most useful filter reads.
|
| WHY THE PROMISE LIST IS COPIED ONTO EACH REVIEW
|
| Because otherwise an owner could quietly drop "floodlights" from their
| promises next month and every past failure would become a pass. The
| review records what was promised ON THE DAY, so it keeps meaning what it
| meant.
|
| WHY THE AGGREGATES ARE STORED AND NOT COUNTED ON READ
|
| Discovery sorts by rating, by hygiene and by promise score. A sort cannot
| run on a number that has to be computed from another collection first, so
| all of them live on the Ground document - written by exactly one function
| here, recalculate, so there is no second writer to disagree with.
|
|--------------------------------------------------------------------------
*/

const FACILITY_LABEL = new Map(
  GROUND_FACILITIES.map((f) => [f.key as string, f.label as string]),
);

/*
|--------------------------------------------------------------------------
| The one writer of every rating number on a Ground
|--------------------------------------------------------------------------
|
| Recomputed from scratch rather than adjusted incrementally. An
| incremental update is faster and is wrong the first time anything is
| hidden, edited or deleted - and it drifts silently, which is the worst
| way for a number to be wrong.
|
| A ground's whole review history is at most a few hundred documents, so
| the full recount costs one indexed query and is simply correct.
|
| NOTE ON THE AVERAGES: the optional scores average only the reviews that
| ANSWERED them. Treating a skipped "hygiene" as a zero would drag a clean
| ground down for the sin of somebody being in a hurry.
*/

export const recalculate = async (groundId: string) => {
  const reviews: any[] = await GroundReview.find({
    groundId,
    isHidden: false,
  })
    .select("overall pitch hygiene facilities valueForMoney promisesChecked promisesKept")
    .lean();

  if (!reviews.length) {
    await Ground.updateOne(
      { _id: groundId },
      {
        $set: {
          "rating.overall": 0,
          "rating.pitch": 0,
          "rating.hygiene": 0,
          "rating.facilities": 0,
          "rating.valueForMoney": 0,
          "rating.count": 0,
          promiseScore: 0,
        },
      },
    );

    return null;
  }

  const avg = (key: string): number => {
    const vals = reviews
      .map((r) => r[key])
      .filter((v) => typeof v === "number" && v > 0);

    if (!vals.length) return 0;

    return Number(
      (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2),
    );
  };

  /*
  | Promise score, counted over ITEMS rather than reviews. A ground that
  | promised six things and delivered five is at 83%, and one that promised
  | one thing and delivered it is at 100% - which is honest, because it
  | promised less.
  |
  | Reviews that were asked about nothing (the ground promised nothing) are
  | excluded entirely rather than counted as perfect. A ground that commits
  | to nothing has not earned a 100%, it has simply not been measured, and
  | the discovery screen shows the count alongside so that is visible.
  */

  let promised = 0;
  let kept = 0;

  for (const r of reviews) {
    const checked = (r.promisesChecked || []).length;

    if (!checked) continue;

    promised += checked;

    kept += (r.promisesKept || []).filter((k: string) =>
      (r.promisesChecked || []).includes(k),
    ).length;
  }

  const promiseScore = promised
    ? Math.round((kept / promised) * 100)
    : 0;

  await Ground.updateOne(
    { _id: groundId },
    {
      $set: {
        "rating.overall": avg("overall"),
        "rating.pitch": avg("pitch"),
        "rating.hygiene": avg("hygiene"),
        "rating.facilities": avg("facilities"),
        "rating.valueForMoney": avg("valueForMoney"),
        "rating.count": reviews.length,
        promiseScore,
      },
    },
  );

  return { count: reviews.length, promiseScore };
};

/*
|--------------------------------------------------------------------------
| What the review form should ask
|--------------------------------------------------------------------------
|
| Called when the player opens the rating screen. The promise questions are
| not a fixed list - they are whatever THIS ground committed to, so a
| ground that promised nothing is not asked five pointless questions and a
| ground that promised six is asked about all six.
*/

export const getReviewForm = async (bookingId: string, userId: string) => {
  const booking: any = await GroundBooking.findById(bookingId).lean();

  if (!booking) {
    throw new AppError("Booking nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(booking.bookedBy) !== String(userId)) {
    throw new AppError(
      "Ye booking aapki nahi hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const ground: any = await Ground.findById(booking.groundId)
    .select("groundName area city image photos promises")
    .lean();

  if (!ground) {
    throw new AppError("Ground nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  const existing: any = await GroundReview.findOne({ bookingId }).lean();

  return {
    booking: {
      _id: booking._id,
      startTime: booking.startTime,
      endTime: booking.endTime,
      purpose: booking.purpose,
      status: booking.status,
    },

    ground: {
      _id: ground._id,
      groundName: ground.groundName,
      area: ground.area,
      city: ground.city,
      image: ground.image || ground.photos?.[0] || "",
    },

    /* Only what this ground actually promised, with readable labels. */
    promiseQuestions: (ground.promises || []).map((key: string) => ({
      key,
      label: FACILITY_LABEL.get(key) || key,
    })),

    canReview: booking.status === "completed" && !existing,

    alreadyReviewed: !!existing,

    review: existing || null,

    reason:
      booking.status !== "completed"
        ? "Session complete hone ke baad rating de sakte hain."
        : existing
          ? "Is booking ki rating already de di gayi hai."
          : "",
  };
};

/*
|--------------------------------------------------------------------------
| Leave a review
|--------------------------------------------------------------------------
*/

export const createReview = async (userId: string, payload: any) => {
  const { bookingId, overall, pitch, hygiene, facilities, valueForMoney } =
    payload || {};

  if (!bookingId) {
    throw new AppError("Booking id chahiye.", HTTP_STATUS.BAD_REQUEST);
  }

  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new AppError("Booking id galat hai.", HTTP_STATUS.BAD_REQUEST);
  }

  const score = Number(overall);

  if (!Number.isFinite(score) || score < 1 || score > 5) {
    throw new AppError(
      "Overall rating 1 se 5 ke beech honi chahiye.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const booking: any = await GroundBooking.findById(bookingId);

  if (!booking) {
    throw new AppError("Booking nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(booking.bookedBy) !== String(userId)) {
    throw new AppError(
      "Sirf booking karne wala rating de sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  /*
  | Played, not merely booked. `completed` means somebody checked in and
  | checked out, so the person writing this was actually there.
  */

  if (booking.status !== "completed") {
    throw new AppError(
      "Session complete hone ke baad hi rating de sakte hain.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (booking.isReviewed) {
    throw new AppError(
      "Is booking ki rating already di ja chuki hai.",
      HTTP_STATUS.CONFLICT,
    );
  }

  const ground: any = await Ground.findById(booking.groundId)
    .select("groundName promises userId")
    .lean();

  if (!ground) {
    throw new AppError("Ground nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  /*
  | The promise list is taken from the GROUND, not from the request. A
  | client that sent its own `promisesChecked` could shorten it to whatever
  | it was willing to be measured on.
  */

  /*
  | Typed as FacilityKey[], not string[], and narrowed with a type predicate
  | rather than a cast.
  |
  | Mongoose 9 holds a create() to the field's declared enum, so a plain
  | string[] is refused here - correctly, because `ground.promises` came out
  | of a lean() as untyped data and could contain anything. The predicate is
  | doing real work: it is the point where unvalidated input becomes a known
  | key, and it is the same check the schema would otherwise fail on at save
  | time with a far worse message.
  */

  const promisesChecked: FacilityKey[] = (ground.promises || []).filter(
    (k: string): k is FacilityKey => (FACILITY_KEYS as string[]).includes(k),
  );

  /* And the kept list is narrowed to that, so nothing outside it counts. */

  const promisesKept: FacilityKey[] = Array.isArray(payload?.promisesKept)
    ? payload.promisesKept.filter((k: string): k is FacilityKey =>
        (promisesChecked as string[]).includes(k),
      )
    : [];

  const clamp = (v: any): number | null => {
    const n = Number(v);

    if (!Number.isFinite(n) || n < 1 || n > 5) return null;

    return Math.round(n);
  };

  let review: any;

  try {
    review = await GroundReview.create({
      groundId: booking.groundId,

      bookingId: booking._id,

      userId,

      teamId: booking.teamId || null,

      overall: Math.round(score),

      pitch: clamp(pitch),

      hygiene: clamp(hygiene),

      facilities: clamp(facilities),

      valueForMoney: clamp(valueForMoney),

      promisesChecked,

      promisesKept,

      comment: String(payload?.comment || "").slice(0, 600),

      photos: Array.isArray(payload?.photos)
        ? payload.photos.slice(0, 6)
        : [],
    });
  } catch (error: any) {
    /*
    | The unique index on bookingId doing its job - two taps on a slow
    | connection. Reported as the plain fact rather than a 500.
    */
    if (error?.code === 11000) {
      throw new AppError(
        "Is booking ki rating already di ja chuki hai.",
        HTTP_STATUS.CONFLICT,
      );
    }

    throw error;
  }

  booking.isReviewed = true;

  await booking.save();

  await recalculate(String(booking.groundId));

  const reviewer: any = await User.findById(userId).select("fullName").lean();

  await notify(() =>
    sendReviewReceived({
      ownerId: String(ground.userId),
      actorId: String(userId),
      review,
      groundId: String(booking.groundId),
      groundName: ground.groundName,
      reviewerName: reviewer?.fullName || "A player",
    }),
  );

  return review.toObject();
};

/*
|--------------------------------------------------------------------------
| A ground's reviews
|--------------------------------------------------------------------------
|
| The distribution goes out with them, because "4.2 from 30" and "4.2 from
| 30 where eight people gave 1" are different grounds and the average hides
| the second one.
*/

export const getGroundReviews = async (groundId: string, q: any = {}) => {
  const page = Math.max(1, Number(q.page) || 1);

  const limit = Math.min(50, Number(q.limit) || 20);

  const filter: any = { groundId, isHidden: false };

  /* "Show me the complaints" - the most-used filter on any review list. */

  if (q.minStars) filter.overall = { $gte: Number(q.minStars) };

  if (q.maxStars) {
    filter.overall = { ...(filter.overall || {}), $lte: Number(q.maxStars) };
  }

  if (q.withPhotos === "true") filter["photos.0"] = { $exists: true };

  const [reviews, total, buckets] = await Promise.all([
    GroundReview.find(filter)
      .populate([
        { path: "userId", select: "fullName profileImage" },
        { path: "teamId", select: "teamName logo" },
      ] as any)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    GroundReview.countDocuments(filter),

    GroundReview.aggregate([
      {
        $match: {
          groundId: new mongoose.Types.ObjectId(String(groundId)),
          isHidden: false,
        },
      },
      { $group: { _id: "$overall", count: { $sum: 1 } } },
    ]),
  ]);

  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: buckets.find((b: any) => b._id === stars)?.count || 0,
  }));

  /*
  | Per-promise breakdown: not "83% of promises kept" but WHICH one is
  | being missed. That is the difference between a number a player
  | distrusts and one they can act on.
  */

  const promiseRows: any[] = await GroundReview.aggregate([
    {
      $match: {
        groundId: new mongoose.Types.ObjectId(String(groundId)),
        isHidden: false,
        "promisesChecked.0": { $exists: true },
      },
    },
    { $unwind: "$promisesChecked" },
    {
      $group: {
        _id: "$promisesChecked",
        asked: { $sum: 1 },
        kept: {
          $sum: {
            $cond: [{ $in: ["$promisesChecked", "$promisesKept"] }, 1, 0],
          },
        },
      },
    },
    { $sort: { asked: -1 } },
  ]);

  return {
    page,

    limit,

    total,

    hasMore: page * limit < total,

    distribution,

    promiseBreakdown: promiseRows.map((r) => ({
      key: r._id,
      label: FACILITY_LABEL.get(r._id) || r._id,
      asked: r.asked,
      kept: r.kept,
      percent: r.asked ? Math.round((r.kept / r.asked) * 100) : 0,
    })),

    reviews,
  };
};

/*
|--------------------------------------------------------------------------
| The owner's one reply
|--------------------------------------------------------------------------
|
| One, not a thread. A ground and a customer arguing in public under a
| review helps nobody, and one reply is enough to say "sorry, the lights
| were being repaired that week".
|
| It can be edited - an owner who typed it angrily at 11 PM should be able
| to fix it - but it stays one reply.
*/

export const replyToReview = async (
  reviewId: string,
  userId: string,
  text: string,
) => {
  const review: any = await GroundReview.findById(reviewId);

  if (!review) {
    throw new AppError("Review nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  const ground: any = await Ground.findById(review.groundId)
    .select("userId groundName")
    .lean();

  if (!ground || String(ground.userId) !== String(userId)) {
    throw new AppError(
      "Sirf ground owner reply kar sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const body = String(text || "").trim().slice(0, 400);

  if (!body) {
    throw new AppError("Reply khaali nahi ho sakta.", HTTP_STATUS.BAD_REQUEST);
  }

  const isFirst = !review.ownerReply;

  review.ownerReply = body;
  review.ownerRepliedAt = new Date();

  await review.save();

  /* Notified once, on the first reply. An edit is not news. */

  if (isFirst) {
    await notify(() =>
      sendReviewReply({
        playerId: String(review.userId),
        actorId: String(userId),
        review,
        groundId: String(review.groundId),
        groundName: ground.groundName,
      }),
    );
  }

  return review.toObject();
};

/*
|--------------------------------------------------------------------------
| The player's own reviews
|--------------------------------------------------------------------------
*/

export const getMyReviews = async (userId: string) =>
  await GroundReview.find({ userId })
    .populate([
      { path: "groundId", select: "groundName area city image photos" },
    ] as any)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

/*
| A reviewer can fix their own words and their own stars, and only for a
| while. Two days is long enough to correct a mistake and short enough that
| a ground cannot talk somebody into rewriting history next month.
|
| The promise answers are NOT editable - those are a record of what was
| there on the day, and that does not change.
*/

const EDIT_WINDOW_HOURS = 48;

export const updateMyReview = async (
  reviewId: string,
  userId: string,
  payload: any,
) => {
  const review: any = await GroundReview.findById(reviewId);

  if (!review) {
    throw new AppError("Review nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  if (String(review.userId) !== String(userId)) {
    throw new AppError("Ye review aapka nahi hai.", HTTP_STATUS.FORBIDDEN);
  }

  const ageHours =
    (Date.now() - new Date(review.createdAt).getTime()) / 3600000;

  if (ageHours > EDIT_WINDOW_HOURS) {
    throw new AppError(
      `Review ${EDIT_WINDOW_HOURS} ghante ke andar hi edit ho sakta hai.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const clamp = (v: any): number | null => {
    const n = Number(v);

    if (!Number.isFinite(n) || n < 1 || n > 5) return null;

    return Math.round(n);
  };

  const nextOverall = clamp(payload?.overall);

  if (nextOverall) review.overall = nextOverall;

  for (const key of ["pitch", "hygiene", "facilities", "valueForMoney"]) {
    if (payload?.[key] !== undefined) review[key] = clamp(payload[key]);
  }

  if (payload?.comment !== undefined) {
    review.comment = String(payload.comment).slice(0, 600);
  }

  await review.save();

  await recalculate(String(review.groundId));

  return review.toObject();
};

/*
|--------------------------------------------------------------------------
| Hide a review
|--------------------------------------------------------------------------
|
| Admin only - deliberately NOT the owner. A ground that can hide its own
| bad reviews has a review system that means nothing, and the whole point
| of tying reviews to bookings was to avoid needing this at all.
|
| It exists for the narrow real case: abuse, a personal attack, somebody's
| phone number in a comment.
|
| Hidden rather than deleted, so the record of what was said survives even
| when it stops being shown.
*/

export const setReviewHidden = async (
  reviewId: string,
  hidden: boolean,
) => {
  const review: any = await GroundReview.findByIdAndUpdate(
    reviewId,
    { $set: { isHidden: !!hidden } },
    { new: true },
  );

  if (!review) {
    throw new AppError("Review nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  await recalculate(String(review.groundId));

  return review.toObject();
};
