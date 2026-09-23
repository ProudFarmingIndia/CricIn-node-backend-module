import { Router } from "express";

import {
  sendOtp,
  verifyOtp,
  resendOtp,
  otpMode,
} from "./auth.controller";

const router = Router();

/*
| GET /api/auth/mode - which OTP mode this server is in.
|
| A diagnostic, not a feature. It exists because "is the deployed server on
| the fixed code or on real SMS?" had no answer you could get without
| opening the host's log, and getting that wrong is what made a working
| bypass look like a broken login.
|
| Declared first so it cannot be shadowed, and unauthenticated on purpose -
| it is meant to be checked BEFORE you can log in. Safe to delete at launch.
*/

// router.get("/mode", otpMode);

router.post("/send-otp", sendOtp);

router.post("/verify-otp", verifyOtp);

router.post("/resend-otp", resendOtp);

export default router;
