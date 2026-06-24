import { Request, Response }
from "express";

import {
  sendOtpService,
  verifyOtpService,
} from "./auth.service";

export const sendOtp =
async (
  req: Request,
  res: Response
) => {

  try {

    const { phone } =
      req.body;

    const result =
      await sendOtpService(
        phone
      );

    return res.status(200)
      .json(result);

  } catch(error:any){

    return res.status(400)
      .json({
        success:false,
        message:error.message,
      });

  }

};

export const verifyOtp =
async (
  req: Request,
  res: Response
) => {

  try {

    const {
      phone,
      otp,
    } = req.body;

    const result =
      await verifyOtpService(
        phone,
        otp
      );

    return res.status(200)
      .json({
        success:true,
        data:result,
      });

  } catch(error:any){

    return res.status(400)
      .json({
        success:false,
        message:error.message,
      });

  }

};

export const resendOtp =
  async (
    req: Request,
    res: Response
  ) => {

    try {

      const { phone } =
        req.body;

      const result =
        await sendOtpService(
          phone
        );

      return res
        .status(200)
        .json(result);

    } catch (
      error: any
    ) {

      return res
        .status(400)
        .json({
          success:
            false,
          message:
            error.message,
        });

    }
  };