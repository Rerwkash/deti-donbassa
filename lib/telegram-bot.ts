import { env } from "@/lib/env";
import { refreshGoogleToken, replaceGoogleWaterEvents } from "@/lib/google";
import { refreshMicrosoftToken, replaceWaterEvents } from "@/lib/microsoft";
import { addPublicNewsSource, normalizeTelegramChannelInput, processPublicNews } from "@/lib/news";
import { getUser, listNewsSources, removeNewsSource, upsertUser } from "@/lib/storage";
import { answerCallbackQuery, sendTelegramMessage } from "@/lib/telegram";
import { BotState, GoogleToken, MicrosoftToken, TelegramUpdate, UserRecord } from "@/lib/types";
import {
  buildRuleDate,
  buildWaterEvents,
  currentDateString,
  formatExpectedWindow,
  formatMonthDay,
  formatRule,
  isTimeInput,
  isValidMonthDay,
} from "@/lib/water";

const BUTTONS = {
  help: "Помощь",
  loginMicrosoft: "Подключить Microsoft",
  loginGoogle: "Подключить Google",
  setupWater: "Настроить воду",
  setupNews: "Настройка новостей",
  status: "Статус",
  sync: "Синхронизировать",
  reportStart: "Вода пошла",
  reportEnd: "Вода закончилась",
  cancel: "Отмена",
} as const;

const MONTHS = [
  { label: "Янв", value: 1 },
  { label: "Фев", value: 2 },
  { label: "Мар", value: 3 },
  { label: "Апр", value: 4 },
  { label: "Май", value: 5 },
  { label: "Июн", value: 6 },
  { label: "Июл", value: 7 },
  { label: "Авг", value: 8 },
  { label: "Сен", value: 9 },
  { label: "Окт", value: 10 },
  { label: "Ноя", value: 11 },
  { label: "Дек", value: 12 },
] as const;

const INTERVALS = [1, 2, 3, 4, 5, 7, 10, 14, 30] as const;

function microsoftAuthLink(telegramId: string): string {
  return `${env.APP_URL}/api/auth/microsoft/start?telegramId=${encodeURIComponent(telegramId)}`;
}

function googleAuthLink(telegramId: string): string {
  return `${env.APP_URL}/api/auth/google/start?telegramId=${encodeURIComponent(telegramId)}`;
}

function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: BUTTONS.sync }, { text: BUTTONS.status }],
      [{ text: BUTTONS.loginMicrosoft }, { text: BUTTONS.loginGoogle }],
      [{ text: BUTTONS.setupWater }, { text: BUTTONS.setupNews }],
      [{ text: BUTTONS.reportStart }, { text: BUTTONS.reportEnd }],
      [{ text: BUTTONS.help }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Выбери действие",
  };
}

function addCancelButton(rows: Array<Array<Record<string, string>>>) {
  return [...rows, [{ text: BUTTONS.cancel, callback_data: "cancel_action" }]];
}

function loginButtons(telegramId: string) {
  return {
    inline_keyboard: [
      [{ text: "Войти через Microsoft", url: microsoftAuthLink(telegramId) }],
      [{ text: "Войти через Google", url: googleAuthLink(telegramId) }],
    ],
  };
}

function monthButtons() {
  return {
    inline_keyboard: addCancelButton([
      MONTHS.slice(0, 3).map((month) => ({ text: month.label, callback_data: `water_month:${month.value}` })),
      MONTHS.slice(3, 6).map((month) => ({ text: month.label, callback_data: `water_month:${month.value}` })),
      MONTHS.slice(6, 9).map((month) => ({ text: month.label, callback_data: `water_month:${month.value}` })),
      MONTHS.slice(9, 12).map((month) => ({ text: month.label, callback_data: `water_month:${month.value}` })),
    ]),
  };
}

function intervalButtons() {
  return {
    inline_keyboard: addCancelButton([
      INTERVALS.slice(0, 3).map((value) => ({ text: `${value} дн.`, callback_data: `water_interval:${value}` })),
      INTERVALS.slice(3, 6).map((value) => ({ text: `${value} дн.`, callback_data: `water_interval:${value}` })),
      INTERVALS.slice(6, 9).map((value) => ({ text: `${value} дн.`, callback_data: `water_interval:${value}` })),
    ]),
  };
}

function reportButtons(date: string) {
  return {
    inline_keyboard: addCancelButton([
      [
        { text: "Отметить начало", callback_data: `report_start:${date}` },
        { text: "Отметить конец", callback_data: `report_end:${date}` },
      ],
    ]),
  };
}

function newsSettingsButtons() {
  return {
    inline_keyboard: addCancelButton([
      [{ text: "Просмотр списка источников", callback_data: "news_list" }],
      [
        { text: "Добавить", callback_data: "news_add_prompt" },
        { text: "Удалить", callback_data: "news_remove_menu" },
      ],
      [{ text: "Проверить сейчас", callback_data: "news_check" }],
    ]),
  };
}

function newsRemoveButtons(items: Array<{ title: string; channelSlug: string }>) {
  return {
    inline_keyboard: addCancelButton(
      items.map((item) => [{ text: item.title, callback_data: `news_delete:${item.channelSlug}` }]),
    ),
  };
}

function cancelButtons() {
  return {
    inline_keyboard: [[{ text: BUTTONS.cancel, callback_data: "cancel_action" }]],
  };
}

async function sendMenuMessage(chatId: string, text: string) {
  await sendTelegramMessage(chatId, text, { replyMarkup: mainMenuKeyboard() });
}

async function sendInlineMessage(chatId: string, text: string, replyMarkup: Record<string, unknown>) {
  await sendTelegramMessage(chatId, text, { replyMarkup });
}

async function sendCancelablePrompt(chatId: string, text: string) {
  await sendInlineMessage(chatId, text, cancelButtons());
}

async function sendLoginMessage(chatId: string) {
  await sendInlineMessage(chatId, "Выбери календарь для подключения.", loginButtons(chatId));
}

function statusButtons() {
  return {
    inline_keyboard: [
      [
        { text: "Синхронизировать", callback_data: "action_sync" },
        { text: "Настроить воду", callback_data: "action_setup_water" },
      ],
      [{ text: "Подключить календари", callback_data: "action_login" }],
    ],
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function connectedLabel(connected: boolean): string {
  return connected ? "Подключен" : "Не подключен";
}

function formatStatusHtml(user?: UserRecord): string {
  const microsoftName = user?.microsoft
    ? escapeHtml(user.microsoft.displayName || user.microsoft.userPrincipalName || "аккаунт")
    : "";
  const googleName = user?.google ? escapeHtml(user.google.displayName || user.google.email || "аккаунт") : "";
  const baseDate = user?.waterRule ? escapeHtml(user.waterRule.startDate) : "Не задана";
  const interval = user?.waterRule ? `Каждые ${user.waterRule.intervalDays} дн.` : "Не задана";
  const window = escapeHtml(formatExpectedWindow(user?.waterRule));
  const lastSync = escapeHtml(formatStatusHumanDateTime(user?.lastSyncAt));
  const titlePad = "\u2800".repeat(12);
  const title = `${titlePad}Статус${titlePad}`;

  const lines = [
    `<b>${title}</b>`,
    "",
    "<b>Календари</b>",
    `• Microsoft: <b>${connectedLabel(Boolean(user?.microsoft))}</b>${user?.microsoft ? `\n  ${microsoftName}` : ""}`,
    `• Google: <b>${connectedLabel(Boolean(user?.google))}</b>${user?.google ? `\n  ${googleName}` : ""}`,
    "",
    "<b>Вода</b>",
    `• Базовая дата: <b>${baseDate}</b>`,
    `• Периодичность: <b>${interval}</b>`,
    `• Окно: <b>${window}</b>`,
    "",
    "<b>Синхронизация</b>",
    `• Последняя: <b>${lastSync}</b>`,
  ];

  return lines.join("\n");
}

function statusDateParts(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function formatStatusHumanDate(dateOnly?: string): string {
  if (!dateOnly) {
    return "Пока не настроен";
  }

  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return dateOnly;
  }

  const parts = statusDateParts(parsed, "UTC");
  return `${parts.day} ${parts.month} ${parts.year}`;
}

function formatStatusHumanDateTime(value?: string): string {
  if (!value) {
    return "Синхронизации еще не было";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const parts = statusDateParts(parsed, "Europe/Moscow");
  return `${parts.day} ${parts.month} в ${parts.hour}:${parts.minute}`;
}

function formatStatusInterval(intervalDays?: number): string {
  if (!intervalDays) {
    return "Пока не настроен";
  }

  if (intervalDays === 1) {
    return "каждый день";
  }

  const mod10 = intervalDays % 10;
  const mod100 = intervalDays % 100;
  let suffix = "дней";

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    suffix = "дня";
  }

  return `каждые ${intervalDays} ${suffix}`;
}

function formatStatusWindow(user?: UserRecord): string {
  if (!user?.waterRule) {
    return "Пока не настроено";
  }

  if (user.waterRule.startTime && user.waterRule.endTime) {
    return `${user.waterRule.startTime}-${user.waterRule.endTime}`;
  }

  return "Время пока не уточнено";
}

function formatStatusOwner(user?: UserRecord): string | null {
  const values = [
    user?.microsoft?.displayName,
    user?.google?.displayName,
    user?.microsoft?.userPrincipalName,
    user?.google?.email,
  ].filter((value): value is string => Boolean(value?.trim()));

  if (values.length === 0) {
    return null;
  }

  return values[0];
}

function formatStatusSummary(user?: UserRecord): string {
  const connectedCount = Number(Boolean(user?.microsoft)) + Number(Boolean(user?.google));

  if (connectedCount === 2) {
    return "Microsoft • Google";
  }

  if (user?.microsoft) {
    return "Microsoft";
  }

  if (user?.google) {
    return "Google";
  }

  return "не подключены";
}

function formatStatusCardHtml(user?: UserRecord): string {
  const owner = formatStatusOwner(user);
  const lines = ["<b>Статус</b>", "", "Календари", `<b>${escapeHtml(formatStatusSummary(user))}</b>`];

  if (owner) {
    lines.push("", "Аккаунт", `<b>${escapeHtml(owner)}</b>`);
  }

  lines.push("", "График подачи");

  if (user?.waterRule) {
    lines.push(
      `<b>с ${escapeHtml(formatStatusHumanDate(user.waterRule.startDate))}</b>`,
      escapeHtml(formatStatusInterval(user.waterRule.intervalDays)),
      escapeHtml(formatStatusWindow(user)),
    );
  } else {
    lines.push("<b>Пока не настроен</b>");
  }

  lines.push("", "Обновлено", `<b>${escapeHtml(formatStatusHumanDateTime(user?.lastSyncAt))}</b>`);

  return lines.filter(Boolean).join("\n");
}

async function sendStatusMessage(chatId: string) {
  const user = await getUser(chatId);
  await sendTelegramMessage(chatId, formatStatusHtml(user ?? undefined), {
    parseMode: "HTML",
  });
}

async function clearBotState(chatId: string) {
  await upsertUser(chatId, (current) => ({
    ...current,
    botState: undefined,
  }));
}

async function ensureFreshMicrosoftToken(telegramId: string, token: MicrosoftToken) {
  if (token.expiresAt > Date.now()) {
    return token;
  }

  const next = await refreshMicrosoftToken(token);
  await upsertUser(telegramId, (current) => ({ ...current, microsoft: next }));
  return next;
}

async function ensureFreshGoogleToken(telegramId: string, token: GoogleToken) {
  if (token.expiresAt > Date.now()) {
    return token;
  }

  const next = await refreshGoogleToken(token);
  await upsertUser(telegramId, (current) => ({ ...current, google: next }));
  return next;
}

async function syncConnectedCalendars(telegramId: string, user: UserRecord): Promise<string[]> {
  const events = buildWaterEvents(user.waterRule!);
  const results: string[] = [];

  if (user.microsoft) {
    try {
      const token = await ensureFreshMicrosoftToken(telegramId, user.microsoft);
      const count = await replaceWaterEvents(token, events);
      results.push(`Microsoft Calendar: создано событий ${count}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "неизвестная ошибка";
      results.push(`Microsoft Calendar: ошибка синхронизации (${message}).`);
    }
  }

  if (user.google) {
    try {
      const token = await ensureFreshGoogleToken(telegramId, user.google);
      const count = await replaceGoogleWaterEvents(token, events);
      results.push(`Google Calendar: создано событий ${count}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "неизвестная ошибка";
      results.push(`Google Calendar: ошибка синхронизации (${message}).`);
    }
  }

  if (results.some((line) => line.includes("создано событий"))) {
    await upsertUser(telegramId, (current) => ({
      ...current,
      lastSyncAt: new Date().toISOString(),
    }));
  }

  return results;
}

async function syncWater(telegramId: string): Promise<string> {
  const user = await getUser(telegramId);
  if (!user?.waterRule) {
    return [
      "Сначала настрой воду кнопкой «Настроить воду».",
      "Год вводить не нужно.",
    ].join("\n");
  }

  if (!user.microsoft && !user.google) {
    return [
      "Сначала подключи хотя бы один календарь.",
      "Нажми кнопку подключения ниже.",
    ].join("\n");
  }

  const results = await syncConnectedCalendars(telegramId, user);
  return ["Синхронизация завершена.", ...results].join("\n");
}

async function startWaterSetup(chatId: string) {
  await upsertUser(chatId, (current) => ({
    ...current,
    botState: {
      flow: "water_setup",
      step: "choose_month",
    },
  }));

  await sendInlineMessage(chatId, "Выбери месяц первой даты подачи воды.", monthButtons());
}

async function showNewsSettings(chatId: string) {
  await clearBotState(chatId);
  await sendInlineMessage(
    chatId,
    [
      "Настройка новостей.",
      "",
      "Здесь можно посмотреть список источников, добавить новый публичный канал или удалить старый.",
    ].join("\n"),
    newsSettingsButtons(),
  );
}

async function promptNewsSourceInput(chatId: string) {
  await upsertUser(chatId, (current) => ({
    ...current,
    botState: {
      flow: "news_setup",
      step: "enter_news_source",
    },
  }));

  await sendCancelablePrompt(
    chatId,
    ["Пришли ссылку на публичный Telegram-канал.", "Пример: https://t.me/durov"].join("\n"),
  );
}

async function promptDayInput(chatId: string, month: number) {
  await upsertUser(chatId, (current) => ({
    ...current,
    botState: {
      flow: "water_setup",
      step: "enter_day",
      draftMonth: month,
    },
  }));

  await sendCancelablePrompt(chatId, `Месяц выбран: ${month.toString().padStart(2, "0")}.\nТеперь отправь день месяца числом, например 12.`);
}

async function promptIntervalInput(chatId: string, state: BotState) {
  await upsertUser(chatId, (current) => ({
    ...current,
    botState: {
      ...state,
      flow: "water_setup",
      step: "choose_interval",
    },
  }));

  await sendInlineMessage(chatId, "Теперь выбери периодичность подачи воды.", intervalButtons());
}

async function completeWaterSetup(chatId: string, intervalDays: number) {
  const user = await getUser(chatId);
  const state = user?.botState;

  if (!state?.draftMonth || !state?.draftDay) {
    await sendMenuMessage(chatId, "Не удалось завершить настройку. Нажми «Настроить воду» еще раз.");
    return;
  }

  const startDate = buildRuleDate(state.draftMonth, state.draftDay);
  const currentRule = user?.waterRule;

  const nextRule = {
    startDate,
    intervalDays,
    horizonDays: 30,
    title: "Подача воды",
    startTime: currentRule?.startTime,
    endTime: currentRule?.endTime,
  };

  await upsertUser(chatId, (current) => ({
    ...current,
    waterRule: nextRule,
    botState: undefined,
    notificationState: undefined,
  }));

  await sendMenuMessage(
    chatId,
    [
      "Правило воды сохранено.",
      formatRule(nextRule),
      "",
      "Теперь можешь нажать «Синхронизировать».",
    ].join("\n"),
  );
}

async function startTimeReport(chatId: string, type: "report_start" | "report_end", reportDate = currentDateString()) {
  await upsertUser(chatId, (current) => ({
    ...current,
    botState: {
      flow: type,
      step: "enter_time",
      reportDate,
    },
  }));

  const label = type === "report_start" ? "начала" : "окончания";
  await sendCancelablePrompt(chatId, `Отправь примерное время ${label} воды в формате HH:MM.`);
}

async function handlePendingDay(chatId: string, state: BotState, text: string): Promise<boolean> {
  if (state.flow !== "water_setup" || state.step !== "enter_day" || !state.draftMonth) {
    return false;
  }

  const day = Number(text);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    await sendCancelablePrompt(chatId, "День должен быть числом от 1 до 31.");
    return true;
  }

  if (!isValidMonthDay(state.draftMonth, day)) {
    await sendCancelablePrompt(chatId, "Такой даты в выбранном месяце нет. Введи день еще раз.");
    return true;
  }

  await promptIntervalInput(chatId, {
    flow: "water_setup",
    step: "choose_interval",
    draftMonth: state.draftMonth,
    draftDay: day,
  });
  return true;
}

async function handlePendingNewsSource(chatId: string, user: UserRecord, text: string): Promise<boolean> {
  const state = user.botState;
  if (state?.flow !== "news_setup" || state.step !== "enter_news_source") {
    return false;
  }

  try {
    const result = await addPublicNewsSource(chatId, text);
    await clearBotState(chatId);
    await sendMenuMessage(chatId, result);
  } catch (error) {
    await sendCancelablePrompt(
      chatId,
      error instanceof Error ? error.message : "Не удалось добавить источник. Пришли ссылку еще раз.",
    );
  }

  return true;
}

async function handlePendingTime(chatId: string, user: UserRecord, text: string): Promise<boolean> {
  const state = user.botState;
  if (!state?.flow || state.step !== "enter_time" || (state.flow !== "report_start" && state.flow !== "report_end")) {
    return false;
  }

  if (!isTimeInput(text)) {
    await sendCancelablePrompt(chatId, "Время нужно отправить в формате HH:MM, например 18:30.");
    return true;
  }

  const reportDate = state.reportDate ?? currentDateString();
  const waterRule = user.waterRule ?? {
    startDate: reportDate,
    intervalDays: 3,
    horizonDays: 30,
    title: "Подача воды",
  };

  const nextRule = {
    ...waterRule,
    startTime: state.flow === "report_start" ? text : waterRule.startTime,
    endTime: state.flow === "report_end" ? text : waterRule.endTime,
  };

  await upsertUser(chatId, (current) => ({
    ...current,
    waterRule: nextRule,
    botState: undefined,
    notificationState: {
      ...current.notificationState,
      startAlertKey:
        state.flow === "report_start" ? `${reportDate}T${text}` : current.notificationState?.startAlertKey,
      endAlertKey:
        state.flow === "report_end" ? `${reportDate}T${text}` : current.notificationState?.endAlertKey,
    },
  }));

  const refreshed = await getUser(chatId);
  const syncLines =
    refreshed?.waterRule?.startTime && refreshed?.waterRule?.endTime && (refreshed.microsoft || refreshed.google)
      ? await syncConnectedCalendars(chatId, refreshed)
      : [];

  await sendMenuMessage(
    chatId,
    [
      `Время сохранено для даты ${formatMonthDay(reportDate)}.`,
      formatExpectedWindow(refreshed?.waterRule),
      ...syncLines,
    ].join("\n"),
  );
  return true;
}

function normalizeAction(text: string): string {
  const trimmed = text.trim();

  if (trimmed === BUTTONS.loginMicrosoft) {
    return "/login";
  }

  if (trimmed === BUTTONS.loginGoogle) {
    return "/login_google";
  }

  if (trimmed === BUTTONS.sync) {
    return "/sync";
  }

  if (trimmed === BUTTONS.status) {
    return "/status";
  }

  if (trimmed === BUTTONS.setupWater) {
    return "setup_water";
  }

  if (trimmed === BUTTONS.setupNews) {
    return "setup_news";
  }

  if (trimmed === BUTTONS.help) {
    return "help";
  }

  if (trimmed === BUTTONS.reportStart) {
    return "report_start";
  }

  if (trimmed === BUTTONS.reportEnd) {
    return "report_end";
  }

  return trimmed;
}

function commandPayload(text: string, command: string): string | null {
  const match = text.match(new RegExp(`^/${command}(?:@\\w+)?(?:\\s+([\\s\\S]+))?$`, "i"));
  if (!match) {
    return null;
  }

  return match[1]?.trim() ?? "";
}

async function formatNewsSourcesMessage(chatId: string): Promise<string> {
  const sources = await listNewsSources(chatId);

  if (sources.length === 0) {
    return [
      "Источников новостей пока нет.",
      "Добавь публичный канал так:",
      "/news_add https://t.me/durov",
    ].join("\n");
  }

  return [
    "Источники новостей:",
    ...sources.map((source, index) =>
      [
        `${index + 1}. ${source.title ?? `@${source.channelSlug}`}`,
        source.url,
        `Последний пост: ${source.lastPostId ?? "пока нет"}`,
        `Проверка: ${formatStatusHumanDateTime(source.lastCheckedAt)}`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

async function checkNewsNow(chatId: string): Promise<string> {
  const result = await processPublicNews(chatId);

  if (result.checked === 0) {
    return [
      "Сначала добавь хотя бы один публичный Telegram-канал.",
      "Пример: /news_add https://t.me/durov",
    ].join("\n");
  }

  if (result.newPosts === 0) {
    return `Проверка завершена.\nИсточников проверено: ${result.checked}\nНовых постов нет.`;
  }

  return [
    "Проверка завершена.",
    `Источников проверено: ${result.checked}`,
    `Новых постов: ${result.newPosts}`,
    `Сообщений отправлено: ${result.deliveries}`,
  ].join("\n");
}

async function showNewsRemoveMenu(chatId: string) {
  const sources = await listNewsSources(chatId);

  if (sources.length === 0) {
    await sendInlineMessage(chatId, "Источников пока нет. Сначала добавь хотя бы один канал.", cancelButtons());
    return;
  }

  await sendInlineMessage(
    chatId,
    "Выбери источник, который нужно удалить.",
    newsRemoveButtons(
      sources.map((source) => ({
        title: source.title ?? `@${source.channelSlug}`,
        channelSlug: source.channelSlug,
      })),
    ),
  );
}

async function handleCallbackQuery(update: TelegramUpdate): Promise<boolean> {
  const callback = update.callback_query;
  if (!callback?.id || !callback.message?.chat?.id || !callback.data) {
    return false;
  }

  const chatId = callback.message.chat.id.toString();
  await answerCallbackQuery(callback.id);

  if (callback.data === "cancel_action") {
    await clearBotState(chatId);
    await sendMenuMessage(chatId, "Действие отменено.");
    return true;
  }

  if (callback.data === "action_sync") {
    await sendMenuMessage(chatId, await syncWater(chatId));
    return true;
  }

  if (callback.data === "action_setup_water") {
    await startWaterSetup(chatId);
    return true;
  }

  if (callback.data === "action_login") {
    await sendLoginMessage(chatId);
    return true;
  }

  if (callback.data === "news_list") {
    await sendMenuMessage(chatId, await formatNewsSourcesMessage(chatId));
    return true;
  }

  if (callback.data === "news_add_prompt") {
    await promptNewsSourceInput(chatId);
    return true;
  }

  if (callback.data === "news_remove_menu") {
    await showNewsRemoveMenu(chatId);
    return true;
  }

  if (callback.data === "news_check") {
    await sendMenuMessage(chatId, await checkNewsNow(chatId));
    return true;
  }

  if (callback.data.startsWith("news_delete:")) {
    const channelSlug = callback.data.split(":")[1];
    await removeNewsSource(chatId, channelSlug);
    await sendMenuMessage(chatId, `Источник удален: @${channelSlug}`);
    return true;
  }

  if (callback.data.startsWith("water_month:")) {
    const month = Number(callback.data.split(":")[1]);
    if (month >= 1 && month <= 12) {
      await promptDayInput(chatId, month);
    }
    return true;
  }

  if (callback.data.startsWith("water_interval:")) {
    const interval = Number(callback.data.split(":")[1]);
    if (interval >= 1 && interval <= 30) {
      await completeWaterSetup(chatId, interval);
    }
    return true;
  }

  if (callback.data.startsWith("report_start:")) {
    await startTimeReport(chatId, "report_start", callback.data.split(":")[1]);
    return true;
  }

  if (callback.data.startsWith("report_end:")) {
    await startTimeReport(chatId, "report_end", callback.data.split(":")[1]);
    return true;
  }

  return false;
}

export async function sendWaterDayReminder(chatId: string, text: string, date: string) {
  await sendInlineMessage(chatId, text, reportButtons(date));
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (await handleCallbackQuery(update)) {
    return;
  }

  const chatId = update.message?.chat?.id?.toString();
  const rawText = update.message?.text?.trim();

  if (!chatId || !rawText) {
    return;
  }

  const user = await getUser(chatId);
  if (user?.botState && (await handlePendingDay(chatId, user.botState, rawText))) {
    return;
  }

  if (user && (await handlePendingNewsSource(chatId, user, rawText))) {
    return;
  }

  if (user && (await handlePendingTime(chatId, user, rawText))) {
    return;
  }

  const newsAdd = commandPayload(rawText, "news_add");
  if (newsAdd !== null) {
    if (!newsAdd) {
      await sendMenuMessage(chatId, "Пришли ссылку на публичный канал.\nПример: /news_add https://t.me/durov");
      return;
    }

    try {
      await sendMenuMessage(chatId, await addPublicNewsSource(chatId, newsAdd));
    } catch (error) {
      await sendMenuMessage(chatId, error instanceof Error ? error.message : "Не удалось добавить канал.");
    }
    return;
  }

  const newsRemove = commandPayload(rawText, "news_remove");
  if (newsRemove !== null) {
    if (!newsRemove) {
      await sendMenuMessage(chatId, "Пришли username или ссылку.\nПример: /news_remove https://t.me/durov");
      return;
    }

    try {
      const normalized = normalizeTelegramChannelInput(newsRemove);
      await removeNewsSource(chatId, normalized.channelSlug);
      await sendMenuMessage(chatId, `Источник удален: @${normalized.channelSlug}`);
    } catch (error) {
      await sendMenuMessage(chatId, error instanceof Error ? error.message : "Не удалось удалить источник.");
    }
    return;
  }

  if (/^\/news_list(?:@\w+)?$/i.test(rawText)) {
    await sendMenuMessage(chatId, await formatNewsSourcesMessage(chatId));
    return;
  }

  if (/^\/news_check(?:@\w+)?$/i.test(rawText)) {
    await sendMenuMessage(chatId, await checkNewsNow(chatId));
    return;
  }

  const text = normalizeAction(rawText);

  if (text === "/start") {
    await sendMenuMessage(
      chatId,
      [
        "Главное меню готово.",
        "",
        "Что можно делать кнопками:",
        "1. Подключать Microsoft и Google Calendar.",
        "2. Настроить дату воды через выбор месяца и дня.",
        "3. Отмечать, когда вода реально пошла и закончилась.",
        "4. Синхронизировать оба календаря.",
        "5. Настраивать новости через кнопку «Настройка новостей».",
      ].join("\n"),
    );
    return;
  }

  if (text === "/login" || text === "/login_google") {
    await sendLoginMessage(chatId);
    return;
  }

  if (text === "setup_water") {
    await startWaterSetup(chatId);
    return;
  }

  if (text === "setup_news") {
    await showNewsSettings(chatId);
    return;
  }

  if (text === "report_start") {
    await startTimeReport(chatId, "report_start");
    return;
  }

  if (text === "report_end") {
    await startTimeReport(chatId, "report_end");
    return;
  }

  if (text === "/sync") {
    await sendMenuMessage(chatId, await syncWater(chatId));
    return;
  }

  if (text === "/status") {
    await sendStatusMessage(chatId);
    return;
  }

  if (text === "help") {
    await sendMenuMessage(
      chatId,
      [
        "Как пользоваться ботом:",
        "1. Подключи один или оба календаря.",
        "2. Нажми «Настроить воду» и выбери месяц.",
        "3. Отправь день месяца числом.",
        "4. Выбери периодичность кнопкой.",
        "5. В день воды отмечай «Вода пошла» и «Вода закончилась».",
        "6. В «Настройка новостей» можно смотреть, добавлять и удалять источники.",
        "Во время редактирования можно нажать «Отмена».",
      ].join("\n"),
    );
    return;
  }

  await sendMenuMessage(chatId, "Используй кнопки снизу. Для старта нажми /start.");
}
