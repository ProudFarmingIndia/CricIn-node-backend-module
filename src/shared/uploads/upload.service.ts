import cloudinary from "./cloudinary";

export const uploadFile = async (
  file: Express.Multer.File,
  folder: string
) => {
  const base64 = Buffer.from(
    file.buffer
  ).toString("base64");

  const dataURI =
    `data:${file.mimetype};base64,${base64}`;

  const result =
    await cloudinary.uploader.upload(
      dataURI,
      {
        folder,
        resource_type: "auto",
      }
    );

  return result;
};