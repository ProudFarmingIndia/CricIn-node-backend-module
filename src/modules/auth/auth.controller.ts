import { Request, Response } from "express";

import { HTTP_STATUS } from "../../shared/constants/httpStatus";

import {
  sendOtpService,
  verifyOtpService,
  resendOtpService,
  getOtpMode,
} from "./auth.service";

/*
|--------------------------------------------------------------------------
| Auth Controller
|--------------------------------------------------------------------------
|
| WHY THE try/catch BLOCKS ARE GONE
|
| Every handler used to wrap its call and return 400 on any failure:
|
|     catch (error) { return res.status(400).json({ ... }) }
|
| That flattened everything into one status. A rate limit came back as 400
| instead of 429, so the app could not tell "you are going too fast, wait"
| apart from "that number is wrong" - and a genuine server fault came back
| as 400 too, which says the CLIENT sent something bad when it did not.
|
| Express 5 forwards a rejected promise from an async handler to the global
| error handler in app.ts, which already renders AppError's own statusCode
| and message as { success, message }. Throwing is the error path. Adding a
| catch here would only downgrade a precise status to a vague one.
|
| WHERE THE IP COMES FROM
|
| req.ip is only trustworthy if Express knows it is behind a proxy. Render
| terminates TLS and forwards, so without `app.set("trust proxy", 1)` in
| app.ts every request appears to come from Render's own load balancer -
| one address for all users, which would rate-limit your entire user base
| as if it were a single device. See the note in the handover.
|
*/

const clientIp = (req: Request): string | undefined =>
  (req.ip ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress) ??
  undefined;

/*
|--------------------------------------------------------------------------
| Which OTP mode is this server actually in?
|--------------------------------------------------------------------------
|
| Exists because the answer was previously unknowable from outside. `.env`
| is gitignored so it never reaches the host, the host sets its own
| NODE_ENV=production, and the fixed-code guard then turned itself off
| silently - leaving an APK asking for a real OTP while the laptop happily
| accepted 123456.
|
| Open this in a browser against whichever server the app points at and it
| says which mode that server is in. No auth, because the whole point is to
| check it before you can log in.
|
| Returns no code and no credential - see the note on getOtpMode.
*/

export const otpMode = async (_req: Request, res: Response) => {
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    ...getOtpMode(),
  });
};

export const sendOtp = async (req: Request, res: Response) => {
  const { phone, countryCode } = req.body || {};

  const result = await sendOtpService(phone, countryCode, clientIp(req));

  return res.status(HTTP_STATUS.OK).json(result);
};

export const resendOtp = async (req: Request, res: Response) => {
  const { phone, countryCode } = req.body || {};

  const result = await resendOtpService(phone, countryCode, clientIp(req));

  return res.status(HTTP_STATUS.OK).json(result);
};

export const verifyOtp = async (req: Request, res: Response) => {
  const { phone, otp, countryCode } = req.body || {};

  const result = await verifyOtpService(phone, otp, countryCode);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result,
  });
};
