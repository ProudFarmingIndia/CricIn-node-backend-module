import axios from "axios";

export const sendOtpSMS = async (phone: string, otp: string) => {
  try {
    const payload = {
      template_id: process.env.MSG91_TEMPLATE_ID,

      sender: process.env.MSG91_SENDER_ID,

      mobiles: `91${phone}`,

      OTP: otp,
    };

    const response = await axios.post(
      "https://control.msg91.com/api/v5/flow/",
      payload,
      {
        headers: {
          authkey: process.env.MSG91_AUTH_KEY,
          "Content-Type": "application/json",
        },
      },
    );

    return response.data;
  } catch (error: any) {
    console.error("MSG91 Error:", error?.response?.data || error.message);

    throw new Error("Failed to send OTP");
  }
};
