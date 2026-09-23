import {
  WEEKEND_DAYS,
  NIGHT_START_HOUR,
} from "./ground.constants";

/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| ground.helpers.ts
|
| Description:
| The time and money arithmetic the grounds feature keeps needing.
|
| WHY THIS IS ITS OWN FILE
|
| Three different services ask the same questions - what does this slot
| cost, is this time free, is this a weekend - and every one of those
| answers has to match. A price shown on the slot picker that disagrees
| with the price written onto the booking is the kind of bug nobody spots
| until a customer argues at the gate.
|
| So it is written once here, and the discovery service, the booking
| service and the availability check all call the same function.
|
| A NOTE ON TIMEZONES
|
| Everything is computed in the SERVER's local time and the times a ground
| enters are its own wall-clock times. For a single-country app that is
| correct and simple - a ground in Noida opens at six in the morning, and
| there is no second interpretation of that.
|
| It stops being correct the day this runs across timezones, and the fix
| then is to put an IANA zone on the Ground and convert here. That is why
| every conversion is funnelled through this file rather than scattered.
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| "HH:mm" <-> minutes
|--------------------------------------------------------------------------
|
| Minutes-since-midnight is what all the comparison maths runs on. Doing
| it on strings works right up until "09:00" and "10:00" sort correctly
| but "9:00" does not, which is exactly the sort of thing that reaches
| production.
*/

export const toMinutes = (hhmm: string): number => {
  const [h, m] = String(hhmm || "0:0").split(":");

  const hours = Number(h) || 0;
  const mins = Number(m) || 0;

  return hours * 60 + mins;
};

export const toHHMM = (minutes: number): string => {
  const safe = Math.max(0, Math.round(minutes));

  const h = Math.floor(safe / 60) % 24;
  const m = safe % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/*
| Midnight of the given date, in server local time. This is what a
| booking's `date` field holds, so that "everything on the 12th" is one
| equality check rather than a range.
*/

export const startOfLocalDay = (date: Date | string): Date => {
  const d = new Date(date);

  d.setHours(0, 0, 0, 0);

  return d;
};

export const endOfLocalDay = (date: Date | string): Date => {
  const d = new Date(date);

  d.setHours(23, 59, 59, 999);

  return d;
};

/* A wall-clock time on a particular date, as a real timestamp. */

export const atTime = (date: Date | string, hhmm: string): Date => {
  const d = startOfLocalDay(date);

  d.setMinutes(toMinutes(hhmm));

  return d;
};

export const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60000);

export const minutesBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 60000);

export const isWeekend = (date: Date | string): boolean =>
  WEEKEND_DAYS.includes(new Date(date).getDay());

/*
| Day or night, worked out from the hour rather than stored.
|
| An owner never has to declare it, so a ground can never contradict
| itself by labelling a 7 PM slot "day". The filter on the discovery
| screen reads this.
*/

export const isNightSlot = (start: Date): boolean =>
  start.getHours() >= NIGHT_START_HOUR;

/*
|--------------------------------------------------------------------------
| Do two intervals overlap?
|--------------------------------------------------------------------------
|
| Half-open on purpose: a slot ending at exactly 09:00 does NOT clash with
| one starting at 09:00. Using `<=` on both ends would make every
| back-to-back pair look like a conflict and silently halve the day's
| inventory.
*/

export const overlaps = (
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean => aStart < bEnd && bStart < aEnd;

/*
|--------------------------------------------------------------------------
| What a match block costs on a given date
|--------------------------------------------------------------------------
|
| `weekendRate` of null means "same as weekday" rather than free - so a
| null check, not a falsy check. A ground that genuinely charges nothing
| at the weekend would set 0, and `|| weekdayRate` would quietly bill them
| the weekday price.
*/

export const blockRate = (block: any, date: Date | string): number => {
  if (isWeekend(date) && block?.weekendRate != null) {
    return Number(block.weekendRate);
  }

  return Number(block?.weekdayRate || 0);
};

export const netHourlyRate = (unit: any, date: Date | string): number => {
  if (isWeekend(date) && unit?.weekendHourlyRate != null) {
    return Number(unit.weekendHourlyRate);
  }

  return Number(unit?.hourlyRate || 0);
};

/*
| A net session, priced by the hour and rounded up to the nearest half
| hour. Rounding up rather than to-nearest because a ground should never
| be paid for less time than it gave up.
*/

export const netAmount = (
  unit: any,
  date: Date | string,
  startTime: Date,
  endTime: Date,
): number => {
  const mins = Math.max(0, minutesBetween(startTime, endTime));

  const halfHours = Math.ceil(mins / 30);

  return Math.round((netHourlyRate(unit, date) * halfHours) / 2);
};

/*
|--------------------------------------------------------------------------
| Overtime
|--------------------------------------------------------------------------
|
| Billed per started half hour at the ground's multiple of the slot's own
| hourly rate. Per half hour rather than per minute because a bill that
| reads "₹37.50 for 9 minutes" invites an argument at the gate, and per
| STARTED half hour because the ground has lost that half hour whether or
| not it was used.
|
| The hourly rate is derived from what this booking actually cost over its
| own length, so a cheap morning block and an expensive floodlit one
| produce different overtime without anybody entering a second number.
*/

export const overtimeAmount = (
  bookingAmount: number,
  bookingMinutes: number,
  overtimeMinutes: number,
  multiplier: number,
): number => {
  if (overtimeMinutes <= 0 || bookingMinutes <= 0) return 0;

  const hourly = (Number(bookingAmount) / bookingMinutes) * 60;

  const halfHours = Math.ceil(overtimeMinutes / 30);

  return Math.round((hourly * multiplier * halfHours) / 2);
};

/*
|--------------------------------------------------------------------------
| Distance
|--------------------------------------------------------------------------
|
| Only used for the non-geo fallback path - when a user has refused
| location permission and picked a city, there is nothing to sort by, and
| for the few places a distance is wanted outside a $near query.
|
| Inside a $near query Mongo computes this itself, far faster, and that is
| the path virtually every search takes.
*/

export const haversineKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return Number((2 * R * Math.asin(Math.sqrt(a))).toFixed(2));
};

/*
|--------------------------------------------------------------------------
| The unit's hours for a particular date
|--------------------------------------------------------------------------
|
| Returns null when the unit is shut that day, which every caller treats
| as "no slots" rather than as an error - a ground being closed on Monday
| is normal, not a failure.
*/

export const hoursForDate = (
  unit: any,
  date: Date | string,
): { open: string; close: string } | null => {
  const day = new Date(date).getDay();

  const row = (unit?.weeklyHours || []).find((h: any) => h.day === day);

  if (!row || row.closed) return null;

  return { open: row.open, close: row.close };
};
