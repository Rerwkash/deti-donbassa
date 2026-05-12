import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { env } from "@/lib/env";
import { TelegramAccountToken } from "@/lib/types";

type SendTelegramCodeResult = {
  pendingSession: string;
  phoneNumber: string;
  phoneCodeHash: string;
  isCodeViaApp: boolean;
};

type CompleteTelegramCodeResult =
  | {
      status: "connected";
      account: TelegramAccountToken;
    }
  | {
      status: "password_required";
      pendingSession: string;
      phoneNumber: string;
    };

type RpcLikeError = {
  errorMessage?: string;
  message?: string;
  seconds?: number;
};

function apiCredentials() {
  return {
    apiId: env.TELEGRAM_API_ID,
    apiHash: env.TELEGRAM_API_HASH,
  };
}

function createTelegramUserClient(session = "") {
  return new TelegramClient(new StringSession(session), env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, {
    connectionRetries: 3,
  });
}

function savedSession(client: TelegramClient): string {
  return (client.session as StringSession).save();
}

async function withTelegramUserClient<T>(
  session: string | undefined,
  handler: (client: TelegramClient) => Promise<T>,
): Promise<T> {
  const client = createTelegramUserClient(session);
  try {
    await client.connect();
    return await handler(client);
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

export async function withTelegramAccountClient<T>(
  account: TelegramAccountToken,
  handler: (client: TelegramClient) => Promise<T>,
): Promise<T> {
  return withTelegramUserClient(account.session, handler);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "errorMessage" in error) {
    return String((error as RpcLikeError).errorMessage ?? "");
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as RpcLikeError).message ?? "");
  }

  return "";
}

function normalizePhoneNumber(phoneNumber: string): string {
  const cleaned = phoneNumber.replace(/[^\d+]/g, "").trim();
  if (!cleaned) {
    return "";
  }

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  return `+${cleaned}`;
}

function displayNameForUser(user: Api.User, fallback: string): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return fullName || user.username || fallback;
}

function accountFromUser(client: TelegramClient, user: Api.User, phoneNumber: string): TelegramAccountToken {
  return {
    session: savedSession(client),
    phoneNumber: user.phone ? `+${user.phone}` : phoneNumber,
    userId: user.id.toString(),
    username: user.username ?? undefined,
    displayName: displayNameForUser(user, phoneNumber),
    connectedAt: new Date().toISOString(),
  };
}

function mapTelegramAuthError(error: unknown): Error {
  const code = errorCode(error);

  if (code === "PHONE_NUMBER_INVALID") {
    return new Error("Номер телефона выглядит неверно. Попробуй еще раз через кнопку отправки номера.");
  }

  if (code === "PHONE_NUMBER_FLOOD" || code === "PHONE_NUMBER_BANNED") {
    return new Error("Telegram не дает отправить код на этот номер. Попробуй другой аккаунт.");
  }

  if (code === "PHONE_CODE_INVALID") {
    return new Error("Код неверный. Пришли код еще раз одним сообщением.");
  }

  if (code === "PHONE_CODE_EXPIRED") {
    return new Error("Код уже истек. Нажми «Подключить Telegram» и запроси новый.");
  }

  if (code === "PASSWORD_HASH_INVALID") {
    return new Error("Пароль 2FA неверный. Попробуй еще раз.");
  }

  if (code === "SESSION_PASSWORD_NEEDED") {
    return new Error("Для этого аккаунта включен пароль 2FA.");
  }

  if (code.startsWith("FLOOD_WAIT")) {
    const waitMatch = code.match(/FLOOD_WAIT_(\d+)/);
    const seconds = waitMatch ? Number(waitMatch[1]) : undefined;
    if (seconds && Number.isFinite(seconds)) {
      const minutes = Math.ceil(seconds / 60);
      return new Error(`Telegram просит подождать ${minutes} мин. перед следующим запросом.`);
    }

    return new Error("Telegram временно ограничил попытки входа. Попробуй позже.");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Не удалось подключить Telegram-аккаунт.");
}

export async function sendTelegramLoginCode(phoneNumberInput: string): Promise<SendTelegramCodeResult> {
  const phoneNumber = normalizePhoneNumber(phoneNumberInput);
  if (!phoneNumber) {
    throw new Error("Не удалось распознать номер телефона. Отправь номер еще раз через кнопку.");
  }

  try {
    return await withTelegramUserClient(undefined, async (client) => {
      const result = await client.sendCode(apiCredentials(), phoneNumber);
      return {
        pendingSession: savedSession(client),
        phoneNumber,
        phoneCodeHash: result.phoneCodeHash,
        isCodeViaApp: result.isCodeViaApp,
      };
    });
  } catch (error) {
    throw mapTelegramAuthError(error);
  }
}

export async function completeTelegramLoginWithCode(params: {
  pendingSession: string;
  phoneNumber: string;
  phoneCodeHash: string;
  phoneCode: string;
}): Promise<CompleteTelegramCodeResult> {
  try {
    return await withTelegramUserClient(params.pendingSession, async (client) => {
      try {
        const result = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: params.phoneNumber,
            phoneCodeHash: params.phoneCodeHash,
            phoneCode: params.phoneCode.trim(),
          }),
        );

        if (result instanceof Api.auth.AuthorizationSignUpRequired) {
          throw new Error("На этом номере нет Telegram-аккаунта. Нужен уже существующий аккаунт.");
        }

        const me = await client.getMe();
        if (!(me instanceof Api.User)) {
          throw new Error("Telegram не вернул данные аккаунта после входа.");
        }

        return {
          status: "connected",
          account: accountFromUser(client, me, params.phoneNumber),
        };
      } catch (error) {
        if (errorCode(error) === "SESSION_PASSWORD_NEEDED") {
          return {
            status: "password_required",
            pendingSession: savedSession(client),
            phoneNumber: params.phoneNumber,
          };
        }

        throw error;
      }
    });
  } catch (error) {
    throw mapTelegramAuthError(error);
  }
}

export async function completeTelegramLoginWithPassword(params: {
  pendingSession: string;
  phoneNumber: string;
  password: string;
}): Promise<TelegramAccountToken> {
  try {
    return await withTelegramUserClient(params.pendingSession, async (client) => {
      await client.signInWithPassword(apiCredentials(), {
        password: async () => params.password,
        onError: async (error) => {
          throw error;
        },
      });

      const me = await client.getMe();
      if (!(me instanceof Api.User)) {
        throw new Error("Telegram не вернул данные аккаунта после входа.");
      }

      return accountFromUser(client, me, params.phoneNumber);
    });
  } catch (error) {
    throw mapTelegramAuthError(error);
  }
}
