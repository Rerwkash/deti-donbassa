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

type TelegramUpload = {
  filename: string;
  data: Uint8Array;
  mimeType?: string;
};

type SendMediaGroupItem = {
  type: "photo" | "video";
  media: string | TelegramUpload;
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

async function telegramMultipartRequest(method: string, formData: FormData): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram ${method} failed: ${response.status} ${text}`);
  }
}

function toUpload(media: string | TelegramUpload): TelegramUpload | null {
  return typeof media === "string" ? null : media;
}

function appendUpload(formData: FormData, fieldName: string, upload: TelegramUpload) {
  const blob = new Blob([upload.data], {
    type: upload.mimeType ?? "application/octet-stream",
  });
  formData.append(fieldName, blob, upload.filename);
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

export async function sendTelegramPhoto(
  chatId: string,
  photo: string | TelegramUpload,
  options: SendMediaOptions = {},
): Promise<void> {
  const upload = toUpload(photo);
  if (upload) {
    const formData = new FormData();
    formData.set("chat_id", chatId);
    formData.set("caption", options.caption ?? "");
    if (options.parseMode) {
      formData.set("parse_mode", options.parseMode);
    }
    formData.set("disable_web_page_preview", String(options.disableWebPagePreview ?? true));
    appendUpload(formData, "photo", upload);
    await telegramMultipartRequest("sendPhoto", formData);
    return;
  }

  await telegramRequest("sendPhoto", {
    chat_id: chatId,
    photo,
    caption: options.caption,
    parse_mode: options.parseMode,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
  });
}

export async function sendTelegramVideo(
  chatId: string,
  video: string | TelegramUpload,
  options: SendMediaOptions = {},
): Promise<void> {
  const upload = toUpload(video);
  if (upload) {
    const formData = new FormData();
    formData.set("chat_id", chatId);
    formData.set("caption", options.caption ?? "");
    if (options.parseMode) {
      formData.set("parse_mode", options.parseMode);
    }
    formData.set("disable_web_page_preview", String(options.disableWebPagePreview ?? true));
    formData.set("supports_streaming", "true");
    appendUpload(formData, "video", upload);
    await telegramMultipartRequest("sendVideo", formData);
    return;
  }

  await telegramRequest("sendVideo", {
    chat_id: chatId,
    video,
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
  const hasUploads = media.some((item) => typeof item.media !== "string");
  if (hasUploads) {
    const formData = new FormData();
    formData.set("chat_id", chatId);

    const payload = media.map((item, index) => {
      if (typeof item.media === "string") {
        return item;
      }

      const attachName = `file${index}`;
      appendUpload(formData, attachName, item.media);
      return {
        ...item,
        media: `attach://${attachName}`,
      };
    });

    formData.set("media", JSON.stringify(payload));
    await telegramMultipartRequest("sendMediaGroup", formData);
    return;
  }

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
