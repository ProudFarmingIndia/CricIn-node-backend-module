import Notification from "./notification.model";

export const createNotification =
  async (
    userId: string,
    payload: any
  ) => {

    return await Notification.create({
      ...payload,
      userId,
    });
  };

export const getNotifications =
  async (
    userId: string
  ) => {

    return await Notification.find({
      userId,
    }).sort({
      createdAt: -1,
    });
  };

export const markAsRead =
  async (
    notificationId: string
  ) => {

    return await Notification.findByIdAndUpdate(
      notificationId,
      {
        isRead: true,
      },
      {
        new: true,
      }
    );
  };

export const markAllAsRead =
  async (
    userId: string
  ) => {

    return await Notification.updateMany(
      {
        userId,
        isRead: false,
      },
      {
        isRead: true,
      }
    );
  };

export const deleteNotification =
  async (
    notificationId: string
  ) => {

    return await Notification.findByIdAndDelete(
      notificationId
    );
  };