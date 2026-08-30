import mongoose from "mongoose";

import { NOTIFICATION_TYPES } from "./notification.types";

const notificationSchema = new mongoose.Schema(
  {
    /*
      |--------------------------------------------------------------------------
      | Receiver
      |--------------------------------------------------------------------------
      |
      | User who will receive this notification.
      |
      */

    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
      |--------------------------------------------------------------------------
      | Actor
      |--------------------------------------------------------------------------
      |
      | User who performed the action.
      |
      | Example:
      | Captain invited Player
      |
      */

    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /*
      |--------------------------------------------------------------------------
      | Type
      |--------------------------------------------------------------------------
      */

    type: {
      type: String,

      enum: Object.values(NOTIFICATION_TYPES),

      required: true,

      index: true,
    },

    /*
      |--------------------------------------------------------------------------
      | Title
      |--------------------------------------------------------------------------
      */

    title: {
      type: String,
      required: true,
      trim: true,
    },

    /*
      |--------------------------------------------------------------------------
      | Message
      |--------------------------------------------------------------------------
      */

    message: {
      type: String,
      required: true,
      trim: true,
    },

    /*
      |--------------------------------------------------------------------------
      | Data
      |--------------------------------------------------------------------------
      |
      | Dynamic payload.
      |
      | Team Invitation
      | Match
      | Tournament
      | Ground
      |
      */

    data: {
      type: Object,
      default: {},
    },

    /*
      |--------------------------------------------------------------------------
      | Read Status
      |--------------------------------------------------------------------------
      */

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    /*
      |--------------------------------------------------------------------------
      | Deleted
      |--------------------------------------------------------------------------
      */

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

notificationSchema.index({
  receiverId: 1,
  isRead: 1,
  createdAt: -1,
});

notificationSchema.index({
  receiverId: 1,
  type: 1,
});

notificationSchema.index({
  actorId: 1,
});

notificationSchema.index({
  createdAt: -1,
});

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
