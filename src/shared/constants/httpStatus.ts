/*
|--------------------------------------------------------------------------
| HTTP Status Codes
|--------------------------------------------------------------------------
*/

export const HTTP_STATUS = {
  OK: 200,

  CREATED: 201,

  BAD_REQUEST: 400,

  UNAUTHORIZED: 401,

  FORBIDDEN: 403,

  NOT_FOUND: 404,

  CONFLICT: 409,

  UNPROCESSABLE_ENTITY: 422,

  /*
  | Used by the live-stream viewer cap. 429 rather than 403 because the
  | refusal is temporary and about load, not permission - the app can
  | honestly say "try again in a bit" instead of "you are not allowed".
  */

  TOO_MANY_REQUESTS: 429,

  INTERNAL_SERVER_ERROR: 500,
} as const;