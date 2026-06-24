import { Router } from "express";

import {
  sendOtp,
  verifyOtp,
  resendOtp,
} from "./auth.controller";

const router = Router();

router.post("/send-otp", sendOtp);

router.post("/verify-otp", verifyOtp);

router.post("/resend-otp", resendOtp);

export default router;