import { env } from "@/lib/env";

type TelegramReplyMarkup = Record<string, unknown>;
type TelegramParseMode = "HTML" | "MarkdownV2";

type SendMessageOptions = {
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramReplyMarkup;
  parseMode?: TelegramParseMode;
};

type SendMediaOptions = {
  caption?: string;
  parseMode?: TelegramParseMode;
  disableWebPagePreview?: boolean;
};

type SendMediaGroupItem = {
  type: "photo" | "video";
  media: string;
  caption?: string;
  parse_mode?: TelegramParseMode;
};

async function telegramRequest(method: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram ${method} failed: ${response.status} ${text}`);
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: SendMessageOptions = {},
): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
    reply_markup: options.replyMarkup,
    parse_mode: options.parseMode,
  });
}

export async function sendTelegramPhoto(chatId: string, photoUrl: string, options: SendMediaOptions = {}): Promise<void> {
  await telegramRequest("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption: options.caption,
    parse_mode: options.parseMode,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
  });
}

export async function sendTelegramVideo(chatId: string, videoUrl: string, options: SendMediaOptions = {}): Promise<void> {
  await telegramRequest("sendVideo", {
    chat_id: chatId,
    video: videoUrl,
    caption: options.caption,
    parse_mode: options.parseMode,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
    supports_streaming: true,
  });
}

export async function sendTelegramMediaGroup(
  chatId: string,
  media: SendMediaGroupItem[],
): Promise<void> {
  await telegramRequest("sendMediaGroup", {
    chat_id: chatId,
    media,
  });
}

export async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
  });
}
