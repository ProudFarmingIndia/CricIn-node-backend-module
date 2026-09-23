/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Grounds
|
| File:
| ground.constants.ts
|
| Description:
| Every fixed list the grounds feature uses, in one place.
|
| WHY A CONSTANTS FILE AND NOT INLINE ENUMS
|
| Facilities, pitch types and the rest are shown as filter chips on the
| discovery screen, as checkboxes on the add-ground form, and as badges on
| the ground card. Three screens, one list. Inline enums on the schema
| would leave the app hard-coding its own copy, and the day somebody adds
| "shower" to the schema the filter chips would silently not offer it.
|
| So the server owns the list and hands it to the app through
| GET /grounds/options. A new facility then appears in the app without a
| release.
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Facilities
|--------------------------------------------------------------------------
|
| `key` is what is stored and filtered on; `label` is what a person reads;
| `icon` is an Ionicons name so the app does not keep its own mapping.
|
| Ordered by how often people actually filter on them - parking, washroom
| and floodlights are the three that decide a booking, so they lead.
*/

export const GROUND_FACILITIES = [
  { key: "parking", label: "Parking", icon: "car-outline" },
  { key: "washroom", label: "Washroom", icon: "water-outline" },
  { key: "floodlights", label: "Floodlights", icon: "flashlight-outline" },
  { key: "changing_room", label: "Changing room", icon: "shirt-outline" },
  { key: "drinking_water", label: "Drinking water", icon: "wine-outline" },
  { key: "seating", label: "Seating for spectators", icon: "people-outline" },
  { key: "canteen", label: "Canteen", icon: "fast-food-outline" },
  { key: "first_aid", label: "First aid", icon: "medkit-outline" },
  { key: "equipment_rental", label: "Equipment on rent", icon: "baseball-outline" },
  { key: "scoreboard", label: "Scoreboard", icon: "tv-outline" },
  { key: "practice_nets", label: "Practice nets", icon: "grid-outline" },
  { key: "shower", label: "Shower", icon: "rainy-outline" },
  { key: "cctv", label: "CCTV", icon: "videocam-outline" },
  { key: "wifi", label: "Wi-Fi", icon: "wifi-outline" },
] as const;

export const FACILITY_KEYS = GROUND_FACILITIES.map((f) => f.key);

/*
| The keys as a TYPE, not just a list.
|
| `as const` above makes FACILITY_KEYS a union of literals rather than
| string[], and Mongoose 9's typed queries and creates hold you to it: a
| plain `string[]` handed to a field declared with this enum is rejected.
| That is the schema doing its job, so the fix is to carry the narrow type
| through instead of widening the field.
|
| Used with a type predicate when filtering unknown input down to real
| keys - see groundReview.service.createReview.
*/

export type FacilityKey = (typeof GROUND_FACILITIES)[number]["key"];

/*
|--------------------------------------------------------------------------
| Pitch types
|--------------------------------------------------------------------------
|
| This is the single most-asked question about a local ground, and it
| changes how the game plays - so it is a first-class filter, not a
| free-text line in the description.
*/

export const PITCH_TYPES = [
  { key: "turf", label: "Turf" },
  { key: "matting", label: "Matting" },
  { key: "cement", label: "Cement" },
  { key: "astro_turf", label: "Astro turf" },
  { key: "mud", label: "Mud" },
] as const;

export const PITCH_TYPE_KEYS = PITCH_TYPES.map((p) => p.key);

/*
|--------------------------------------------------------------------------
| What a bookable unit is
|--------------------------------------------------------------------------
|
| A ground sells two different things and they behave differently enough
| to need separate handling:
|
|   match  sold in fixed blocks the owner defines (6-9 AM at one rate,
|          6-9 PM at another) because a match needs a whole session and
|          the owner wants to control how the day is carved up
|
|   net    sold by the hour, because nobody wants a net for three hours
|          and the owner does not care which hour you take
*/

export const UNIT_TYPES = ["match", "net"] as const;

/*
|--------------------------------------------------------------------------
| Booking lifecycle
|--------------------------------------------------------------------------
|
|   requested   waiting on the owner
|   countered   owner proposed a different time; waiting on the player
|   confirmed   both agreed; the slot is held
|   rejected    owner said no
|   cancelled   either side pulled out after confirming
|   expired     the owner never answered and the request timed out
|   completed   the session happened and was checked out
|   no_show     confirmed, but nobody turned up
|
| `expired` exists separately from `rejected` on purpose: a ground that
| never answers is a different problem from one that answers no, and the
| owner's response rate should only be hurt by the first.
*/

export const BOOKING_STATUSES = [
  "requested",
  "countered",
  "confirmed",
  "rejected",
  "cancelled",
  "expired",
  "completed",
  "no_show",
] as const;

export const BOOKING_PURPOSES = ["match", "net", "practice"] as const;

/*
|--------------------------------------------------------------------------
| Who caused a late start
|--------------------------------------------------------------------------
|
| Never decided by a person - see groundBooking.service.checkIn. Two
| timestamps settle it, so there is nobody to argue with.
*/

export const DELAY_FAULTS = ["none", "team", "ground"] as const;

/*
|--------------------------------------------------------------------------
| Defaults for a brand new ground
|--------------------------------------------------------------------------
|
| bufferMatchMinutes is 30 rather than 15 because cricket needs it: twenty
| two players and their kit have to clear, the stumps and creases have to
| be reset, and the next side wants a knock before their slot. Fifteen
| minutes looks fine on a screen and does not survive a real Sunday.
|
| It costs the owner real inventory, though - on a 6am-10pm day of
| three-hour blocks, 30 minutes of buffer fits four matches where 15
| minutes fits five - so the add-ground screen shows that number as they
| choose, and they can move it.
|
| bufferNetMinutes is 5 because a net changeover is one person walking out
| and another walking in. Thirty minutes there would throw away three
| bookable hours a day for nothing.
*/

export const GROUND_DEFAULTS = {
  bufferMatchMinutes: 30,
  bufferNetMinutes: 5,

  /* Late by this much or less and nothing happens to anybody. */
  graceMinutes: 15,

  /* Overtime is billed at this multiple of the slot's hourly rate. */
  overtimeMultiplier: 1.5,

  /* Free cancellation up to this many hours before the slot. */
  cancellationCutoffHours: 6,

  /* An unanswered request releases the slot after this long. */
  requestExpiryHours: 12,
} as const;

/*
|--------------------------------------------------------------------------
| Discovery
|--------------------------------------------------------------------------
*/

export const DISTANCE_OPTIONS_KM = [5, 10, 25, 50] as const;

export const GROUND_SORTS = [
  { key: "distance", label: "Nearest" },
  { key: "price", label: "Cheapest" },
  { key: "rating", label: "Top rated" },
  { key: "hygiene", label: "Cleanest" },
  { key: "reliability", label: "Most reliable" },
] as const;

export const GROUND_SORT_KEYS = GROUND_SORTS.map((s) => s.key);

/*
| Day and night are worked out from the slot's start hour rather than
| stored, so a ground never has to declare it and can never contradict
| itself.
*/

export const NIGHT_START_HOUR = 17; /* 5 PM onwards counts as night */

export const DAY_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/* Saturday and Sunday are charged at the weekend rate. */
export const WEEKEND_DAYS = [0, 6];
