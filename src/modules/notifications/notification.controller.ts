import { Response } from "express";

import { AuthRequest } from "../../shared/middleware/auth.middleware";

import * as NotificationService from "./notification.service";

/*
|--------------------------------------------------------------------------
| Get Notifications
|--------------------------------------------------------------------------
*/

export const getNotifications = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { type, isRead } = req.query;

    const notifications =
      await NotificationService.getNotifications(
        req.user.userId,
        {
          type: type as string,

          isRead:
            typeof isRead === "string"
              ? isRead === "true"
              : undefined,
        }
      );

    return res.status(200).json({
      success: true,

      data: notifications,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Failed to fetch notifications.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Get Unread Count
|--------------------------------------------------------------------------
*/

export const getUnreadCount = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const count =
      await NotificationService.getUnreadCount(
        req.user.userId
      );

    return res.status(200).json({
      success: true,

      data: {
        unreadCount: count,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Failed to fetch unread count.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Mark Notification As Read
|--------------------------------------------------------------------------
*/

export const markAsRead = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const notification =
      await NotificationService.markAsRead(
        req.params.id as string,
        req.user.userId,
      );

    return res.status(200).json({
      success: true,

      message:
        "Notification marked as read.",

      data: notification,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Unable to update notification.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Mark All Notifications As Read
|--------------------------------------------------------------------------
*/

export const markAllAsRead = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    await NotificationService.markAllAsRead(
      req.user.userId
    );

    return res.status(200).json({
      success: true,

      message:
        "All notifications marked as read.",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Unable to update notifications.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Delete Notification
|--------------------------------------------------------------------------
*/

export const deleteNotification = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    await NotificationService.deleteNotification(
      req.params.id as string,
      req.user.userId,
    );

    return res.status(200).json({
      success: true,

      message:
        "Notification deleted successfully.",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Unable to delete notification.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Mark Many As Read
|--------------------------------------------------------------------------
|
| Bulk counterpart for the notification screen's multi-select. Doing this
| as N single requests from the client would be N round trips and N
| re-renders for one user action.
|
*/

export const markManyAsRead = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const result = await NotificationService.markManyAsRead(
      req.user.userId,
      req.body?.ids,
    );

    return res.status(200).json({
      success: true,
      message: "Notifications marked as read.",
      data: result,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Unable to update notifications.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Delete Many
|--------------------------------------------------------------------------
*/

export const deleteMany = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const result = await NotificationService.deleteMany(
      req.user.userId,
      req.body?.ids,
    );

    return res.status(200).json({
      success: true,
      message: "Notifications deleted.",
      data: result,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Unable to delete notifications.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Delete All Notifications
|--------------------------------------------------------------------------
*/

export const deleteAllNotifications =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      await NotificationService.deleteAllNotifications(
        req.user.userId
      );

      return res.status(200).json({
        success: true,

        message:
          "All notifications deleted successfully.",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,

        message:
          error.message ||
          "Unable to delete notifications.",
      });
    }
  };