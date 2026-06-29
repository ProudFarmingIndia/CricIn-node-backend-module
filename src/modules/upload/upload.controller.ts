import { Request, Response } from "express";

import * as UploadService from "./upload.service";

export const uploadImage = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Image is required.",
      });
    }

    const folder =
      (req.body.folder as string) ||
      "players/profile";

    const media =
      await UploadService.uploadFile(
        req.file,
        folder
      );

    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully.",
      data: media,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const uploadVideo = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Video is required.",
      });
    }

    const folder =
      (req.body.folder as string) ||
      "players/gallery";

    const media =
      await UploadService.uploadFile(
        req.file,
        folder
      );

    return res.status(200).json({
      success: true,
      message: "Video uploaded successfully.",
      data: media,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const uploadMultiple = async (
  req: Request,
  res: Response
) => {
  try {
    const files =
      req.files as Express.Multer.File[];

    if (!files?.length) {
      return res.status(400).json({
        success: false,
        message: "Files are required.",
      });
    }

    const folder =
      (req.body.folder as string) ||
      "players/gallery";

    const media =
      await UploadService.uploadMultipleFiles(
        files,
        folder
      );

    return res.status(200).json({
      success: true,
      message:
        "Files uploaded successfully.",
      data: media,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteMedia = async (
  req: Request,
  res: Response
) => {
  try {
    const { publicId, type } = req.body;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: "publicId required.",
      });
    }

    if (type === "VIDEO") {
      await UploadService.deleteVideo(
        publicId
      );
    } else {
      await UploadService.deleteFile(
        publicId
      );
    }

    return res.status(200).json({
      success: true,
      message:
        "Media deleted successfully.",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};