import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

type StatePayload = {
  telegramId: string;
  issuedAt: number;
};

function sign(payload: string): string {
  return createHmac("sha256", env.APP_SECRET).update(payload).digest("hex");
}

export function createSignedState(input: { telegramId: string }): string {
  const payload = JSON.stringify({ telegramId: input.telegramId, issuedAt: Date.now() } satisfies StatePayload);
  const encoded = Buffer.from(payload, "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function readState(state: string): StatePayload | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = sign(encoded);
  if (signature.length !== expected.length) {
    return null;
  }

  const valid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as StatePayload;
  if (Date.now() - payload.issuedAt > 1000 * 60 * 15) {
    return null;
  }

  return payload;
}
