import { Response } from "express";

import { AuthRequest }
from "../../shared/middleware/auth.middleware";

import * as NotificationService
from "./notification.service";

export const createNotification =
async (
  req: AuthRequest,
  res: Response
) => {

  const notification =
    await NotificationService.createNotification(
      req.user.userId,
      req.body
    );

  res.status(201).json({
    success: true,
    data: notification,
  });
};

export const getNotifications =
async (
  req: AuthRequest,
  res: Response
) => {

  const notifications =
    await NotificationService.getNotifications(
      req.user.userId
    );

  res.status(200).json({
    success: true,
    data: notifications,
  });
};

export const markAsRead =
async (
  req: AuthRequest,
  res: Response
) => {

  const notification =
    await NotificationService.markAsRead(
      req.params.id as string
    );

  res.status(200).json({
    success: true,
    data: notification,
  });
};

export const markAllAsRead =
async (
  req: AuthRequest,
  res: Response
) => {

  await NotificationService.markAllAsRead(
    req.user.userId
  );

  res.status(200).json({
    success: true,
    message:
      "All notifications marked as read",
  });
};

export const deleteNotification =
async (
  req: AuthRequest,
  res: Response
) => {

  await NotificationService.deleteNotification(
    req.params.id as string
  );

  res.status(200).json({
    success: true,
    message:
      "Notification deleted",
  });
};