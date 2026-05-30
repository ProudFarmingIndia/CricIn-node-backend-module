import { Request, Response } from "express";
import { loginWithPhone } from "./auth.service";

export const login = async (
  req: Request,
  res: Response
) => {
  try {
    const { phone, otp } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number required",
      });
    }

    const result = await loginWithPhone(
      phone,
      otp
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};