/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Shared
|
| File:
| streamKeyCrypto.ts
|
| Description:
| Encrypts the Mux stream key before it touches the database.
|
| A stream key is a broadcast credential, not an identifier: anyone
| holding it can push video onto that match's live stream, and viewers
| would have no way to tell it wasn't the real camera. Storing it in
| plain text means one leaked DB dump lets a stranger broadcast onto
| someone else's match.
|
| AES-256-GCM rather than CBC because GCM authenticates the ciphertext -
| a tampered value fails to decrypt instead of silently returning
| garbage that then gets handed to a broadcaster.
|
| .env:
|   ENCRYPTION_SECRET=<32+ char random string>
|
| Generate:
|   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
|
|--------------------------------------------------------------------------
*/

import crypto from "crypto";

const ALGO = "aes-256-gcm";

const getKey = (): Buffer => {
  const secret = process.env.ENCRYPTION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "ENCRYPTION_SECRET is missing or shorter than 32 characters",
    );
  }

  /*
  | sha256 always yields the 32 bytes AES-256 needs, whatever length the
  | configured secret happens to be.
  */

  return crypto.createHash("sha256").update(secret).digest();
};

export const encrypt = (plainText: string): string => {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);

  const enc = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    tag.toString("hex"),
    enc.toString("hex"),
  ].join(":");
};

export const decrypt = (payload: string): string => {
  const [ivHex, tagHex, dataHex] = String(payload).split(":");

  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Encrypted stream key is malformed");
  }

  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivHex, "hex"),
  );

  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
};
