import cloudinary from "../../config/cloudinary";

interface UploadResponse {
  url: string;
  publicId: string;
  resourceType: string;
  format?: string;
  width?: number;
  height?: number;
  duration?: number;
  bytes?: number;
  originalFilename?: string;
}

export const uploadFile = async (
  file: Express.Multer.File,
  folder: string
): Promise<UploadResponse> => {
  if (!file) {
    throw new Error("No file received.");
  }

  const base64 = Buffer.from(file.buffer).toString("base64");

  const dataURI = `data:${file.mimetype};base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataURI, {
    folder,
    resource_type: "auto",
    overwrite: false,
    unique_filename: true,
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    format: result.format,
    width: result.width,
    height: result.height,
    duration: result.duration,
    bytes: result.bytes,
    originalFilename: file.originalname,
  };
};

export const uploadMultipleFiles = async (
  files: Express.Multer.File[],
  folder: string
): Promise<UploadResponse[]> => {
  if (!files || files.length === 0) {
    return [];
  }

  const uploads = await Promise.all(
    files.map((file) => uploadFile(file, folder))
  );

  return uploads;
};

export const deleteFile = async (
  publicId: string
) => {
  if (!publicId) {
    throw new Error("publicId is required.");
  }

  return await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
  });
};

export const deleteVideo = async (
  publicId: string
) => {
  if (!publicId) {
    throw new Error("publicId is required.");
  }

  return await cloudinary.uploader.destroy(publicId, {
    resource_type: "video",
  });
};