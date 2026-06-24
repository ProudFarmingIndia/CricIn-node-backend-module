import {
  Request,
  Response,
} from "express";

import * as UploadService
from "./upload.service";

export const uploadImage =
  async (
    req: Request & { file?: Express.Multer.File },
    res: Response
  ) => {

    try {

      if (!req.file) {

        return res
          .status(400)
          .json({
            success: false,
            message:
              "File required",
          });

      }

      const result =
        await UploadService.uploadFile(
          req.file,
          "cricin/images"
        );

      return res
        .status(200)
        .json({
          success: true,
          url:
            result.secure_url,
        });

    } catch (error: any) {

      return res
        .status(500)
        .json({
          success: false,
          message:
            error.message,
        });

    }
  };

export const uploadVideo =
  async (
    req: Request & { file?: Express.Multer.File },
    res: Response
  ) => {

    try {

      if (!req.file) {

        return res
          .status(400)
          .json({
            success: false,
            message:
              "File required",
          });

      }

      const result =
        await UploadService.uploadFile(
          req.file,
          "cricin/videos"
        );

      return res
        .status(200)
        .json({
          success: true,
          url:
            result.secure_url,
        });

    } catch (error: any) {

      return res
        .status(500)
        .json({
          success: false,
          message:
            error.message,
        });

    }
  };