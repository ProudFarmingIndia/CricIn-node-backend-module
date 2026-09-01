/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Shared
|
| File:
| AppError.ts
|
| Description:
| Standard application error used across the entire backend.
|
| This allows every module to throw consistent errors with
| proper HTTP status codes.
|
|--------------------------------------------------------------------------
*/

export default class AppError extends Error {
  public readonly statusCode: number;

  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500
  ) {
    super(message);

    this.statusCode = statusCode;

    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}