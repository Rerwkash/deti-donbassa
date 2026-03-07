import { GraphEventInput, WaterRule } from "@/lib/types";

export const DEFAULT_TIMEZONE = "Europe/Moscow";
const MARKER = "[deti-donbassa-water]";
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parseDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  const next = parseDateOnly(date);
  next.setUTCDate(next.getUTCDate() + days);
  return formatDateOnly(next);
}

function compareDates(left: string, right: string): number {
  return parseDateOnly(left).getTime() - parseDateOnly(right).getTime();
}

function daysBetween(start: string, end: string): number {
  return Math.floor((parseDateOnly(end).getTime() - parseDateOnly(start).getTime()) / DAY_MS);
}

function partsInTimezone(date: Date, timeZone = DEFAULT_TIMEZONE): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return Object.fromEntries(formatter.formatToParts(date).map((item) => [item.type, item.value]));
}

export function currentDateString(date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  const parts = partsInTimezone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentTimeString(date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  const parts = partsInTimezone(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function currentYear(date = new Date(), timeZone = DEFAULT_TIMEZONE): number {
  return Number(partsInTimezone(date, timeZone).year);
}

export function formatMonthDay(date: string): string {
  const parsed = parseDateOnly(date);
  return `${pad(parsed.getUTCDate())}.${pad(parsed.getUTCMonth() + 1)}`;
}

export function formatExpectedWindow(rule?: WaterRule): string {
  if (!rule?.startTime || !rule?.endTime) {
    return "Время подачи пока не зафиксировано.";
  }

  return `Ожидаемое окно: ${rule.startTime} - ${rule.endTime}`;
}

export function isTimeInput(text: string): boolean {
  return /^\d{2}:\d{2}$/.test(text.trim());
}

export function buildRuleDate(month: number, day: number, date = new Date()): string {
  return `${currentYear(date)}-${pad(month)}-${pad(day)}`;
}

export function isValidMonthDay(month: number, day: number, date = new Date()): boolean {
  const candidate = parseDateOnly(buildRuleDate(month, day, date));
  return candidate.getUTCMonth() + 1 === month && candidate.getUTCDate() === day;
}

export function occurrenceDates(rule: WaterRule, fromDate = currentDateString(), horizonDays = rule.horizonDays): string[] {
  const limitDate = addDays(fromDate, horizonDays);
  let firstDate = rule.startDate;

  if (compareDates(firstDate, fromDate) < 0) {
    const diff = daysBetween(rule.startDate, fromDate);
    const steps = Math.ceil(diff / rule.intervalDays);
    firstDate = addDays(rule.startDate, steps * rule.intervalDays);
  }

  const dates: string[] = [];
  for (let current = firstDate; compareDates(current, limitDate) <= 0; current = addDays(current, rule.intervalDays)) {
    dates.push(current);
  }

  return dates;
}

export function isWaterDay(rule: WaterRule, date = currentDateString()): boolean {
  if (compareDates(date, rule.startDate) < 0) {
    return false;
  }

  return daysBetween(rule.startDate, date) % rule.intervalDays === 0;
}

export function notificationKey(date: string, time: string): string {
  return `${date}T${time}`;
}

export function buildWaterEvents(rule: WaterRule, fromDate = currentDateString()): GraphEventInput[] {
  return occurrenceDates(rule, fromDate).map((date) => {
    const base: GraphEventInput = {
      subject: rule.title,
      content: `${MARKER}\nПодача воды по расписанию.`,
      timezone: DEFAULT_TIMEZONE,
    };

    if (rule.startTime && rule.endTime) {
      return {
        ...base,
        startIso: `${date}T${rule.startTime}:00`,
        endIso: `${date}T${rule.endTime}:00`,
      };
    }

    return {
      ...base,
      allDay: true,
      startDate: date,
      endDate: addDays(date, 1),
    };
  });
}

export function markerTag(): string {
  return MARKER;
}

export function parseWaterCommand(text: string): WaterRule | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 3) {
    return null;
  }

  const [, startDate, interval] = parts;
  const intervalDays = Number(interval);
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 30) {
    return null;
  }

  return {
    startDate,
    intervalDays,
    horizonDays: 30,
    title: "Подача воды",
  };
}

export function formatRule(rule?: WaterRule): string {
  if (!rule) {
    return "Правило воды не задано.";
  }

  return [
    "Текущее правило воды:",
    `Базовая дата: ${rule.startDate}`,
    `Периодичность: каждые ${rule.intervalDays} дн.`,
    `Горизонт: ${rule.horizonDays} дн.`,
    formatExpectedWindow(rule),
  ].join("\n");
}
