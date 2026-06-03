import mongoose from "mongoose";

const groundSchema =
  new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      groundName: {
        type: String,
        required: true,
        trim: true,
      },

      address: {
        type: String,
        default: "",
      },

      city: {
        type: String,
        default: "",
      },

      state: {
        type: String,
        default: "",
      },

      pincode: {
        type: String,
        default: "",
      },

      latitude: {
        type: Number,
        default: null,
      },

      longitude: {
        type: Number,
        default: null,
      },

      contactPerson: {
        type: String,
        default: "",
      },

      contactNumber: {
        type: String,
        default: "",
      },

      totalPitches: {
        type: Number,
        default: 1,
      },

      facilities: [
        {
          type: String,
        },
      ],

      image: {
        type: String,
        default: "",
      },

      isActive: {
        type: Boolean,
        default: true,
      },
    },
    {
      timestamps: true,
    }
  );

const Ground =
  mongoose.model(
    "Ground",
    groundSchema
  );

export default Ground;