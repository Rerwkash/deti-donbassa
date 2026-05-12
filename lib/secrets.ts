import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const ENCRYPTION_PREFIX = "enc_v1";
const IV_LENGTH = 12;

function sessionKey(): Buffer {
  const secret = env.TELEGRAM_SESSION_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("Missing environment variable: TELEGRAM_SESSION_ENCRYPTION_KEY");
  }

  return createHash("sha256").update(secret).digest();
}

export function encryptTelegramSession(session: string): string {
  if (!session) {
    return session;
  }

  if (session.startsWith(`${ENCRYPTION_PREFIX}.`)) {
    return session;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(session, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptTelegramSession(value: string): string {
  if (!value) {
    return value;
  }

  if (!value.startsWith(`${ENCRYPTION_PREFIX}.`)) {
    return value;
  }

  const parts = value.split(".");
  if (parts.length !== 4) {
    throw new Error("Telegram session ciphertext has invalid format");
  }

  const [, ivEncoded, tagEncoded, dataEncoded] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    sessionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataEncoded, "base64url")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
