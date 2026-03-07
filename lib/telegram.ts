import { env } from "@/lib/env";

type TelegramReplyMarkup = Record<string, unknown>;

type SendMessageOptions = {
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramReplyMarkup;
  parseMode?: "HTML" | "MarkdownV2";
};

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: SendMessageOptions = {},
): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: options.disableWebPagePreview ?? true,
      reply_markup: options.replyMarkup,
      parse_mode: options.parseMode,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`);
  }
}

export async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram answerCallbackQuery failed: ${response.status} ${body}`);
  }
}
