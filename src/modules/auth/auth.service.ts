import jwt, { Secret } from "jsonwebtoken";
import User from "../users/user.model";
// import { sendOtpSMS } from "./msg91.service";
// import { generateOtp } from "./utils/otp";

export const sendOtpService = async (phone: string) => {
  if (!phone) {
    throw new Error("Phone number is required");
  }

  phone = phone.trim();

  if (phone.length !== 10 || !/^\d+$/.test(phone)) {
    throw new Error("Invalid phone number");
  }

  // const otp = generateOtp();
  const otp = "123456";

  const expiry = new Date(Date.now() + 5 * 60 * 1000);

  let user = await User.findOne({
    phone,
  });

  if (!user) {
    user = await User.create({
      phone,
      otp,
      otpExpiry: expiry,
    });
  } else {
    user.otp = otp;

    user.otpExpiry = expiry;

    await user.save();
  }

  console.log(
  `[DEV OTP] ${phone}: ${otp}`
);

  try {
    // await sendOtpSMS(phone, otp);
  } catch (error) {
    console.error("MSG91 Error:", error);

    throw new Error("Failed to send OTP22");
  }

  return {
    success: true,
    message: "OTP sent successfully",
  };
};

export const verifyOtpService = async (phone: string, otp: string) => {
  let user = await User.findOne({
    phone,
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.otp !== otp) {
    throw new Error("Invalid OTP");
  }

  if (!user.otpExpiry || user.otpExpiry < new Date()) {
    throw new Error("OTP expired");
  }

  user.isVerified = true;

  user.otp = null;

  user.otpExpiry = null;

  user.lastLoginAt = new Date();

  await user.save();

  const secret = process.env.JWT_ACCESS_SECRET as string;

  const token = jwt.sign(
    {
      userId: String(user._id),
      phone: user.phone,
    },
    secret,
    {
      expiresIn: "30d",
    },
  );

  return {
    token,
    user,
  };
};
