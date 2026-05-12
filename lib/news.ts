import { Api, TelegramClient } from "telegram";

import { hasWaterIncidentSignal, recordIncidentFromNewsPost } from "@/lib/incidents";
import { getUser, listActiveNewsSources, updateNewsSource, upsertNewsSource, upsertUser } from "@/lib/storage";
import { sendTelegramMediaGroup, sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo } from "@/lib/telegram";
import { withTelegramAccountClient } from "@/lib/telegram-user";
import { NewsSourceRecord, NewsSourceSuggestion, ScrapedNewsMedia, ScrapedNewsPost, TelegramAccountToken } from "@/lib/types";

const TELEGRAM_HOSTS = new Set(["t.me", "www.t.me", "telegram.me", "www.telegram.me"]);
const NEWS_TIMEZONE = "Europe/Moscow";
const SEARCH_LIMIT = 8;
const FETCH_LIMIT = 30;

function moscowDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NEWS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isPublishedWithinMoscowRange(publishedAt: string | undefined, start: Date, end: Date): boolean {
  if (!publishedAt) {
    return false;
  }

  const parsed = new Date(publishedAt);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const startKey = moscowDayKey(start);
  const endKey = moscowDayKey(end);
  const publishedKey = moscowDayKey(parsed);
  return publishedKey >= startKey && publishedKey <= endKey;
}

function rangeFetchLimit(start: Date, end: Date): number {
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  return Math.max(200, Math.min(2000, days * 250));
}

function isTelegramChannelEntity(entity: unknown): entity is Api.Channel {
  return entity instanceof Api.Channel && Boolean(entity.username);
}

function telegramEntityKind(entity: Api.Channel): "channel" | "group" {
  return entity.broadcast ? "channel" : "group";
}

function telegramEntityTitle(entity: Api.Channel): string {
  return entity.title?.trim() || `@${entity.username}`;
}

function telegramEntityUrl(entity: Api.Channel): string {
  return `https://t.me/${entity.username}`;
}

function telegramPostUrl(channelSlug: string, messageId: number): string {
  return `https://t.me/${channelSlug}/${messageId}`;
}

function sourceKindLabel(kind: "channel" | "group"): string {
  return kind === "group" ? "Чат" : "Канал";
}

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

type TelegramHistoryItem = {
  id: number;
  groupedId?: string;
  publishedAt?: string;
  text: string;
  media?: ScrapedNewsMedia;
};

function mediaExtension(type: "photo" | "video"): string {
  return type === "video" ? "mp4" : "jpg";
}

function mediaMimeType(type: "photo" | "video"): string {
  return type === "video" ? "video/mp4" : "image/jpeg";
}

function detectTelegramMediaType(message: {
  photo?: unknown;
  video?: unknown;
  media?: Api.TypeMessageMedia;
}): "photo" | "video" | null {
  if (message.photo) {
    return "photo";
  }

  if (message.video) {
    return "video";
  }

  const media = message.media;
  if (media instanceof Api.MessageMediaPhoto) {
    return "photo";
  }

  if (media instanceof Api.MessageMediaDocument) {
    const mimeType = media.document instanceof Api.Document ? media.document.mimeType ?? "" : "";
    if (mimeType.startsWith("video/")) {
      return "video";
    }
  }

  return null;
}

async function extractTelegramMessageMedia(
  client: TelegramClient,
  message: Api.Message,
): Promise<ScrapedNewsMedia | undefined> {
  const type = detectTelegramMediaType(message as Api.Message & { photo?: unknown; video?: unknown });
  if (!type) {
    return undefined;
  }

  const downloaded = await client.downloadMedia(message);
  if (!downloaded || typeof downloaded === "string") {
    return undefined;
  }

  return {
    type,
    data: downloaded,
    fileName: `telegram-${message.id}.${mediaExtension(type)}`,
    mimeType: mediaMimeType(type),
  };
}

function buildTelegramPosts(channelSlug: string, messages: TelegramHistoryItem[]): ScrapedNewsPost[] {
  const posts: ScrapedNewsPost[] = [];
  let groupedItems: TelegramHistoryItem[] = [];
  let currentGroupedId: string | undefined;

  const flushGroup = () => {
    if (groupedItems.length === 0) {
      return;
    }

    const first = groupedItems[0];
    const text = groupedItems.map((item) => item.text).find((value) => value.trim()) ?? "";
    posts.push({
      postId: first.id,
      postUrl: telegramPostUrl(channelSlug, first.id),
      publishedAt: first.publishedAt,
      text,
      media: groupedItems.flatMap((item) => (item.media ? [item.media] : [])),
    });

    groupedItems = [];
    currentGroupedId = undefined;
  };

  for (const item of messages) {
    if (item.groupedId) {
      if (currentGroupedId && currentGroupedId !== item.groupedId) {
        flushGroup();
      }

      currentGroupedId = item.groupedId;
      groupedItems.push(item);
      continue;
    }

    flushGroup();
    posts.push({
      postId: item.id,
      postUrl: telegramPostUrl(channelSlug, item.id),
      publishedAt: item.publishedAt,
      text: item.text,
      media: item.media ? [item.media] : [],
    });
  }

  flushGroup();
  return posts;
}

async function fetchTelegramSourcePostsForPeriod(
  account: TelegramAccountToken,
  channelSlug: string,
  start: Date,
  end: Date,
  options: {
    includeMedia?: boolean;
  } = {},
): Promise<{ title: string; kind: "channel" | "group"; posts: ScrapedNewsPost[] }> {
  return withTelegramAccountClient(account, async (client) => {
    const entity = await client.getEntity(channelSlug);
    if (!isTelegramChannelEntity(entity)) {
      throw new Error("Источник должен быть публичным каналом или группой с username.");
    }

    const history: TelegramHistoryItem[] = [];
    const startKey = moscowDayKey(start);
    const endKey = moscowDayKey(end);
    const endMs = end.getTime();

    for await (const rawMessage of client.iterMessages(entity, {
      limit: rangeFetchLimit(start, end),
      offsetDate: Math.floor((endMs + 1000) / 1000),
    })) {
      const message = rawMessage as Api.Message & {
        groupedId?: bigint;
        video?: unknown;
      };

      if (!message.id || !message.date) {
        continue;
      }

      const publishedAt = new Date(message.date * 1000).toISOString();
      const publishedKey = moscowDayKey(new Date(publishedAt));

      if (publishedKey < startKey) {
        break;
      }

      if (publishedKey > endKey) {
        continue;
      }

      history.push({
        id: message.id,
        groupedId: message.groupedId?.toString(),
        publishedAt,
        text: message.message?.trim() ?? "",
        media: options.includeMedia ? await extractTelegramMessageMedia(client, message) : undefined,
      });
    }

    history.sort((left, right) => left.id - right.id);

    return {
      title: telegramEntityTitle(entity),
      kind: telegramEntityKind(entity),
      posts: buildTelegramPosts(channelSlug, history),
    };
  });
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

async function resolveTelegramSourceInfo(
  account: TelegramAccountToken,
  channelSlug: string,
): Promise<{ title: string; kind: "channel" | "group"; latestPostId?: number }> {
  return withTelegramAccountClient(account, async (client) => {
    const entity = await client.getEntity(channelSlug);
    if (!isTelegramChannelEntity(entity)) {
      throw new Error("Нужен публичный канал или группа с username.");
    }

    let latestPostId: number | undefined;
    for await (const rawMessage of client.iterMessages(entity, { limit: 1 })) {
      const message = rawMessage as { id?: number };
      if (message.id) {
        latestPostId = message.id;
        break;
      }
    }

    return {
      title: telegramEntityTitle(entity),
      kind: telegramEntityKind(entity),
      latestPostId,
    };
  });
}

async function fetchTelegramSourcePosts(
  account: TelegramAccountToken,
  channelSlug: string,
  lastPostId?: number,
  options: {
    includeMedia?: boolean;
  } = {},
): Promise<{ title: string; kind: "channel" | "group"; posts: ScrapedNewsPost[] }> {
  return withTelegramAccountClient(account, async (client) => {
    const entity = await client.getEntity(channelSlug);
    if (!isTelegramChannelEntity(entity)) {
      throw new Error("Источник должен быть публичным каналом или группой с username.");
    }

    const history: TelegramHistoryItem[] = [];
    for await (const rawMessage of client.iterMessages(entity, {
      limit: FETCH_LIMIT,
      minId: lastPostId ?? 0,
      reverse: true,
    })) {
      const message = rawMessage as Api.Message & {
        groupedId?: bigint;
        video?: unknown;
      };

      if (!message.id) {
        continue;
      }

      history.push({
        id: message.id,
        groupedId: message.groupedId?.toString(),
        publishedAt: message.date ? new Date(message.date * 1000).toISOString() : undefined,
        text: message.message?.trim() ?? "",
        media: options.includeMedia ? await extractTelegramMessageMedia(client, message) : undefined,
      });
    }

    return {
      title: telegramEntityTitle(entity),
      kind: telegramEntityKind(entity),
      posts: buildTelegramPosts(channelSlug, history),
    };
  });
}

function dedupeSuggestions(items: NewsSourceSuggestion[]): NewsSourceSuggestion[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.channelSlug)) {
      return false;
    }

    seen.add(item.channelSlug);
    return true;
  });
}

export async function searchTelegramNewsSources(
  telegramId: string,
  query: string,
): Promise<NewsSourceSuggestion[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error("Пришли поисковый запрос, например: Донецк, ДНР или вода.");
  }

  const user = await getUser(telegramId);
  if (!user?.telegramAccount) {
    throw new Error("Сначала подключи Telegram-аккаунт кнопкой «Подключить Telegram».");
  }

  return withTelegramAccountClient(user.telegramAccount, async (client) => {
    const found = await client.invoke(
      new Api.contacts.Search({
        q: normalizedQuery,
        limit: SEARCH_LIMIT,
      }),
    );

    const suggestions = found.chats
      .filter(isTelegramChannelEntity)
      .map((chat) => ({
        channelSlug: chat.username!,
        title: telegramEntityTitle(chat),
        url: telegramEntityUrl(chat),
        kind: telegramEntityKind(chat),
      }));

    return dedupeSuggestions(suggestions).slice(0, SEARCH_LIMIT);
  });
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

function telegramMediaInput(item: ScrapedNewsMedia): string | { filename: string; data: Uint8Array; mimeType?: string } {
  if (item.data && item.fileName) {
    return {
      filename: item.fileName,
      data: item.data,
      mimeType: item.mimeType,
    };
  }

  if (item.url) {
    return item.url;
  }

  throw new Error("Media item has neither URL nor uploaded file.");
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
      await sendTelegramPhoto(chatId, telegramMediaInput(item), {
        caption,
        parseMode: "HTML",
      });
    } else {
      await sendTelegramVideo(chatId, telegramMediaInput(item), {
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
          media: telegramMediaInput(item),
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

  const user = await getUser(telegramId);
  let title: string | undefined;
  let latestPostId: number | undefined;
  let sourceKind: "channel" | "group" = "channel";

  if (user?.telegramAccount) {
    try {
      const resolved = await resolveTelegramSourceInfo(user.telegramAccount, normalized.channelSlug);
      title = resolved.title;
      latestPostId = resolved.latestPostId;
      sourceKind = resolved.kind;
    } catch (error) {
      console.error(`Telegram API source resolve failed for ${normalized.channelSlug}:`, error);
    }
  }

  if (!title) {
    const scraped = await scrapePublicTelegramChannel(normalized.channelSlug);
    title = scraped.title;
    latestPostId = scraped.posts.at(-1)?.postId;
  }

  const saved = await upsertNewsSource({
    telegramId,
    url: normalized.url,
    channelSlug: normalized.channelSlug,
    title,
    lastPostId: latestPostId,
    lastCheckedAt: new Date().toISOString(),
    enabled: true,
  });

  const intro = `${sourceKindLabel(sourceKind)} добавлен: ${saved.title ?? `@${saved.channelSlug}`}.`;
  const statusLine = latestPostId
    ? "Текущие сообщения пропущены. Дальше бот будет присылать только новые."
    : "Пока сообщений не нашлось. Когда они появятся, бот начнет присылать новые.";

  return [intro, `Ссылка: ${saved.url}`, statusLine].join("\n");
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
      const owner = await getUser(source.telegramId);

      if (owner?.telegramAccount) {
        try {
          const fetched = await fetchTelegramSourcePosts(owner.telegramAccount, source.channelSlug, source.lastPostId, {
            includeMedia: true,
          });
          const latestPostId = fetched.posts.at(-1)?.postId ?? source.lastPostId;

          checked += 1;
          newPosts += fetched.posts.length;

          if (fetched.posts.length > 0) {
            const hydratedSource = {
              ...source,
              title: fetched.title ?? source.title,
            };

            for (const post of fetched.posts) {
              deliveries += await sendFullNewsPost(hydratedSource, post);
              try {
                await recordIncidentFromNewsPost(hydratedSource, post);
              } catch (error) {
                console.error(`Incident extraction failed for ${source.channelSlug}/${post.postId}:`, error);
              }
            }
          }

          await updateNewsSource(source.id, {
            title: fetched.title ?? source.title,
            lastPostId: latestPostId,
            lastCheckedAt: new Date().toISOString(),
          });
          continue;
        } catch (error) {
          console.error(`Telegram API polling failed for ${source.channelSlug}, fallback to web:`, error);
        }
      }

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
          try {
            await recordIncidentFromNewsPost(hydratedSource, post);
          } catch (error) {
            console.error(`Incident extraction failed for ${source.channelSlug}/${post.postId}:`, error);
          }
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

export async function refreshWaterIncidentMap(
  telegramId: string,
  start: Date,
  end: Date,
): Promise<{
  checked: number;
  scannedPosts: number;
  waterSignals: number;
  incidents: number;
}> {
  const sources = await listActiveNewsSources(telegramId);
  let checked = 0;
  let scannedPosts = 0;
  let waterSignals = 0;
  let incidents = 0;

  for (const source of sources) {
    try {
      const owner = await getUser(source.telegramId);
      let posts: ScrapedNewsPost[] = [];

      if (owner?.telegramAccount) {
        try {
          const fetched = await fetchTelegramSourcePostsForPeriod(owner.telegramAccount, source.channelSlug, start, end, {
            includeMedia: false,
          });
          posts = fetched.posts;
        } catch (error) {
          console.error(`Telegram API period polling failed for ${source.channelSlug}, fallback to web:`, error);
        }
      }

      if (posts.length === 0) {
        const scraped = await scrapePublicTelegramChannel(source.channelSlug);
        posts = scraped.posts.filter((post) => {
          return isPublishedWithinMoscowRange(post.publishedAt, start, end);
        });
      }

      checked += 1;
      scannedPosts += posts.length;

      for (const post of posts) {
        if (hasWaterIncidentSignal(post.text)) {
          waterSignals += 1;
        }

        const incidentRecords = await recordIncidentFromNewsPost(source, post);
        if (incidentRecords.length > 0) {
          incidents += incidentRecords.length;
        }
      }
    } catch (error) {
      checked += 1;
      console.error(`Map refresh failed for ${source.channelSlug}:`, error);
    }
  }

  return {
    checked,
    scannedPosts,
    waterSignals,
    incidents,
  };
}
