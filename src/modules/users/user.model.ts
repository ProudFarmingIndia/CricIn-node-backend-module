import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
    },

    fullName: {
      type: String,
      default: "",
    },

    profileImage: {
      type: String,
      default: "",
    },

    role: {
      type: String,
      enum: [
        "user",
        "player",
        "captain",
        "ground_owner",
        "shop_owner",
        "admin",
      ],
      default: "user",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: { type: String, default: null },
    otpExpiry: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

const User = mongoose.model("User", userSchema);

export default User;
