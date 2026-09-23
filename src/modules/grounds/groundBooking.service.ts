import mongoose from "mongoose";

import Ground from "./ground.model";
import GroundUnit from "./groundUnit.model";
import GroundBooking from "./groundBooking.model";
import GroundBlackout from "./groundBlackout.model";

import Match from "../matches/match.model";
import Team from "../teams/team.model";
import Player from "../players/player.model";
import User from "../users/user.model";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

import { GROUND_DEFAULTS } from "./ground.constants";

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
  hoursForDate,
  overtimeAmount,
} from "./ground.helpers";

import {
  notify,
  sendBookingRequested,
  sendBookingApproved,
  sendBookingRejected,
  sendBookingCountered,
  sendCounterAccepted,
  sendCounterDeclined,
  sendBookingCancelled,
  sendBookingExpired,
  sendBookingReminder,
  sendCheckedIn,
  sendDelayCompensation,
  sendSessionCompleted,
  sendReviewRequest,
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
| groundBooking.service.ts
|
| Description:
| The whole life of a booking - asked for, agreed, played, settled.
|
| THE SHAPE OF IT
|
|   request     player picks a slot and says how far they can move
|   counter     owner offers a different time inside that flexibility
|   confirm     one side agrees and the slot is held
|   check in    owner marks arrival; the delay and its cause are computed
|   check out   player marks the end; overtime and the total are computed
|   review      see groundReview.service
|
| Every one of those is a separate function below and every one of them
| re-reads the booking from the database first. Nothing trusts a status
| that arrived from the app.
|
| THE ONE RULE THAT MATTERS
|
| A slot is either free or it is not, and exactly one function decides:
| assertSlotFree. The availability screen, the request, and the owner
| accepting a request all call it. If two places decided this, the day they
| disagreed a ground would have two sides on one pitch, and there is no
| recovering from that with an apology.
|
| It is still not a database-level guarantee - two requests landing in the
| same millisecond can both pass. That is deliberately left: MongoDB cannot
| express "no overlapping ranges" as a unique index, and the alternative is
| a transaction on every read. The real protection is that the owner
| confirms, and the confirm path checks again - so the worst case is one
| request getting refused at confirmation, with a clear reason, rather than
| two teams turning up.
|
| WHY NOTHING HERE MOVES MONEY
|
| Covered at length in groundBooking.model.ts. Short version: the amounts
| are computed and frozen, the player pays cash at the ground, and the
| reputation numbers do the work a penalty would have done badly.
|
|--------------------------------------------------------------------------
*/

/*
| `as const` is load-bearing, not decoration.
|
| Without it TypeScript infers string[], and Mongoose 9 refuses a string[]
| inside `$in` against a field declared with an enum - the schema's own
| literal union is narrower, and the query builder holds you to it. The
| error it produces names nine overloads and buries the cause, so: keep the
| `as const`.
|
| `.includes()` on it still accepts the statuses read off a booking, because
| those come back as `any` from an untyped document.
*/

const ACTIVE_STATUSES = ["requested", "countered", "confirmed"] as const;

/*
|--------------------------------------------------------------------------
| Loading a booking, with the right to see it
|--------------------------------------------------------------------------
|
| Every entry point needs the same three things: the booking, its ground,
| and whether this user is allowed anywhere near it. Doing it once means no
| endpoint can forget the third.
*/

const loadBooking = async (
  bookingId: string,
  userId: string,
  opts: { as?: "owner" | "player" | "either" } = {},
) => {
  const as = opts.as || "either";

  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new AppError("Booking id galat hai.", HTTP_STATUS.BAD_REQUEST);
  }

  const booking: any = await GroundBooking.findById(bookingId);

  if (!booking) {
    throw new AppError("Booking nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  const isOwner = String(booking.ownerId) === String(userId);
  const isPlayer = String(booking.bookedBy) === String(userId);

  if (!isOwner && !isPlayer) {
    throw new AppError(
      "Ye booking aapki nahi hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  if (as === "owner" && !isOwner) {
    throw new AppError(
      "Sirf ground owner ye kar sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  if (as === "player" && !isPlayer) {
    throw new AppError(
      "Sirf booking karne wala ye kar sakta hai.",
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const ground: any = await Ground.findById(booking.groundId).lean();

  if (!ground) {
    throw new AppError("Ground nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  return { booking, ground, isOwner, isPlayer };
};

const bufferFor = (ground: any, unitType: string): number =>
  unitType === "net"
    ? Number(ground?.bufferNetMinutes ?? GROUND_DEFAULTS.bufferNetMinutes)
    : Number(ground?.bufferMatchMinutes ?? GROUND_DEFAULTS.bufferMatchMinutes);

/*
|--------------------------------------------------------------------------
| Is this slot actually free?
|--------------------------------------------------------------------------
|
| THE BUFFER IS APPLIED BY WIDENING, NOT BY MEASURING GAPS
|
| The obvious implementation is: find the booking before, find the booking
| after, check both gaps. That is two calculations that can disagree, and
| it quietly misses the case where a slot sits inside another booking's
| buffer on both sides.
|
| Instead every existing booking is treated as occupying its own time PLUS
| the buffer at each end, and the question becomes a single overlap test.
| One expression, no edge cases, and adding a third booking to the day
| changes nothing about how it is asked.
|
| `ignoreBookingId` exists for the re-check when a counter-offer is
| accepted: the booking being moved must not block itself.
*/

const assertSlotFree = async ({
  ground,
  unit,
  start,
  end,
  ignoreBookingId,
}: {
  ground: any;
  unit: any;
  start: Date;
  end: Date;
  ignoreBookingId?: string;
}) => {
  if (end <= start) {
    throw new AppError(
      "End time start se aage hona chahiye.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (start <= new Date()) {
    throw new AppError(
      "Pichla time book nahi ho sakta.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /*
  | Inside opening hours for THAT weekday. A ground shut on Monday has no
  | slots on Monday, however the request was constructed.
  */

  const hours = hoursForDate(unit, start);

  if (!hours) {
    throw new AppError(
      "Us din ye unit band rehti hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const startMin = start.getHours() * 60 + start.getMinutes();

  const endMin = end.getHours() * 60 + end.getMinutes();

  if (startMin < toMinutes(hours.open) || endMin > toMinutes(hours.close)) {
    throw new AppError(
      `Ye unit ${hours.open} se ${hours.close} tak hi khulti hai.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /* An evening slot at a unit with no lights is refused outright. */

  if (!unit.hasFloodlights && endMin > 19 * 60) {
    throw new AppError(
      "Is unit par floodlights nahi hain, itni late slot possible nahi.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const date = startOfLocalDay(start);

  const blackout: any = await GroundBlackout.findOne({
    groundId: ground._id,
    date,
    $or: [{ unitId: null }, { unitId: unit._id }],
  }).lean();

  if (blackout) {
    const blocked =
      blackout.allDay ||
      overlaps(
        start,
        end,
        atTime(date, blackout.startTime || "00:00"),
        atTime(date, blackout.endTime || "23:59"),
      );

    if (blocked) {
      throw new AppError(
        blackout.reason
          ? `Ground band hai: ${blackout.reason}`
          : "Us time ground band hai.",
        HTTP_STATUS.CONFLICT,
      );
    }
  }

  const buffer = bufferFor(ground, unit.unitType);

  /*
  | The window is widened by the buffer on BOTH sides of the query as well,
  | so a booking whose buffer reaches into this slot is fetched even though
  | its own times do not overlap.
  */

  const candidates: any[] = await GroundBooking.find({
    unitId: unit._id,
    status: { $in: ACTIVE_STATUSES },
    startTime: { $lt: addMinutes(end, buffer) },
    endTime: { $gt: addMinutes(start, -buffer) },
    ...(ignoreBookingId
      ? { _id: { $ne: new mongoose.Types.ObjectId(ignoreBookingId) } }
      : {}),
  })
    .select("startTime endTime status")
    .lean();

  const clash = candidates.find((b) =>
    overlaps(
      start,
      end,
      addMinutes(new Date(b.startTime), -buffer),
      addMinutes(new Date(b.endTime), buffer),
    ),
  );

  if (clash) {
    /*
    | The message distinguishes a booking from its buffer, because "6 to 9
    | is taken" when the player can plainly see 6 to 9 is free reads like a
    | bug. Telling them a gap is needed is a fact they can act on.
    */
    const directClash = overlaps(
      start,
      end,
      new Date(clash.startTime),
      new Date(clash.endTime),
    );

    throw new AppError(
      directClash
        ? "Ye slot already booked hai."
        : `Booking ke beech ${buffer} min ka gap chahiye - ye slot us gap me aa raha hai.`,
      HTTP_STATUS.CONFLICT,
    );
  }
};

/*
|--------------------------------------------------------------------------
| What the slot costs
|--------------------------------------------------------------------------
|
| Match: whatever the block says for that day of the week.
| Net: by the hour, rounded up to the half hour.
|
| Computed HERE and written onto the booking, never recomputed on read. A
| rate the owner changes next month must not rewrite what somebody agreed
| to pay today.
*/

const priceFor = ({
  unit,
  start,
  end,
  blockId,
}: {
  unit: any;
  start: Date;
  end: Date;
  blockId?: string | null;
}): { amount: number; block: any } => {
  if (unit.unitType === "net") {
    const mins = minutesBetween(start, end);

    const hrs = mins / 60;

    if (unit.minHours && hrs < Number(unit.minHours)) {
      throw new AppError(
        `Minimum ${unit.minHours} ghante ki booking hai.`,
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    if (unit.maxHours && hrs > Number(unit.maxHours)) {
      throw new AppError(
        `Maximum ${unit.maxHours} ghante ki booking hai.`,
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    return { amount: netAmount(unit, start, start, end), block: null };
  }

  /*
  | A match slot must BE one of the owner's blocks, not merely fit inside
  | one. Letting a player carve 7-8 out of a 6-9 block would sell the
  | owner's three-hour session for an hour's money and leave the rest
  | unsellable.
  */

  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();

  const block = (unit.matchBlocks || []).find((b: any) => {
    if (blockId) return String(b._id) === String(blockId);

    return toMinutes(b.start) === startMin && toMinutes(b.end) === endMin;
  });

  if (!block) {
    throw new AppError(
      "Ye slot ground ke blocks me nahi hai. Available slots me se chuniye.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (block.isActive === false) {
    throw new AppError("Ye slot band hai.", HTTP_STATUS.BAD_REQUEST);
  }

  if (block.needsFloodlights && !unit.hasFloodlights) {
    throw new AppError(
      "Is slot ke liye floodlights chahiye jo is unit par nahi hain.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /* Timings come from the block, not from the request. */

  return { amount: blockRate(block, start), block };
};

/*
|--------------------------------------------------------------------------
| Attaching a match
|--------------------------------------------------------------------------
|
| Three things the player can do with a slot, and all three are legitimate:
|
|   attach an existing match   matchId is sent
|   create a new match         createMatch is sent with the basics
|   neither                    a net session or a knock-about
|
| The third is why matchId is optional. Forcing a match into existence to
| satisfy a foreign key would fill the matches list with fixtures that were
| never played.
|
| When a match IS attached, its own groundId and venue are written too, so
| the match screen and the owner's booking card agree without anybody
| syncing them.
*/

const resolveMatch = async ({
  userId,
  matchId,
  createMatch,
  booking,
  ground,
}: {
  userId: string;
  matchId?: string | null;
  createMatch?: any;
  booking: { startTime: Date; endTime: Date; teamId?: any };
  ground: any;
}): Promise<string | null> => {
  if (matchId) {
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      throw new AppError("Match id galat hai.", HTTP_STATUS.BAD_REQUEST);
    }

    const match: any = await Match.findById(matchId);

    if (!match) {
      throw new AppError("Match nahi mila.", HTTP_STATUS.NOT_FOUND);
    }

    /*
    | Only somebody who runs the match may attach it. Without this check a
    | stranger could bolt their own booking onto anybody's fixture and the
    | ground owner would see two teams who never agreed to play there.
    */

    const runsIt = await userRunsMatch(match, userId);

    if (!runsIt) {
      throw new AppError(
        "Ye match aapka nahi hai.",
        HTTP_STATUS.FORBIDDEN,
      );
    }

    if (["completed", "cancelled"].includes(String(match.status))) {
      throw new AppError(
        "Khatam ya cancel match ko ground se nahi jod sakte.",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    match.groundId = ground._id;
    match.venueName = ground.groundName;
    match.startTime = booking.startTime;

    await match.save();

    return String(match._id);
  }

  if (!createMatch) return null;

  /*
  | A match created from a booking starts as a draft: the player has
  | committed to a ground and a time, not yet to an opponent or a squad.
  | Creating it as `upcoming` would put a half-built fixture on both teams'
  | schedules.
  */

  const created: any = await Match.create({
    userId,

    matchTitle: createMatch.matchTitle || `Match at ${ground.groundName}`,

    matchType: createMatch.matchType || "T20",

    ballType: createMatch.ballType || "Leather",

    overs: Number(createMatch.overs) || 20,

    teamA: createMatch.teamA || booking.teamId || null,

    teamB: createMatch.teamB || null,

    groundId: ground._id,

    venueName: ground.groundName,

    startTime: booking.startTime,

    status: "draft",
  });

  return String(created._id);
};

/*
| Captain, vice-captain or the match's creator. Resolved through Player
| because Team.captainId is a PLAYER id, and comparing it to a user id is
| always false - a mistake this codebase has already paid for once.
*/

const userRunsMatch = async (match: any, userId: string): Promise<boolean> => {
  if (String(match.userId) === String(userId)) return true;

  if (String(match.scorerUserId || "") === String(userId)) return true;

  const teamIds = [match.teamA, match.teamB].filter(Boolean);

  if (!teamIds.length) return false;

  const player: any = await Player.findOne({ userId }).select("_id").lean();

  const teams: any[] = await Team.find({ _id: { $in: teamIds } })
    .select("captainId viceCaptainId userId")
    .lean();

  return teams.some(
    (t) =>
      String(t.userId || "") === String(userId) ||
      (player &&
        (String(t.captainId || "") === String(player._id) ||
          String(t.viceCaptainId || "") === String(player._id))),
  );
};

/*
|--------------------------------------------------------------------------
| Request a slot
|--------------------------------------------------------------------------
|
| Ends as `confirmed` when the ground has instant booking on, and
| `requested` otherwise. The player sees which one it was in the response,
| so the app does not have to guess what screen to show next.
*/

export const requestBooking = async (userId: string, payload: any) => {
  const {
    groundId,
    unitId,
    date,
    startTime,
    endTime,
    blockId,
    purpose,
    teamId,
    matchId,
    createMatch,
    flexibilityMinutes,
    note,
  } = payload || {};

  if (!groundId || !unitId || !startTime || !endTime) {
    throw new AppError(
      "Ground, unit aur time zaroori hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const ground: any = await Ground.findById(groundId).lean();

  if (!ground) {
    throw new AppError("Ground nahi mila.", HTTP_STATUS.NOT_FOUND);
  }

  if (ground.status !== "active") {
    throw new AppError(
      "Ye ground abhi booking ke liye available nahi hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /*
  | An owner booking their own ground would sit in their own approval
  | queue and skew their own response rate. If they want to hold time,
  | that is what a blackout is for.
  */

  if (String(ground.userId) === String(userId)) {
    throw new AppError(
      "Apna hi ground book nahi kar sakte - time block karne ke liye blackout use kijiye.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const unit: any = await GroundUnit.findOne({
    _id: unitId,
    groundId,
    isActive: true,
  }).lean();

  if (!unit) {
    throw new AppError("Ye unit available nahi hai.", HTTP_STATUS.NOT_FOUND);
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError("Time galat hai.", HTTP_STATUS.BAD_REQUEST);
  }

  const { amount, block } = priceFor({ unit, start, end, blockId });

  await assertSlotFree({ ground, unit, start, end });

  /*
  | Only a team the user actually belongs to. Otherwise anybody could
  | book "for" any team, and the owner's screen would show a fixture
  | neither side knows about.
  */

  let resolvedTeamId: any = null;

  if (teamId) {
    const player: any = await Player.findOne({ userId }).select("_id").lean();

    const team: any = await Team.findById(teamId)
      .select("captainId viceCaptainId userId players")
      .lean();

    if (!team) {
      throw new AppError("Team nahi mili.", HTTP_STATUS.NOT_FOUND);
    }

    const belongs =
      String(team.userId || "") === String(userId) ||
      (player &&
        (String(team.captainId || "") === String(player._id) ||
          String(team.viceCaptainId || "") === String(player._id) ||
          (team.players || []).some(
            (p: any) => String(p) === String(player._id),
          )));

    if (!belongs) {
      throw new AppError(
        "Aap is team ka hissa nahi hain.",
        HTTP_STATUS.FORBIDDEN,
      );
    }

    resolvedTeamId = team._id;
  }

  const instant = !!ground.instantBooking;

  const expiryHours = Number(
    ground.requestExpiryHours ?? GROUND_DEFAULTS.requestExpiryHours,
  );

  /*
  | The expiry never lands after the slot itself starts. A request for
  | tomorrow morning with a 12-hour window would otherwise still be
  | "waiting on the owner" while the slot is being played.
  */

  const expiresAt = instant
    ? null
    : new Date(
        Math.min(
          Date.now() + expiryHours * 3600000,
          start.getTime() - 30 * 60000,
        ),
      );

  const booking: any = await GroundBooking.create({
    groundId: ground._id,

    unitId: unit._id,

    ownerId: ground.userId,

    bookedBy: userId,

    teamId: resolvedTeamId,

    purpose: purpose || (unit.unitType === "net" ? "net" : "match"),

    date: startOfLocalDay(date || start),

    startTime: start,

    endTime: end,

    blockId: block?._id ?? null,

    flexibilityMinutes: [0, 30, 60].includes(Number(flexibilityMinutes))
      ? Number(flexibilityMinutes)
      : 0,

    note: String(note || "").slice(0, 300),

    status: instant ? "confirmed" : "requested",

    expiresAt,

    respondedAt: instant ? new Date() : null,

    amount,

    totalAmount: amount,
  });

  /*
  | The match is attached AFTER the booking exists, so a failure here
  | leaves a valid booking with no match rather than a match pointing at
  | a booking that was never created.
  */

  try {
    const resolvedMatchId = await resolveMatch({
      userId,
      matchId,
      createMatch,
      booking: { startTime: start, endTime: end, teamId: resolvedTeamId },
      ground,
    });

    if (resolvedMatchId) {
      booking.matchId = resolvedMatchId;

      await booking.save();
    }
  } catch (error: any) {
    /*
    | A bad match id must not silently produce a booking with no match,
    | because the owner would then get a request with no fixture details
    | and no way to know one was meant. Roll the booking back and report
    | the real reason.
    */
    await GroundBooking.deleteOne({ _id: booking._id });

    throw error;
  }

  await Ground.updateOne(
    { _id: ground._id },
    {
      $inc: {
        "stats.totalBookings": 1,
        ...(instant ? {} : { "stats.requestsReceived": 1 }),
      },
    },
  );

  const requester: any = await User.findById(userId).select("fullName").lean();

  await notify(() =>
    instant
      ? sendBookingApproved({
          playerId: String(userId),
          actorId: String(ground.userId),
          booking,
          groundName: ground.groundName,
          unitName: unit.name,
        })
      : sendBookingRequested({
          ownerId: String(ground.userId),
          actorId: String(userId),
          booking,
          groundName: ground.groundName,
          unitName: unit.name,
          requesterName: requester?.fullName || "A team",
        }),
  );

  /* Instant bookings still tell the owner, they just do not ask. */

  if (instant) {
    await notify(() =>
      sendBookingRequested({
        ownerId: String(ground.userId),
        actorId: String(userId),
        booking,
        groundName: ground.groundName,
        unitName: unit.name,
        requesterName: requester?.fullName || "A team",
      }),
    );
  }

  return {
    booking: booking.toObject(),
    instant,
    message: instant
      ? "Booking confirm ho gayi."
      : "Request bhej di. Owner confirm karega.",
  };
};

/*
|--------------------------------------------------------------------------
| Owner: yes
|--------------------------------------------------------------------------
|
| The slot is checked AGAIN here. Between the request and this tap the
| owner may have confirmed something else, or taken the day off - and the
| request itself is not a hold.
*/

export const approveBooking = async (bookingId: string, userId: string) => {
  const { booking, ground } = await loadBooking(bookingId, userId, {
    as: "owner",
  });

  if (!["requested", "countered"].includes(booking.status)) {
    throw new AppError(
      `Ye booking already ${booking.status} hai.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const unit: any = await GroundUnit.findById(booking.unitId).lean();

  if (!unit) {
    throw new AppError("Unit nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  await assertSlotFree({
    ground,
    unit,
    start: new Date(booking.startTime),
    end: new Date(booking.endTime),
    ignoreBookingId: String(booking._id),
  });

  const wasPending = booking.status === "requested";

  booking.status = "confirmed";
  booking.respondedAt = new Date();
  booking.expiresAt = null;

  /* A pending counter-offer is dropped - the original time won. */
  booking.counterOffer = {
    startTime: null,
    endTime: null,
    message: "",
    offeredAt: null,
  };

  await booking.save();

  if (wasPending) await recordResponse(ground, booking);

  await notify(() =>
    sendBookingApproved({
      playerId: String(booking.bookedBy),
      actorId: String(userId),
      booking,
      groundName: ground.groundName,
      unitName: unit.name,
    }),
  );

  return booking.toObject();
};

/*
| Response rate and average response time, both derived from timestamps
| rather than self-reported. `avgResponseMinutes` is kept as a running
| mean so there is no aggregate to run on every profile view.
*/

const recordResponse = async (ground: any, booking: any) => {
  const minutes = Math.max(
    0,
    minutesBetween(new Date(booking.createdAt), new Date()),
  );

  const answered = Number(ground?.stats?.requestsAnswered || 0);

  const prevAvg = Number(ground?.stats?.avgResponseMinutes || 0);

  const nextAvg = Math.round((prevAvg * answered + minutes) / (answered + 1));

  await Ground.updateOne(
    { _id: ground._id },
    {
      $inc: { "stats.requestsAnswered": 1 },
      $set: { "stats.avgResponseMinutes": nextAvg },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Owner: no
|--------------------------------------------------------------------------
*/

export const rejectBooking = async (
  bookingId: string,
  userId: string,
  reason?: string,
) => {
  const { booking, ground } = await loadBooking(bookingId, userId, {
    as: "owner",
  });

  if (!["requested", "countered"].includes(booking.status)) {
    throw new AppError(
      `Ye booking already ${booking.status} hai.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  booking.status = "rejected";
  booking.respondedAt = new Date();
  booking.expiresAt = null;
  booking.rejectionReason = String(reason || "").slice(0, 200);

  await booking.save();

  await recordResponse(ground, booking);

  await notify(() =>
    sendBookingRejected({
      playerId: String(booking.bookedBy),
      actorId: String(userId),
      booking,
      groundName: ground.groundName,
      reason: booking.rejectionReason,
    }),
  );

  return booking.toObject();
};

/*
|--------------------------------------------------------------------------
| Owner: not then, but how about this
|--------------------------------------------------------------------------
|
| The counter is STORED, not applied. The original time stays on the
| booking until the player accepts, so a player who declines has not
| already lost it.
|
| The offer must sit inside the flexibility the player declared. A player
| who said "I can move 30 minutes" and is offered a slot four hours later
| has been ignored, not accommodated - and the owner who does that would
| rather know now than be declined and wonder why.
*/

export const counterBooking = async (
  bookingId: string,
  userId: string,
  payload: any,
) => {
  const { booking, ground } = await loadBooking(bookingId, userId, {
    as: "owner",
  });

  if (booking.status !== "requested") {
    throw new AppError(
      "Sirf pending request par counter offer bhej sakte hain.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const start = new Date(payload?.startTime);
  const end = new Date(payload?.endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError("Naya time galat hai.", HTTP_STATUS.BAD_REQUEST);
  }

  const flex = Number(booking.flexibilityMinutes || 0);

  if (flex <= 0) {
    throw new AppError(
      "Is request me koi flexibility nahi hai - accept ya reject kijiye.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const shift = Math.abs(
    minutesBetween(new Date(booking.startTime), start),
  );

  if (shift > flex) {
    throw new AppError(
      `Team ne sirf ${flex} min flexibility di hai, ye offer ${shift} min ka shift hai.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /*
  | The length is kept the same. Offering a shorter slot at the same price
  | is a different deal, not a time change, and there is nowhere in this
  | flow for the player to renegotiate the amount.
  */

  const wanted = minutesBetween(
    new Date(booking.startTime),
    new Date(booking.endTime),
  );

  if (minutesBetween(start, end) !== wanted) {
    throw new AppError(
      "Counter offer ki duration same honi chahiye.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const unit: any = await GroundUnit.findById(booking.unitId).lean();

  if (!unit) {
    throw new AppError("Unit nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  await assertSlotFree({
    ground,
    unit,
    start,
    end,
    ignoreBookingId: String(booking._id),
  });

  booking.status = "countered";

  booking.counterOffer = {
    startTime: start,
    endTime: end,
    message: String(payload?.message || "").slice(0, 200),
    offeredAt: new Date(),
  };

  /*
  | The ball is with the player now, so the clock restarts from here -
  | otherwise a counter sent at hour 11 of a 12-hour window gives them an
  | hour to answer.
  */

  booking.expiresAt = new Date(
    Math.min(
      Date.now() +
        Number(ground.requestExpiryHours ?? GROUND_DEFAULTS.requestExpiryHours) *
          3600000,
      start.getTime() - 30 * 60000,
    ),
  );

  await booking.save();

  await notify(() =>
    sendBookingCountered({
      playerId: String(booking.bookedBy),
      actorId: String(userId),
      booking,
      groundName: ground.groundName,
    }),
  );

  return booking.toObject();
};

/*
|--------------------------------------------------------------------------
| Player: yes to the new time / no thanks
|--------------------------------------------------------------------------
|
| Accepting rechecks the slot and REPRICES it. A morning block moved into
| an evening one costs what the evening block costs; carrying the old
| amount over would hand the owner's floodlit slot away at the 6 AM rate.
*/

export const respondToCounter = async (
  bookingId: string,
  userId: string,
  accept: boolean,
) => {
  const { booking, ground } = await loadBooking(bookingId, userId, {
    as: "player",
  });

  if (booking.status !== "countered") {
    throw new AppError(
      "Is booking par koi counter offer pending nahi hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const unit: any = await GroundUnit.findById(booking.unitId).lean();

  if (!unit) {
    throw new AppError("Unit nahi mili.", HTTP_STATUS.NOT_FOUND);
  }

  const requester: any = await User.findById(userId).select("fullName").lean();

  if (!accept) {
    booking.status = "rejected";
    booking.respondedAt = new Date();
    booking.expiresAt = null;
    booking.rejectionReason = "Team ne alternative time decline kiya";

    await booking.save();

    await notify(() =>
      sendCounterDeclined({
        ownerId: String(booking.ownerId),
        actorId: String(userId),
        booking,
        requesterName: requester?.fullName || "The team",
      }),
    );

    return booking.toObject();
  }

  const start = new Date(booking.counterOffer.startTime);
  const end = new Date(booking.counterOffer.endTime);

  await assertSlotFree({
    ground,
    unit,
    start,
    end,
    ignoreBookingId: String(booking._id),
  });

  const { amount, block } = priceFor({ unit, start, end });

  booking.startTime = start;
  booking.endTime = end;
  booking.date = startOfLocalDay(start);
  booking.blockId = block?._id ?? null;
  booking.amount = amount;
  booking.totalAmount = amount;
  booking.status = "confirmed";
  booking.respondedAt = new Date();
  booking.expiresAt = null;

  booking.counterOffer = {
    startTime: null,
    endTime: null,
    message: "",
    offeredAt: null,
  };

  await booking.save();

  /* The attached match follows the booking. */

  if (booking.matchId) {
    await Match.updateOne(
      { _id: booking.matchId },
      { $set: { startTime: start } },
    );
  }

  await notify(() =>
    sendCounterAccepted({
      ownerId: String(booking.ownerId),
      actorId: String(userId),
      booking,
      requesterName: requester?.fullName || "The team",
      unitName: unit.name,
    }),
  );

  return booking.toObject();
};

/*
|--------------------------------------------------------------------------
| Cancel
|--------------------------------------------------------------------------
|
| Either side can, and the difference between them is recorded rather than
| punished. `cancelledWithinPolicy` says whether it beat the ground's
| cutoff; an owner cancelling at all adds to `cancelledByOwner`, which is
| the number a player looks at before trusting a confirmation.
|
| No fee either way. There is no card on file to charge one to, and a fee
| the app announces and cannot collect is worse than no fee.
*/

export const cancelBooking = async (
  bookingId: string,
  userId: string,
  reason?: string,
) => {
  const { booking, ground, isOwner } = await loadBooking(bookingId, userId);

  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new AppError(
      `Ye booking already ${booking.status} hai.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (booking.checkInAt) {
    throw new AppError(
      "Session shuru ho chuka hai, cancel nahi ho sakta.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const cutoffHours = Number(
    ground.cancellationCutoffHours ?? GROUND_DEFAULTS.cancellationCutoffHours,
  );

  const hoursLeft =
    (new Date(booking.startTime).getTime() - Date.now()) / 3600000;

  booking.status = "cancelled";
  booking.cancelledBy = isOwner ? "owner" : "player";
  booking.cancelReason = String(reason || "").slice(0, 200);
  booking.cancelledAt = new Date();
  booking.cancelledWithinPolicy = hoursLeft >= cutoffHours;
  booking.expiresAt = null;

  await booking.save();

  if (isOwner) {
    await Ground.updateOne(
      { _id: ground._id },
      { $inc: { "stats.cancelledByOwner": 1 } },
    );
  }

  /*
  | A match created from this booking loses its venue but is left alone
  | otherwise - the teams may still play somewhere else, and deleting
  | their fixture because a ground fell through would be the app making a
  | decision that is not its to make.
  */

  if (booking.matchId) {
    await Match.updateOne(
      { _id: booking.matchId },
      { $set: { groundId: null, venueName: "" } },
    );
  }

  await notify(() =>
    sendBookingCancelled({
      receiverId: isOwner
        ? String(booking.bookedBy)
        : String(booking.ownerId),
      actorId: String(userId),
      booking,
      groundName: ground.groundName,
      byOwner: isOwner,
      reason: booking.cancelReason,
    }),
  );

  return {
    booking: booking.toObject(),
    withinPolicy: booking.cancelledWithinPolicy,
    message: booking.cancelledWithinPolicy
      ? "Booking cancel ho gayi."
      : `Cancel ho gayi, par ${cutoffHours} ghante ke andar thi - ye record me rahega.`,
  };
};

/*
|--------------------------------------------------------------------------
| Check in - and this is where fault gets decided
|--------------------------------------------------------------------------
|
| The owner taps once when the side walks on. Everything else is
| arithmetic:
|
|   late by <= grace        nobody's fault, nothing recorded
|   previous booking still
|   checked out after this
|   one was due to start    the GROUND's fault: the lost minutes are added
|                           to this booking's end time, this booking is
|                           exempt from overtime, and the ground's
|                           lateStarts goes up
|   otherwise               the TEAM's fault: recorded against the booking
|
| Nobody is asked. Nobody has to be believed. The previous booking's
| check-out timestamp was written by the same owner, before they knew this
| would matter, which is exactly what makes it worth trusting.
|
| WHY THE COMPENSATION IS TIME AND NOT MONEY
|
| Because time is the thing the app can actually give. It can extend the
| slot and it can bill the side that overran; it cannot take money from one
| stranger and hand it to another. Extending the slot is also what the team
| actually wanted - they came to play a game, not to be paid Rs 100.
*/

export const checkIn = async (bookingId: string, userId: string) => {
  const { booking, ground } = await loadBooking(bookingId, userId, {
    as: "owner",
  });

  if (booking.status !== "confirmed") {
    throw new AppError(
      "Sirf confirmed booking check-in ho sakti hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (booking.checkInAt) {
    throw new AppError("Already checked in.", HTTP_STATUS.BAD_REQUEST);
  }

  const now = new Date();

  const grace = Number(ground.graceMinutes ?? GROUND_DEFAULTS.graceMinutes);

  const delay = Math.max(0, minutesBetween(new Date(booking.startTime), now));

  booking.checkInAt = now;
  booking.delayMinutes = delay;

  let compensation = 0;

  if (delay <= grace) {
    booking.delayFault = "none";
  } else {
    /*
    | Was the pitch even free? The previous booking on this unit that was
    | due to end before this one started, and actually did not.
    */

    const previous: any = await GroundBooking.findOne({
      unitId: booking.unitId,
      _id: { $ne: booking._id },
      status: { $in: ["completed", "confirmed", "no_show"] },
      endTime: { $lte: new Date(booking.startTime) },
    })
      .sort({ endTime: -1 })
      .select("checkOutAt endTime")
      .lean();

    const heldUntil = previous?.checkOutAt
      ? new Date(previous.checkOutAt)
      : null;

    const groundHeldItUp =
      heldUntil && heldUntil > new Date(booking.startTime);

    if (groundHeldItUp) {
      booking.delayFault = "ground";

      /*
      | Only the minutes the ground actually cost them. If the pitch was
      | free at 6:20 and the side arrived at 6:40, the ground owes twenty
      | minutes, not forty.
      */

      compensation = Math.max(
        0,
        minutesBetween(new Date(booking.startTime), heldUntil),
      );

      booking.compensationMinutes = compensation;

      booking.endTime = addMinutes(new Date(booking.endTime), compensation);

      await Ground.updateOne(
        { _id: ground._id },
        { $inc: { "stats.lateStarts": 1 } },
      );
    } else {
      booking.delayFault = "team";
    }
  }

  await booking.save();

  await notify(() =>
    sendCheckedIn({
      playerId: String(booking.bookedBy),
      actorId: String(userId),
      booking,
      groundName: ground.groundName,
    }),
  );

  if (compensation > 0) {
    await notify(() =>
      sendDelayCompensation({
        playerId: String(booking.bookedBy),
        booking,
        groundName: ground.groundName,
        minutes: compensation,
      }),
    );
  }

  return {
    booking: booking.toObject(),
    delayMinutes: delay,
    fault: booking.delayFault,
    compensationMinutes: compensation,
    message:
      booking.delayFault === "ground"
        ? `Ground ki wajah se ${compensation} min late - slot utna extend kar diya.`
        : booking.delayFault === "team"
          ? `${delay} min late start record ho gaya.`
          : "Check-in ho gaya, on time.",
  };
};

/*
|--------------------------------------------------------------------------
| Check out - the bill
|--------------------------------------------------------------------------
|
| Overtime is measured from the booking's end time, which by now already
| includes any compensation added at check-in. So a side kept waiting
| twenty minutes by the ground is not then billed for the twenty minutes
| they ran over - the adjustment happened before the meter started.
|
| A booking whose delay was the GROUND's fault is exempt from overtime
| altogether. Billing somebody for time the ground itself cost them is the
| single fastest way to make this feature hated.
*/

export const checkOut = async (
  bookingId: string,
  userId: string,
  payload: any = {},
) => {
  const { booking, ground, isOwner } = await loadBooking(bookingId, userId);

  if (booking.status !== "confirmed") {
    throw new AppError(
      "Ye booking confirmed nahi hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (!booking.checkInAt) {
    throw new AppError(
      "Pehle check-in hona chahiye.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (booking.checkOutAt) {
    throw new AppError("Already checked out.", HTTP_STATUS.BAD_REQUEST);
  }

  const now = new Date();

  booking.checkOutAt = now;

  const past = Math.max(0, minutesBetween(new Date(booking.endTime), now));

  /*
  | A few minutes of walking off the field is not overtime. The grace at
  | the end is the same number as the grace at the start, so the owner has
  | one setting to understand rather than two.
  */

  const grace = Number(ground.graceMinutes ?? GROUND_DEFAULTS.graceMinutes);

  const billable =
    booking.delayFault === "ground" ? 0 : past > grace ? past : 0;

  booking.overtimeMinutes = billable;

  booking.overtimeAmount = overtimeAmount(
    Number(booking.amount),
    minutesBetween(new Date(booking.startTime), new Date(booking.endTime)),
    billable,
    Number(ground.overtimeMultiplier ?? GROUND_DEFAULTS.overtimeMultiplier),
  );

  booking.totalAmount =
    Number(booking.amount) + Number(booking.overtimeAmount);

  booking.status = "completed";

  /* Only the owner handles cash, so only the owner can mark it paid. */

  if (isOwner && payload?.paymentStatus) {
    if (!["unpaid", "paid", "waived"].includes(payload.paymentStatus)) {
      throw new AppError("Payment status galat hai.", HTTP_STATUS.BAD_REQUEST);
    }

    booking.paymentStatus = payload.paymentStatus;

    booking.paidAt = payload.paymentStatus === "paid" ? now : null;
  }

  await booking.save();

  await Ground.updateOne(
    { _id: ground._id },
    { $inc: { "stats.completedBookings": 1 } },
  );

  await notify(() =>
    sendSessionCompleted({
      playerId: String(booking.bookedBy),
      actorId: String(userId),
      booking,
      groundName: ground.groundName,
    }),
  );

  /*
  | Asked now rather than tomorrow. An hour later nobody remembers whether
  | the toilets were clean; walking off the field, everybody does.
  */

  await notify(() =>
    sendReviewRequest({
      playerId: String(booking.bookedBy),
      booking,
      groundName: ground.groundName,
    }),
  );

  return {
    booking: booking.toObject(),
    overtimeMinutes: billable,
    overtimeAmount: booking.overtimeAmount,
    totalAmount: booking.totalAmount,
    message:
      billable > 0
        ? `${billable} min overtime - Rs ${booking.overtimeAmount} extra, total Rs ${booking.totalAmount}.`
        : `Session complete. Total Rs ${booking.totalAmount}.`,
  };
};

/*
|--------------------------------------------------------------------------
| Nobody turned up
|--------------------------------------------------------------------------
|
| Separate from `cancelled` because it is a different fact about a
| different party, and the owner should not have to describe a no-show as
| their own cancellation. Only allowed once the slot has actually started,
| so it cannot be used pre-emptively.
*/

export const markNoShow = async (bookingId: string, userId: string) => {
  const { booking, ground } = await loadBooking(bookingId, userId, {
    as: "owner",
  });

  if (booking.status !== "confirmed") {
    throw new AppError(
      "Sirf confirmed booking no-show mark ho sakti hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (booking.checkInAt) {
    throw new AppError(
      "Check-in ho chuka hai, no-show nahi ho sakta.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const grace = Number(ground.graceMinutes ?? GROUND_DEFAULTS.graceMinutes);

  if (
    Date.now() <
    new Date(booking.startTime).getTime() + grace * 60000
  ) {
    throw new AppError(
      `Slot start hone ke ${grace} min baad hi no-show mark kar sakte hain.`,
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  booking.status = "no_show";
  booking.delayFault = "team";

  await booking.save();

  await notify(() =>
    sendBookingCancelled({
      receiverId: String(booking.bookedBy),
      actorId: String(userId),
      booking,
      groundName: ground.groundName,
      byOwner: true,
      reason: "No show",
    }),
  );

  return booking.toObject();
};

/*
|--------------------------------------------------------------------------
| Mark cash received
|--------------------------------------------------------------------------
|
| Separate from check-out because the two do not always happen together -
| a regular customer settles up at the end of the month, and the owner
| still wants the session marked complete on the day.
*/

export const setPaymentStatus = async (
  bookingId: string,
  userId: string,
  status: string,
) => {
  const { booking } = await loadBooking(bookingId, userId, { as: "owner" });

  if (!["unpaid", "paid", "waived"].includes(status)) {
    throw new AppError("Payment status galat hai.", HTTP_STATUS.BAD_REQUEST);
  }

  booking.paymentStatus = status;
  booking.paidAt = status === "paid" ? new Date() : null;

  await booking.save();

  return booking.toObject();
};

/*
|--------------------------------------------------------------------------
| Lists
|--------------------------------------------------------------------------
*/

const BOOKING_POPULATE = [
  { path: "groundId", select: "groundName area city image photos contactNumber" },
  { path: "unitId", select: "name unitType pitchType hasFloodlights" },
  { path: "teamId", select: "teamName logo" },
  {
    path: "matchId",
    select: "matchTitle matchType overs teamA teamB status",
    populate: [
      { path: "teamA", select: "teamName logo" },
      { path: "teamB", select: "teamName logo" },
    ],
  },
];

/*
| The player's own bookings, split the way the screen shows them rather
| than the way they are stored. `upcoming` deliberately includes requests
| and counters - from the player's side a slot they are waiting on belongs
| in the same list as one that is confirmed.
*/

export const getMyBookings = async (
  userId: string,
  q: any = {},
) => {
  const tab = String(q.tab || "upcoming");

  const now = new Date();

  const filter: any = { bookedBy: userId };

  if (tab === "upcoming") {
    filter.status = { $in: ACTIVE_STATUSES };
    filter.endTime = { $gte: now };
  } else if (tab === "past") {
    filter.$or = [
      { status: { $in: ["completed", "no_show"] } },
      { status: { $in: ACTIVE_STATUSES }, endTime: { $lt: now } },
    ];
  } else if (tab === "cancelled") {
    filter.status = { $in: ["cancelled", "rejected", "expired"] };
  }

  const bookings: any[] = await GroundBooking.find(filter)
    .populate(BOOKING_POPULATE as any)
    .sort(tab === "past" ? { startTime: -1 } : { startTime: 1 })
    .limit(Number(q.limit) || 50)
    .lean();

  return { tab, count: bookings.length, bookings };
};

/*
| The owner's book. `pending` leads because it is the only tab with
| something for them to do, and a ground owner opening this app at 9 PM
| wants to see the four requests waiting, not tomorrow's schedule.
*/

export const getOwnerBookings = async (userId: string, q: any = {}) => {
  const tab = String(q.tab || "pending");

  const now = new Date();

  const filter: any = { ownerId: userId };

  if (q.groundId) filter.groundId = q.groundId;

  if (tab === "pending") {
    filter.status = { $in: ["requested", "countered"] };
    filter.endTime = { $gte: now };
  } else if (tab === "upcoming") {
    filter.status = "confirmed";
    filter.endTime = { $gte: now };
  } else if (tab === "today") {
    filter.status = { $in: ["confirmed", "completed"] };
    filter.startTime = { $gte: startOfLocalDay(now), $lte: endOfLocalDay(now) };
  } else if (tab === "past") {
    filter.status = { $in: ["completed", "no_show"] };
  } else if (tab === "cancelled") {
    filter.status = { $in: ["cancelled", "rejected", "expired"] };
  }

  const bookings: any[] = await GroundBooking.find(filter)
    .populate([
      ...BOOKING_POPULATE,
      { path: "bookedBy", select: "fullName phone profileImage" },
    ] as any)
    .sort(
      tab === "past" || tab === "cancelled"
        ? { startTime: -1 }
        : { startTime: 1 },
    )
    .limit(Number(q.limit) || 50)
    .lean();

  return { tab, count: bookings.length, bookings };
};

export const getBookingById = async (bookingId: string, userId: string) => {
  const { booking, ground, isOwner } = await loadBooking(bookingId, userId);

  const full: any = await GroundBooking.findById(booking._id)
    .populate([
      ...BOOKING_POPULATE,
      { path: "bookedBy", select: "fullName phone profileImage" },
    ] as any)
    .lean();

  /*
  | The ground's phone number is on the booking only once it is worth
  | having. Before confirmation the ground has not agreed to anything and
  | should not be receiving calls about it.
  */

  const releaseContact =
    isOwner || ["confirmed", "completed", "no_show"].includes(booking.status);

  if (!releaseContact && full?.groundId) {
    full.groundId.contactNumber = "";
  }

  return {
    ...full,

    isOwner,

    /* What this user can do right now, so the app renders no dead buttons. */
    actions: {
      canApprove: isOwner && ["requested", "countered"].includes(booking.status),

      canReject: isOwner && ["requested", "countered"].includes(booking.status),

      canCounter:
        isOwner &&
        booking.status === "requested" &&
        Number(booking.flexibilityMinutes) > 0,

      canRespondToCounter: !isOwner && booking.status === "countered",

      canCancel:
        ACTIVE_STATUSES.includes(booking.status) && !booking.checkInAt,

      canCheckIn: isOwner && booking.status === "confirmed" && !booking.checkInAt,

      canCheckOut:
        booking.status === "confirmed" &&
        !!booking.checkInAt &&
        !booking.checkOutAt,

      canMarkNoShow:
        isOwner &&
        booking.status === "confirmed" &&
        !booking.checkInAt &&
        Date.now() >
          new Date(booking.startTime).getTime() +
            Number(ground.graceMinutes ?? GROUND_DEFAULTS.graceMinutes) * 60000,

      canReview:
        !isOwner && booking.status === "completed" && !booking.isReviewed,

      canSetPayment: isOwner && booking.status === "completed",
    },
  };
};

/*
|--------------------------------------------------------------------------
| The owner's earnings
|--------------------------------------------------------------------------
|
| Only completed sessions count, and `paid` is reported separately from
| `earned`. A ground taking cash has a real gap between the two and needs
| to see it - a single "revenue" number that includes four unpaid
| bookings is worse than no number.
*/

export const getOwnerEarnings = async (
  userId: string,
  q: any = {},
) => {
  const from = q.from ? startOfLocalDay(q.from) : startOfLocalDay(new Date());

  const to = q.to ? endOfLocalDay(q.to) : endOfLocalDay(new Date());

  const match: any = {
    ownerId: new mongoose.Types.ObjectId(userId),
    status: "completed",
    startTime: { $gte: from, $lte: to },
  };

  if (q.groundId) {
    match.groundId = new mongoose.Types.ObjectId(String(q.groundId));
  }

  const rows: any[] = await GroundBooking.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$startTime" },
        },
        sessions: { $sum: 1 },
        earned: { $sum: "$totalAmount" },
        overtime: { $sum: "$overtimeAmount" },
        paid: {
          $sum: {
            $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const totals = rows.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      earned: acc.earned + r.earned,
      overtime: acc.overtime + r.overtime,
      paid: acc.paid + r.paid,
    }),
    { sessions: 0, earned: 0, overtime: 0, paid: 0 },
  );

  return {
    from,
    to,
    totals: { ...totals, outstanding: totals.earned - totals.paid },
    days: rows.map((r) => ({ date: r._id, ...r, _id: undefined })),
  };
};

/*
|--------------------------------------------------------------------------
| The jobs
|--------------------------------------------------------------------------
|
| Two of them, both idempotent, both safe to run every few minutes.
|
| expireStaleRequests is the one that keeps the feature honest. Without it
| an owner who stops opening the app silently freezes every slot anybody
| ever asked for, and a player is left believing they have a ground.
|
| Note what it does NOT do: it does not touch `requestsAnswered`. A ground
| that never replies should see its response rate fall, and quietly
| counting the expiry as an answer would hide exactly the behaviour the
| number exists to expose.
*/

export const expireStaleRequests = async (): Promise<number> => {
  const due: any[] = await GroundBooking.find({
    status: { $in: ["requested", "countered"] },
    expiresAt: { $ne: null, $lte: new Date() },
  })
    .limit(200)
    .lean();

  if (!due.length) return 0;

  await GroundBooking.updateMany(
    { _id: { $in: due.map((b) => b._id) } },
    { $set: { status: "expired", expiresAt: null } },
  );

  const groundIds = [...new Set(due.map((b) => String(b.groundId)))];

  const grounds: any[] = await Ground.find({ _id: { $in: groundIds } })
    .select("groundName")
    .lean();

  const nameOf = new Map(
    grounds.map((g) => [String(g._id), g.groundName as string]),
  );

  for (const booking of due) {
    await notify(() =>
      sendBookingExpired({
        playerId: String(booking.bookedBy),
        booking,
        groundName: nameOf.get(String(booking.groundId)) || "The ground",
      }),
    );
  }

  return due.length;
};

/*
| Reminders, to both sides, for tomorrow's confirmed bookings. A window
| rather than an exact time so a job that runs late still sends them, and
| `reminderSentAt` is not needed because the window is a whole day and the
| job runs once in it - see the note in the cron wiring.
*/

export const sendTomorrowReminders = async (): Promise<number> => {
  const tomorrow = addMinutes(startOfLocalDay(new Date()), 24 * 60);

  const bookings: any[] = await GroundBooking.find({
    status: "confirmed",
    startTime: { $gte: tomorrow, $lte: endOfLocalDay(tomorrow) },
  })
    .populate([{ path: "groundId", select: "groundName address area" }] as any)
    .limit(500)
    .lean();

  for (const booking of bookings) {
    const groundName = booking?.groundId?.groundName || "The ground";

    const address = booking?.groundId?.address || booking?.groundId?.area || "";

    await notify(() =>
      sendBookingReminder({
        receiverId: String(booking.bookedBy),
        booking,
        groundName,
        address,
      }),
    );

    await notify(() =>
      sendBookingReminder({
        receiverId: String(booking.ownerId),
        booking,
        groundName,
        address,
      }),
    );
  }

  return bookings.length;
};

/*
|--------------------------------------------------------------------------
| For the match-creation flow
|--------------------------------------------------------------------------
|
| When a player is creating a match and wants to pick a ground, the app
| needs to know which of their own bookings already have no match on them -
| those are the ones they can attach this new fixture to.
*/

export const getAttachableBookings = async (userId: string) => {
  const bookings: any[] = await GroundBooking.find({
    bookedBy: userId,
    matchId: null,
    purpose: { $ne: "net" },
    status: { $in: ["requested", "confirmed"] },
    startTime: { $gte: new Date() },
  })
    .populate([
      { path: "groundId", select: "groundName area city" },
      { path: "unitId", select: "name unitType" },
    ] as any)
    .sort({ startTime: 1 })
    .limit(20)
    .lean();

  return bookings;
};

/*
| The reverse: a match that exists and has no ground yet. Used by the
| "book a ground for this match" entry point, which is how most bookings
| will actually start.
*/

export const attachMatchToBooking = async (
  bookingId: string,
  userId: string,
  matchId: string,
) => {
  const { booking, ground } = await loadBooking(bookingId, userId, {
    as: "player",
  });

  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new AppError(
      "Sirf active booking par match attach ho sakta hai.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const resolved = await resolveMatch({
    userId,
    matchId,
    booking: {
      startTime: new Date(booking.startTime),
      endTime: new Date(booking.endTime),
      teamId: booking.teamId,
    },
    ground,
  });

  booking.matchId = resolved;

  await booking.save();

  return booking.toObject();
};
