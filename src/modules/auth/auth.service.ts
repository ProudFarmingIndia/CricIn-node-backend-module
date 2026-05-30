import jwt from "jsonwebtoken";
import User from "../users/user.model";

export const loginWithPhone = async (
  phone: string,
  otp: string
) => {
  if (otp !== "1234") {
    throw new Error("Invalid OTP");
  }

  let user = await User.findOne({ phone });

  if (!user) {
    user = await User.create({
      phone,
    });
  }

  const token = jwt.sign(
    {
      userId: user._id,
      phone: user.phone,
    },
    process.env.JWT_SECRET as string,
    {
      expiresIn: "30d",
    }
  );

  return {
    token,
    user,
  };
};