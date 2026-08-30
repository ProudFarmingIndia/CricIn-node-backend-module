import { Router } from "express";

import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  markManyAsRead,
  deleteMany,
} from "./notification.controller";

import {
  authMiddleware,
} from "../../shared/middleware/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Notifications
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  authMiddleware,
  getNotifications
);

router.get(
  "/unread-count",
  authMiddleware,
  getUnreadCount
);

router.put(
  "/:id/read",
  authMiddleware,
  markAsRead
);

router.put(
  "/read-all",
  authMiddleware,
  markAllAsRead
);

/*
| Bulk actions for multi-select. Registered BEFORE "/:id" so the literal
| paths are not swallowed by the parameterised route.
*/

router.put(
  "/read-many",
  authMiddleware,
  markManyAsRead
);

router.delete(
  "/many",
  authMiddleware,
  deleteMany
);

router.delete(
  "/:id",
  authMiddleware,
  deleteNotification
);

router.delete(
  "/",
  authMiddleware,
  deleteAllNotifications
);

export default router;