import { listActiveNewsSources, updateNewsSource, upsertNewsSource, upsertUser } from "@/lib/storage";
import { sendTelegramMediaGroup, sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo } from "@/lib/telegram";
import { NewsSourceRecord, ScrapedNewsMedia, ScrapedNewsPost } from "@/lib/types";

const TELEGRAM_HOSTS = new Set(["t.me", "www.t.me", "telegram.me", "www.telegram.me"]);
const NEWS_TIMEZONE = "Europe/Moscow";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return text
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&([a-z]+);/gi, (_, value: string) => named[value] ?? `&${value};`);
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<tg-emoji[^>]*>/gi, "")
      .replace(/<\/tg-emoji>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function formatNewsDate(value?: string): string {
  if (!value) {
    return "без времени";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: NEWS_TIMEZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function previewText(text: string, maxLength = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Пост без текста или только с медиа.";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function chunkArray<T>(items: T[], size: number): T[][]
{
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function splitPlainText(text: string, maxLength = 3800): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength);
    const breakpoints = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")].filter(
      (value) => value > maxLength * 0.5,
    );
    const splitAt = breakpoints[0] ?? maxLength;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

export function normalizeTelegramChannelInput(input: string): { channelSlug: string; url: string; feedUrl: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Пришли ссылку на публичный канал или username.");
  }

  let candidate = trimmed;

  if (candidate.startsWith("@")) {
    candidate = candidate.slice(1);
  } else if (candidate.includes("t.me") || candidate.startsWith("http://") || candidate.startsWith("https://")) {
    const withProtocol = candidate.startsWith("http://") || candidate.startsWith("https://") ? candidate : `https://${candidate}`;
    let parsed: URL;

    try {
      parsed = new URL(withProtocol);
    } catch {
      throw new Error("Ссылка на Telegram-канал выглядит некорректно.");
    }

    if (!TELEGRAM_HOSTS.has(parsed.hostname)) {
      throw new Error("Поддерживаются только ссылки вида t.me/канал.");
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 0) {
      throw new Error("Не удалось определить username канала.");
    }

    if (parts[0] === "s" && parts[1]) {
      candidate = parts[1];
    } else {
      candidate = parts[0];
    }
  }

  if (candidate.startsWith("+") || candidate === "joinchat") {
    throw new Error("Приватные каналы по invite-ссылкам так читать нельзя. Нужен публичный канал.");
  }

  if (!/^[A-Za-z0-9_]{4,}$/.test(candidate)) {
    throw new Error("Нужен публичный username канала, например @durov или https://t.me/durov.");
  }

  return {
    channelSlug: candidate,
    url: `https://t.me/${candidate}`,
    feedUrl: `https://t.me/s/${candidate}`,
  };
}

function extractChannelTitle(html: string): string | undefined {
  const meta = html.match(/<meta property="og:title" content="([^"]+)"/i);
  const header = html.match(/<div class="tgme_channel_info_header_title"[^>]*>([\s\S]*?)<\/div>/i);
  const value = meta?.[1] ?? (header ? stripHtml(header[1]) : "");
  const normalized = value.replace(/^Telegram:\s*Contact\s*/i, "").trim();
  return normalized || undefined;
}

function parseMediaFromBlock(block: string): ScrapedNewsMedia[] {
  const entries: Array<ScrapedNewsMedia & { index: number }> = [];
  const photoRegex = /tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/gi;
  const videoRegex = /<video src="([^"]+)"/gi;

  for (const match of block.matchAll(photoRegex)) {
    entries.push({
      type: "photo",
      url: decodeHtmlEntities(match[1]),
      index: match.index ?? 0,
    });
  }

  for (const match of block.matchAll(videoRegex)) {
    entries.push({
      type: "video",
      url: decodeHtmlEntities(match[1]),
      index: match.index ?? 0,
    });
  }

  const seen = new Set<string>();
  return entries
    .sort((left, right) => left.index - right.index)
    .filter((item) => {
      if (!item.url || seen.has(item.url)) {
        return false;
      }

      seen.add(item.url);
      return true;
    })
    .map(({ index, ...item }) => item);
}

function parsePostsFromHtml(channelSlug: string, html: string): ScrapedNewsPost[] {
  const blocks = html.split('<div class="tgme_widget_message_wrap js-widget_message_wrap">').slice(1);
  const posts: ScrapedNewsPost[] = [];

  for (const block of blocks) {
    const postMatch = block.match(/data-post="[^"/]+\/(\d+)"/i);
    if (!postMatch) {
      continue;
    }

    const postId = Number(postMatch[1]);
    if (!Number.isInteger(postId)) {
      continue;
    }

    const timeMatch = block.match(/<time datetime="([^"]+)"/i);
    const textMatch = block.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/i);
    const text = stripHtml(textMatch?.[1] ?? "");
    const media = parseMediaFromBlock(block);

    posts.push({
      postId,
      postUrl: `https://t.me/${channelSlug}/${postId}`,
      publishedAt: timeMatch?.[1],
      text,
      media,
    });
  }

  return posts
    .sort((left, right) => left.postId - right.postId)
    .filter((post, index, array) => index === 0 || array[index - 1].postId !== post.postId);
}

export async function scrapePublicTelegramChannel(channelSlug: string): Promise<{
  title?: string;
  posts: ScrapedNewsPost[];
}> {
  const response = await fetch(`https://t.me/s/${channelSlug}`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ru,en;q=0.9",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Не удалось открыть канал: ${response.status}`);
  }

  const html = await response.text();
  return {
    title: extractChannelTitle(html),
    posts: parsePostsFromHtml(channelSlug, html),
  };
}

function formatPostHeader(source: NewsSourceRecord, post: ScrapedNewsPost): string {
  return [`<b>${escapeHtml(source.title || `@${source.channelSlug}`)}</b>`, `<a href="${post.postUrl}">${escapeHtml(formatNewsDate(post.publishedAt))}</a>`].join(
    "\n",
  );
}

function buildMediaCaption(source: NewsSourceRecord, post: ScrapedNewsPost): { caption: string; sendTextAfter: boolean } {
  const header = formatPostHeader(source, post);
  if (!post.text.trim()) {
    return {
      caption: header,
      sendTextAfter: false,
    };
  }

  const fullCaption = `${header}\n\n${escapeHtml(post.text)}`;
  if (fullCaption.length <= 1000) {
    return {
      caption: fullCaption,
      sendTextAfter: false,
    };
  }

  return {
    caption: header,
    sendTextAfter: true,
  };
}

async function sendPostText(chatId: string, source: NewsSourceRecord, post: ScrapedNewsPost, includeHeader = true): Promise<number> {
  const chunks = splitPlainText(post.text);
  const sentMessages: string[] = [];

  if (chunks.length === 0) {
    if (includeHeader) {
      sentMessages.push(formatPostHeader(source, post));
    }
  } else {
    chunks.forEach((chunk, index) => {
      if (index === 0 && includeHeader) {
        sentMessages.push(`${formatPostHeader(source, post)}\n\n${escapeHtml(chunk)}`);
      } else {
        sentMessages.push(escapeHtml(chunk));
      }
    });
  }

  let sent = 0;
  for (const message of sentMessages) {
    await sendTelegramMessage(chatId, message, {
      parseMode: "HTML",
      disableWebPagePreview: true,
    });
    sent += 1;
  }

  return sent;
}

async function sendPostMedia(chatId: string, source: NewsSourceRecord, post: ScrapedNewsPost): Promise<number> {
  const media = post.media.slice(0, 10);
  const { caption, sendTextAfter } = buildMediaCaption(source, post);
  let sent = 0;

  if (media.length === 1) {
    const item = media[0];
    if (item.type === "photo") {
      await sendTelegramPhoto(chatId, item.url, {
        caption,
        parseMode: "HTML",
      });
    } else {
      await sendTelegramVideo(chatId, item.url, {
        caption,
        parseMode: "HTML",
      });
    }
    sent += 1;
  } else {
    const groups = chunkArray(media, 10);

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      await sendTelegramMediaGroup(
        chatId,
        group.map((item, index) => ({
          type: item.type,
          media: item.url,
          caption: groupIndex === 0 && index === 0 ? caption : undefined,
          parse_mode: groupIndex === 0 && index === 0 ? "HTML" : undefined,
        })),
      );
      sent += 1;
    }
  }

  if (sendTextAfter) {
    sent += await sendPostText(chatId, source, post, false);
  }

  return sent;
}

async function sendFullNewsPost(source: NewsSourceRecord, post: ScrapedNewsPost): Promise<number> {
  try {
    if (post.media.length > 0) {
      return await sendPostMedia(source.telegramId, source, post);
    }
  } catch (error) {
    console.error(`Media send failed for ${source.channelSlug}/${post.postId}:`, error);
  }

  return sendPostText(source.telegramId, source, post, true);
}

export async function addPublicNewsSource(telegramId: string, input: string): Promise<string> {
  const normalized = normalizeTelegramChannelInput(input);
  await upsertUser(telegramId, (current) => ({ ...current }));

  const scraped = await scrapePublicTelegramChannel(normalized.channelSlug);
  const latestPostId = scraped.posts.at(-1)?.postId;

  const saved = await upsertNewsSource({
    telegramId,
    url: normalized.url,
    channelSlug: normalized.channelSlug,
    title: scraped.title,
    lastPostId: latestPostId,
    lastCheckedAt: new Date().toISOString(),
    enabled: true,
  });

  return [
    `Источник добавлен: ${saved.title ?? `@${saved.channelSlug}`}.`,
    `Ссылка: ${saved.url}`,
    latestPostId
      ? "Текущие посты пропущены. Дальше бот будет присылать только новые."
      : "Постов пока не нашлось. Когда они появятся, бот начнет присылать новые.",
  ].join("\n");
}

export async function processPublicNews(telegramId?: string): Promise<{
  checked: number;
  newPosts: number;
  deliveries: number;
}> {
  const sources = await listActiveNewsSources(telegramId);
  let checked = 0;
  let newPosts = 0;
  let deliveries = 0;

  for (const source of sources) {
    try {
      const scraped = await scrapePublicTelegramChannel(source.channelSlug);
      const latestPostId = scraped.posts.at(-1)?.postId ?? source.lastPostId;
      const freshPosts = scraped.posts.filter((post) => post.postId > (source.lastPostId ?? 0));

      checked += 1;
      newPosts += freshPosts.length;

      if (freshPosts.length > 0) {
        const hydratedSource = {
          ...source,
          title: scraped.title ?? source.title,
        };

        for (const post of freshPosts) {
          deliveries += await sendFullNewsPost(hydratedSource, post);
        }
      }

      await updateNewsSource(source.id, {
        title: scraped.title ?? source.title,
        lastPostId: latestPostId,
        lastCheckedAt: new Date().toISOString(),
      });
    } catch (error) {
      checked += 1;
      console.error(`News polling failed for ${source.channelSlug}:`, error);
      await updateNewsSource(source.id, {
        lastCheckedAt: new Date().toISOString(),
      });
    }
  }

  return {
    checked,
    newPosts,
    deliveries,
  };
}
