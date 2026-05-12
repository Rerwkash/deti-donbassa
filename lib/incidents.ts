import { createHash } from "node:crypto";

import { env } from "@/lib/env";
import { getWaterIncidentGeocode, upsertWaterIncident, upsertWaterIncidentGeocode } from "@/lib/storage";
import {
  NewsSourceRecord,
  ScrapedNewsPost,
  WaterIncidentGeocode,
  WaterIncidentKind,
  WaterIncidentRecord,
} from "@/lib/types";

type ParsedWaterIncident = {
  kind: WaterIncidentKind;
  state: WaterIncidentRecord["state"];
  city: string;
  district?: string;
  street: string;
  house: string;
  addressText: string;
  excerpt: string;
};

type ParsedAddress = {
  street: string;
  house: string;
  addressText: string;
};

type CityGeocodeHint = {
  query: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const WATER_NEGATIVE_PHRASES = [
  "\u043d\u0435\u0442 \u0432\u043e\u0434\u044b",
  "\u0432\u043e\u0434\u044b \u043d\u0435\u0442",
  "\u0431\u0435\u0437 \u0432\u043e\u0434\u044b",
  "\u0432\u043e\u0434\u0430 \u043d\u0435 \u0438\u0434\u0435\u0442",
  "\u0432\u043e\u0434\u044b \u043d\u0435 \u0431\u044b\u043b\u043e",
  "\u0432\u043e\u0434\u044b \u043d\u0435\u0442\u0443",
  "\u043d\u0435\u0442\u0443 \u0432\u043e\u0434\u044b",
  "\u043e\u0442\u043a\u043b\u044e\u0447\u0438\u043b\u0438 \u0432\u043e\u0434\u0443",
  "\u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u0432\u043e\u0434\u044b",
  "\u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u0430 \u0432\u043e\u0434\u0430",
  "\u0432\u043e\u0434\u0430 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442",
  "\u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0432\u043e\u0434\u0430",
  "\u043d\u0435\u0442 \u0432\u043e\u0434\u043e\u0441\u043d\u0430\u0431\u0436\u0435\u043d\u0438\u044f",
  "\u0431\u0435\u0437 \u0432\u043e\u0434\u043e\u0441\u043d\u0430\u0431\u0436\u0435\u043d\u0438\u044f",
  "\u0432\u043e\u0434\u043e\u0441\u043d\u0430\u0431\u0436\u0435\u043d\u0438\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442",
  "\u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0432\u043e\u0434\u043e\u0441\u043d\u0430\u0431\u0436\u0435\u043d\u0438\u0435",
  "\u043d\u0435\u0442 \u0445\u043e\u043b\u043e\u0434\u043d\u043e\u0439 \u0432\u043e\u0434\u044b",
  "\u043d\u0435\u0442 \u0433\u043e\u0440\u044f\u0447\u0435\u0439 \u0432\u043e\u0434\u044b",
  "\u0445\u043e\u043b\u043e\u0434\u043d\u043e\u0439 \u0432\u043e\u0434\u044b \u043d\u0435\u0442",
  "\u0433\u043e\u0440\u044f\u0447\u0435\u0439 \u0432\u043e\u0434\u044b \u043d\u0435\u0442",
  "\u043f\u0440\u0435\u043a\u0440\u0430\u0449\u0435\u043d\u0430 \u043f\u043e\u0434\u0430\u0447\u0430 \u0432\u043e\u0434\u044b",
  "\u043d\u0435\u0442 \u043f\u043e\u0434\u0430\u0447\u0438 \u0432\u043e\u0434\u044b",
  "\u043f\u043e\u0434\u0430\u0447\u0430 \u0432\u043e\u0434\u044b \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442",
] as const;

const WATER_RESTORED_PHRASES = [
  "\u0432\u043e\u0434\u0430 \u043f\u043e\u0448\u043b\u0430",
  "\u043f\u043e\u0448\u043b\u0430 \u0432\u043e\u0434\u0430",
  "\u0434\u0430\u043b\u0438 \u0432\u043e\u0434\u0443",
  "\u0432\u043e\u0434\u0430 \u0435\u0441\u0442\u044c",
  "\u043f\u043e\u044f\u0432\u0438\u043b\u0430\u0441\u044c \u0432\u043e\u0434\u0430",
  "\u0434\u0430\u043b\u0438 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u0435",
  "\u0432\u043a\u043b\u044e\u0447\u0438\u043b\u0438 \u0432\u043e\u0434\u0443",
  "\u0432\u043e\u0434\u043e\u0441\u043d\u0430\u0431\u0436\u0435\u043d\u0438\u0435 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u043e",
  "\u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043b\u0438 \u0432\u043e\u0434\u043e\u0441\u043d\u0430\u0431\u0436\u0435\u043d\u0438\u0435",
  "\u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0430 \u043f\u043e\u0434\u0430\u0447\u0430 \u0432\u043e\u0434\u044b",
  "\u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043b\u0438 \u043f\u043e\u0434\u0430\u0447\u0443 \u0432\u043e\u0434\u044b",
  "\u0432\u043e\u0437\u043e\u0431\u043d\u043e\u0432\u0438\u043b\u0438 \u043f\u043e\u0434\u0430\u0447\u0443 \u0432\u043e\u0434\u044b",
  "\u0432\u043e\u0437\u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430 \u043f\u043e\u0434\u0430\u0447\u0430 \u0432\u043e\u0434\u044b",
  "\u043f\u043e\u0434\u0430\u0447\u0443 \u0432\u043e\u0434\u044b \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043b\u0438",
  "\u043f\u043e\u0434\u0430\u0447\u0430 \u0432\u043e\u0434\u044b \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0430",
] as const;

const LOW_PRESSURE_PHRASES = [
  "\u043d\u0435\u0442 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u044f",
  "\u043d\u0435\u0442 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0432\u043e\u0434\u044b",
  "\u0441\u043b\u0430\u0431\u043e\u0435 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u0435",
  "\u0441\u043b\u0430\u0431\u043e\u0435 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u0432\u043e\u0434\u044b",
  "\u043c\u0430\u043b\u0435\u043d\u044c\u043a\u043e\u0435 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u0435",
  "\u043d\u0435 \u043f\u043e\u0434\u043d\u0438\u043c\u0430\u0435\u0442\u0441\u044f",
  "\u0432\u043e\u0434\u0430 \u043d\u0435 \u043f\u043e\u0434\u043d\u0438\u043c\u0430\u0435\u0442\u0441\u044f",
  "\u0434\u0430\u0439\u0442\u0435 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u0435",
  "\u043d\u0435 \u043f\u043e\u0434\u043d\u0438\u043c\u0430\u0435\u0442\u0441\u044f \u043d\u0430 \u044d\u0442\u0430\u0436\u0438",
  "\u043d\u0435\u0442 \u043d\u0430\u043f\u043e\u0440\u0430",
  "\u0441\u043b\u0430\u0431\u044b\u0439 \u043d\u0430\u043f\u043e\u0440",
  "\u043f\u043b\u043e\u0445\u043e\u0439 \u043d\u0430\u043f\u043e\u0440",
  "\u043d\u0435\u0442 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u043e\u0433\u043e \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u044f",
  "\u043d\u0438\u0437\u043a\u043e\u0435 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u0435",
] as const;

const CITY_KEYWORDS = [
  "\u0414\u043e\u043d\u0435\u0446\u043a",
  "\u041c\u0430\u043a\u0435\u0435\u0432\u043a\u0430",
  "\u0413\u043e\u0440\u043b\u043e\u0432\u043a\u0430",
  "\u042f\u0441\u0438\u043d\u043e\u0432\u0430\u0442\u0430\u044f",
  "\u0415\u043d\u0430\u043a\u0438\u0435\u0432\u043e",
  "\u0425\u0430\u0440\u0446\u044b\u0437\u0441\u043a",
  "\u0428\u0430\u0445\u0442\u0435\u0440\u0441\u043a",
  "\u0421\u043d\u0435\u0436\u043d\u043e\u0435",
  "\u0414\u043e\u043a\u0443\u0447\u0430\u0435\u0432\u0441\u043a",
  "\u041c\u0430\u0440\u0438\u0443\u043f\u043e\u043b\u044c",
] as const;

const CITY_GEOCODE_HINTS: Record<string, CityGeocodeHint> = {
  "\u0414\u043e\u043d\u0435\u0446\u043a": {
    query: "\u0414\u043e\u043d\u0435\u0446\u043a, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 37.55,
    right: 38.1,
    top: 48.2,
    bottom: 47.85,
  },
  "\u041c\u0430\u043a\u0435\u0435\u0432\u043a\u0430": {
    query: "\u041c\u0430\u043a\u0435\u0435\u0432\u043a\u0430, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 37.78,
    right: 38.13,
    top: 48.15,
    bottom: 47.95,
  },
  "\u0413\u043e\u0440\u043b\u043e\u0432\u043a\u0430": {
    query: "\u0413\u043e\u0440\u043b\u043e\u0432\u043a\u0430, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 37.78,
    right: 38.3,
    top: 48.42,
    bottom: 48.18,
  },
  "\u042f\u0441\u0438\u043d\u043e\u0432\u0430\u0442\u0430\u044f": {
    query: "\u042f\u0441\u0438\u043d\u043e\u0432\u0430\u0442\u0430\u044f, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 37.72,
    right: 38.02,
    top: 48.23,
    bottom: 48.02,
  },
  "\u0415\u043d\u0430\u043a\u0438\u0435\u0432\u043e": {
    query: "\u0415\u043d\u0430\u043a\u0438\u0435\u0432\u043e, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 38.05,
    right: 38.35,
    top: 48.32,
    bottom: 48.13,
  },
  "\u0425\u0430\u0440\u0446\u044b\u0437\u0441\u043a": {
    query: "\u0425\u0430\u0440\u0446\u044b\u0437\u0441\u043a, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 38.0,
    right: 38.28,
    top: 48.13,
    bottom: 47.94,
  },
  "\u0428\u0430\u0445\u0442\u0435\u0440\u0441\u043a": {
    query: "\u0428\u0430\u0445\u0442\u0435\u0440\u0441\u043a, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 38.31,
    right: 38.63,
    top: 48.13,
    bottom: 47.95,
  },
  "\u0421\u043d\u0435\u0436\u043d\u043e\u0435": {
    query: "\u0421\u043d\u0435\u0436\u043d\u043e\u0435, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 38.6,
    right: 38.92,
    top: 48.12,
    bottom: 47.93,
  },
  "\u0414\u043e\u043a\u0443\u0447\u0430\u0435\u0432\u0441\u043a": {
    query: "\u0414\u043e\u043a\u0443\u0447\u0430\u0435\u0432\u0441\u043a, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 37.53,
    right: 37.82,
    top: 47.83,
    bottom: 47.66,
  },
  "\u041c\u0430\u0440\u0438\u0443\u043f\u043e\u043b\u044c": {
    query: "\u041c\u0430\u0440\u0438\u0443\u043f\u043e\u043b\u044c, \u0414\u043e\u043d\u0435\u0446\u043a\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c, \u0423\u043a\u0440\u0430\u0438\u043d\u0430",
    left: 37.34,
    right: 37.77,
    top: 47.21,
    bottom: 46.98,
  },
};

const DISTRICT_KEYWORDS = [
  "\u0413\u043b\u0430\u0434\u043a\u043e\u0432\u043a\u0430",
  "\u041e\u043a\u0442\u044f\u0431\u0440\u044c\u0441\u043a\u0438\u0439",
  "\u041a\u0430\u043b\u0438\u043d\u0438\u043d\u0441\u043a\u0438\u0439",
  "\u041a\u0438\u0435\u0432\u0441\u043a\u0438\u0439",
  "\u0412\u043e\u0440\u043e\u0448\u0438\u043b\u043e\u0432\u0441\u043a\u0438\u0439",
  "\u0411\u0443\u0434\u0435\u043d\u043d\u043e\u0432\u0441\u043a\u0438\u0439",
  "\u041f\u0435\u0442\u0440\u043e\u0432\u0441\u043a\u0438\u0439",
  "\u041b\u0435\u043d\u0438\u043d\u0441\u043a\u0438\u0439",
  "\u041a\u0438\u0440\u043e\u0432\u0441\u043a\u0438\u0439",
  "\u041a\u0443\u0439\u0431\u044b\u0448\u0435\u0432\u0441\u043a\u0438\u0439",
] as const;

const STREET_SUFFIXES = [
  "\u0432\u043e\u0434\u044b",
  "\u0432\u043e\u0434\u0430",
  "\u0431\u0435\u0437",
  "\u043d\u0435\u0442",
  "\u0434\u0430\u0439\u0442\u0435",
  "\u0434\u0430\u0432\u043b\u0435\u043d\u0438\u0435",
  "\u043d\u0430",
  "\u0441",
  "\u043f\u043e\u0448\u043b\u0430",
  "\u0434\u0430\u043b\u0438",
] as const;

const STREET_PREFIX_PATTERN = String.raw`(?:\u0443\u043b\.?|\u0443\u043b\u0438\u0446\u0430|\u043f\u0440(?:-\u0442)?\.?|\u043f\u0440\u043e\u0441\u043f\u0435\u043a\u0442|\u043f\u0435\u0440\.?|\u043f\u0435\u0440\u0435\u0443\u043b\u043e\u043a|\u0431-\u0440|\u0431\u0443\u043b\u044c\u0432\u0430\u0440|\u043f\u043b\.?|\u043f\u043b\u043e\u0449\u0430\u0434\u044c|\u043d\u0430\u0431\.?|\u043d\u0430\u0431\u0435\u0440\u0435\u0436\u043d\u0430\u044f)\s+`;
const HOUSE_PATTERN = String.raw`\d+\p{L}?(?:[/-]\d+\p{L}?)?`;
const STREET_WORD_PATTERN = String.raw`[A-Z\u0410-\u042f\u0401][A-Za-z0-9\u0410-\u044f\u0401\u0451-]*`;

const ADDRESS_LINE_PATTERNS = [
  new RegExp(
    String.raw`(?:^|[\s,])((?:${STREET_PREFIX_PATTERN})?(?:${STREET_WORD_PATTERN})(?:\s+${STREET_WORD_PATTERN}){0,4})[,\s]+((?:${HOUSE_PATTERN})(?:\s*,\s*${HOUSE_PATTERN})+)(?=$|[\s,.:;!])`,
    "u",
  ),
  new RegExp(
    String.raw`(?:^|[\s,])((?:${STREET_PREFIX_PATTERN})?(?:${STREET_WORD_PATTERN})(?:\s+${STREET_WORD_PATTERN}){0,4})[,\s]+(${HOUSE_PATTERN})(?=$|[\s,.:;!])`,
    "u",
  ),
  new RegExp(
    String.raw`((?:${STREET_WORD_PATTERN})(?:\s+${STREET_WORD_PATTERN}){0,4})\s+(${HOUSE_PATTERN})`,
    "u",
  ),
] as const;

function normalizeWhitespace(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function excerpt(text: string, maxLength = 220): string {
  const normalized = normalizeWhitespace(text).replace(/\n/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function detectCity(text: string): string {
  const lower = text.toLowerCase();
  const match = CITY_KEYWORDS.find((city) => lower.includes(city.toLowerCase()));
  return match ?? "\u0414\u043e\u043d\u0435\u0446\u043a";
}

function detectDistrict(text: string): string | undefined {
  const lower = text.toLowerCase();
  const explicit = DISTRICT_KEYWORDS.find((district) => lower.includes(district.toLowerCase()));
  if (explicit) {
    return explicit;
  }

  const firstChunk = normalizeWhitespace(text).split("\n")[0]?.trim() ?? "";
  const prefixMatch = firstChunk.match(/^([A-Z\u0410-\u042f\u0401][A-Za-z\u0410-\u044f\u0401\u0451-]{2,40})\s*,\s*[A-Z\u0410-\u042f\u0401]/u);
  return prefixMatch?.[1];
}

function comparableWords(value: string): string[] {
  return value
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\b(?:улица|ул|вулиця|проспект|пр-т|пр|переулок|пер|бульвар|бул|площадь|пл|набережная|наб|район|р-н|микрорайон|мкр)\b/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean);
}

function comparableStem(word: string): string {
  const normalized = word.toLowerCase().replaceAll("ё", "е");
  if (normalized.length <= 4) {
    return normalized;
  }

  return normalized.replace(/[аяиоыеуюэьй]$/u, "");
}

function looselyContainsWords(haystack: string, needle: string): boolean {
  const haystackWords = comparableWords(haystack);
  const needleWords = comparableWords(needle);
  if (needleWords.length === 0) {
    return false;
  }

  return needleWords.every((needleWord) => {
    const needleStem = comparableStem(needleWord);
    return haystackWords.some((haystackWord) => {
      const haystackStem = comparableStem(haystackWord);
      return (
        haystackStem === needleStem ||
        haystackStem.startsWith(needleStem) ||
        needleStem.startsWith(haystackStem) ||
        (haystackStem.length >= 4 && needleStem.length >= 4 && haystackStem.slice(0, 4) === needleStem.slice(0, 4))
      );
    });
  });
}

function escapeOverpassRegex(value: string): string {
  return value.replace(/[\\.^$|?*+()[\]{}]/g, "\\$&");
}

function sanitizeStreet(value: string): string {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  while (words.length > 1 && /^[A-Za-zА-Яа-яЁё]$/u.test(words[0] ?? "")) {
    words.shift();
  }
  return words.join(" ").trim();
}

function trimStreetTail(value: string): string {
  const words = sanitizeStreet(value).split(" ");
  while (words.length > 1) {
    const lastWord = words[words.length - 1]?.toLowerCase();
    if (!lastWord || !STREET_SUFFIXES.includes(lastWord as (typeof STREET_SUFFIXES)[number])) {
      break;
    }
    words.pop();
  }
  return words.join(" ").trim();
}

function hasAnyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export function hasWaterIncidentSignal(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  if (
    !lowered.includes("\u0432\u043e\u0434") &&
    !lowered.includes("\u0432\u043e\u0434\u043e\u0441\u043d\u0430\u0431\u0436") &&
    !lowered.includes("\u043f\u043e\u0434\u0430\u0447") &&
    !lowered.includes("\u0434\u0430\u0432\u043b\u0435\u043d") &&
    !lowered.includes("\u043d\u0430\u043f\u043e\u0440")
  ) {
    return false;
  }

  return (
    hasAnyPhrase(lowered, WATER_NEGATIVE_PHRASES) ||
    hasAnyPhrase(lowered, WATER_RESTORED_PHRASES) ||
    hasAnyPhrase(lowered, LOW_PRESSURE_PHRASES)
  );
}

function splitHouseList(housesText: string): string[] {
  return housesText
    .split(",")
    .flatMap((item) => {
      const normalized = item.trim();
      if (!normalized) {
        return [];
      }

      const rangeMatch = normalized.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
      if (!rangeMatch) {
        return [normalized];
      }

      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 30) {
        return [normalized];
      }

      return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
    });
}

function uniqueAddresses(addresses: ParsedAddress[]): ParsedAddress[] {
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = `${address.street}|${address.house}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function addressLineVariants(line: string): string[] {
  const variants = [line.trim()].filter(Boolean);
  let current = line.trim();

  for (let index = 0; index < 2; index += 1) {
    const match = current.match(/^[A-Z\u0410-\u042f\u0401][^,\d]{2,60},\s*(.+)$/u);
    if (!match?.[1]) {
      break;
    }

    current = match[1].trim();
    if (!current) {
      break;
    }

    variants.push(current);
  }

  return [...new Set(variants)];
}

function matchAddresses(line: string): ParsedAddress[] {
  for (const variant of addressLineVariants(line)) {
    for (const pattern of ADDRESS_LINE_PATTERNS) {
      const match = variant.match(pattern);
      if (!match) {
        continue;
      }

      const street = trimStreetTail(match[1]);
      const houses = splitHouseList(match[2]);
      if (!street || houses.length === 0) {
        continue;
      }

      return uniqueAddresses(
        houses.map((house) => ({
          street,
          house,
          addressText: `${street} ${house}`,
        })),
      );
    }
  }

  return [];
}

function extractAddresses(text: string): ParsedAddress[] {
  const normalized = normalizeWhitespace(text);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !line.includes("@"))
    .filter((line) => !/^\d{1,2}:\d{2}$/.test(line));

  const lineMatches = uniqueAddresses(lines.flatMap((line) => matchAddresses(line)));
  if (lineMatches.length > 0) {
    return lineMatches;
  }

  const linkedLineMatches = uniqueAddresses(
    lines
      .map((line, index) => `${line}${lines[index + 1] ? ` ${lines[index + 1]}` : ""}`.trim())
      .flatMap((line) => matchAddresses(line)),
  );
  if (linkedLineMatches.length > 0) {
    return linkedLineMatches;
  }

  const sentenceParts = normalized
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const sentenceMatches = uniqueAddresses(sentenceParts.flatMap((part) => matchAddresses(part)));
  if (sentenceMatches.length > 0) {
    return sentenceMatches;
  }

  const compact = normalized.replace(/\n/g, " ");
  return uniqueAddresses(matchAddresses(compact));
}

export function parseWaterIncidents(text: string): ParsedWaterIncident[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  if (!hasWaterIncidentSignal(normalized)) {
    return [];
  }

  const lowered = normalized.toLowerCase();

  const isRestored = hasAnyPhrase(lowered, WATER_RESTORED_PHRASES);
  const isLowPressure = hasAnyPhrase(lowered, LOW_PRESSURE_PHRASES);
  const isOutage = hasAnyPhrase(lowered, WATER_NEGATIVE_PHRASES);

  let kind: WaterIncidentKind | null = null;
  if (isOutage) {
    kind = "water_outage";
  } else if (isLowPressure) {
    kind = "low_pressure";
  } else if (isRestored) {
    kind = "water_restored";
  }

  if (!kind) {
    return [];
  }

  const addresses = extractAddresses(normalized);
  if (addresses.length === 0) {
    return [];
  }

  const city = detectCity(normalized);
  const district = detectDistrict(normalized);

  return addresses.map((address) => ({
    kind,
    state: kind === "water_restored" ? "restored" : "problem",
    city,
    district,
    street: address.street,
    house: address.house,
    addressText: address.addressText,
    excerpt: excerpt(normalized),
  }));
}

export function parseWaterIncident(text: string): ParsedWaterIncident | null {
  return parseWaterIncidents(text)[0] ?? null;
}

function buildAddressKey(city: string, addressText: string, district?: string): string {
  return [city, district, addressText].filter(Boolean).join("|").toLowerCase().replace(/\s+/g, " ").trim();
}

function isPointInsideHint(lat: number, lon: number, hint: CityGeocodeHint): boolean {
  return lon >= hint.left && lon <= hint.right && lat >= hint.bottom && lat <= hint.top;
}

async function searchNominatim(
  query: string,
  hint?: CityGeocodeHint,
): Promise<Array<{ lat?: string; lon?: string; display_name?: string }>> {
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "3",
    q: query,
  });

  if (hint) {
    params.set("viewbox", `${hint.left},${hint.top},${hint.right},${hint.bottom}`);
    params.set("bounded", "1");
  }

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      "user-agent": `DetiDonbassaBot/1.0 (${env.APP_URL})`,
      "accept-language": "ru",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  return (await response.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
}

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: {
    lat?: number;
    lon?: number;
  };
  tags?: Record<string, string>;
};

async function searchOverpass(query: string): Promise<OverpassElement[]> {
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": `DetiDonbassaBot/1.0 (${env.APP_URL})`,
    },
    body: `data=${encodeURIComponent(query)}`,
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { elements?: OverpassElement[] };
  return payload.elements ?? [];
}

function extractOverpassPoint(element: OverpassElement): { lat: number; lon: number } | null {
  const lat = element.center?.lat ?? element.lat;
  const lon = element.center?.lon ?? element.lon;
  if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon)) {
    return null;
  }

  return { lat, lon };
}

function pickNominatimCandidate(
  rows: Array<{ lat?: string; lon?: string; display_name?: string }>,
  input: Pick<ParsedWaterIncident, "street" | "house" | "district">,
  hint?: CityGeocodeHint,
): { lat: number; lon: number } | null {
  const housePattern = new RegExp(`(?:^|\\D)${escapeOverpassRegex(input.house)}(?:\\D|$)`);
  let bestScore = -1;
  let best: { lat: number; lon: number } | null = null;

  for (const row of rows) {
    if (!row.lat || !row.lon || !row.display_name) {
      continue;
    }

    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      continue;
    }

    if (hint && !isPointInsideHint(lat, lon, hint)) {
      continue;
    }

    const displayName = row.display_name;
    if (!looselyContainsWords(displayName, input.street)) {
      continue;
    }

    let score = 10;
    if (housePattern.test(displayName)) {
      score += 4;
    }
    if (input.district && looselyContainsWords(displayName, input.district)) {
      score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      best = { lat, lon };
    }
  }

  return best;
}

async function geocodeViaOverpass(
  input: Pick<ParsedWaterIncident, "city" | "district" | "street" | "house">,
  hint?: CityGeocodeHint,
): Promise<{ lat: number; lon: number; provider: string } | null> {
  if (!hint) {
    return null;
  }

  const streetPattern = escapeOverpassRegex(input.street);
  const bbox = `${hint.bottom},${hint.left},${hint.top},${hint.right}`;

  const houseQuery = `
[out:json][timeout:20];
(
  node["addr:street"~"${streetPattern}",i]["addr:housenumber"="${input.house}"](${bbox});
  way["addr:street"~"${streetPattern}",i]["addr:housenumber"="${input.house}"](${bbox});
  relation["addr:street"~"${streetPattern}",i]["addr:housenumber"="${input.house}"](${bbox});
);
out center tags;
`.trim();

  const houseRows = await searchOverpass(houseQuery);
  const housePoint = houseRows
    .map((row) => extractOverpassPoint(row))
    .find((point): point is { lat: number; lon: number } => Boolean(point && isPointInsideHint(point.lat, point.lon, hint)));

  if (housePoint) {
    return { ...housePoint, provider: "overpass-address" };
  }

  const streetQuery = `
[out:json][timeout:20];
(
  way[highway][name~"${streetPattern}",i](${bbox});
  way[highway]["name:ru"~"${streetPattern}",i](${bbox});
  way[highway]["name:uk"~"${streetPattern}",i](${bbox});
);
out center tags;
`.trim();

  const streetRows = await searchOverpass(streetQuery);
  const streetPoints = streetRows
    .filter((row) => {
      const tags = row.tags ?? {};
      const nameCandidates = [tags.name, tags["name:ru"], tags["name:uk"]].filter(Boolean).join(" ");
      return looselyContainsWords(nameCandidates, input.street);
    })
    .map((row) => extractOverpassPoint(row))
    .filter((point): point is { lat: number; lon: number } => Boolean(point && isPointInsideHint(point.lat, point.lon, hint)));

  if (streetPoints.length === 0) {
    return null;
  }

  const avgLat = streetPoints.reduce((sum, point) => sum + point.lat, 0) / streetPoints.length;
  const avgLon = streetPoints.reduce((sum, point) => sum + point.lon, 0) / streetPoints.length;
  return {
    lat: avgLat,
    lon: avgLon,
    provider: "overpass-street-center",
  };
}

async function geocodeAddress(
  input: Pick<ParsedWaterIncident, "city" | "district" | "street" | "house" | "addressText">,
): Promise<WaterIncidentGeocode | null> {
  const addressKey = buildAddressKey(input.city, input.addressText, input.district);
  const cached = await getWaterIncidentGeocode(addressKey);
  if (cached && cached.provider !== "overpass-street-center") {
    return cached;
  }

  const hint = CITY_GEOCODE_HINTS[input.city];
  const queries = hint
    ? [
        input.district ? `${input.addressText}, ${input.district}, ${hint.query}` : "",
        input.district ? `${input.street} ${input.house}, ${input.district}, ${hint.query}` : "",
        `${input.addressText}, ${hint.query}`,
        `${input.street} ${input.house}, ${hint.query}`,
        input.district ? `${input.city}, ${input.district}, ${input.addressText}` : "",
        `${input.city}, ${input.addressText}`,
      ]
    : [
        input.district ? `${input.city}, ${input.district}, ${input.addressText}` : "",
        `${input.city}, ${input.addressText}`,
      ];

  let candidate:
    | {
        lat: number;
        lon: number;
        provider: string;
      }
    | undefined;

  for (const query of queries.filter(Boolean)) {
    const rows = await searchNominatim(query, hint);
    const match = pickNominatimCandidate(rows, input, hint);
    if (match) {
      candidate = { ...match, provider: hint ? "nominatim-bounded" : "nominatim" };
      break;
    }
  }

  if (!candidate) {
    candidate = (await geocodeViaOverpass(input, hint)) ?? undefined;
  }

  if (!candidate) {
    if (cached) {
      return cached;
    }
    return null;
  }

  const geocode: WaterIncidentGeocode = {
    addressKey,
    city: input.city,
    addressText: input.addressText,
    lat: candidate.lat,
    lon: candidate.lon,
    provider: candidate.provider,
  };

  return upsertWaterIncidentGeocode(geocode);
}

function incidentFingerprint(source: NewsSourceRecord, post: ScrapedNewsPost, parsed: ParsedWaterIncident): string {
  const hash = createHash("sha1");
  hash.update(source.telegramId);
  hash.update("|");
  hash.update(source.channelSlug);
  hash.update("|");
  hash.update(String(post.postId));
  hash.update("|");
  hash.update(parsed.kind);
  hash.update("|");
  hash.update(parsed.addressText ?? "");
  return hash.digest("hex");
}

export async function recordIncidentFromNewsPost(
  source: NewsSourceRecord,
  post: ScrapedNewsPost,
): Promise<WaterIncidentRecord[]> {
  const parsedItems = parseWaterIncidents(post.text);
  if (parsedItems.length === 0) {
    return [];
  }

  const records: WaterIncidentRecord[] = [];
  for (const parsed of parsedItems) {
    const geocode = await geocodeAddress(parsed);
    records.push(
      await upsertWaterIncident({
        telegramId: source.telegramId,
        fingerprint: incidentFingerprint(source, post, parsed),
        sourceTitle: source.title,
        sourceUrl: source.url,
        sourceChannelSlug: source.channelSlug,
        externalMessageId: String(post.postId),
        rawText: normalizeWhitespace(post.text),
        excerpt: parsed.excerpt,
        kind: parsed.kind,
        state: parsed.state,
        city: parsed.city,
        street: parsed.street,
        house: parsed.house,
        addressText: parsed.addressText,
        lat: geocode?.lat,
        lon: geocode?.lon,
        reportedAt: post.publishedAt,
        geocodedAt: geocode?.lat && geocode?.lon ? new Date().toISOString() : undefined,
      }),
    );
  }

  return records;
}

export async function recordIncidentFromText(
  telegramId: string,
  text: string,
  meta?: {
    sourceTitle?: string;
    sourceUrl?: string;
    sourceChannelSlug?: string;
    externalMessageId?: string;
    reportedAt?: string;
  },
): Promise<WaterIncidentRecord | null> {
  const parsedItems = parseWaterIncidents(text);
  if (parsedItems.length === 0) {
    return null;
  }

  let firstRecord: WaterIncidentRecord | null = null;

  for (const parsed of parsedItems) {
    const fingerprint = createHash("sha1")
      .update(telegramId)
      .update("|manual|")
      .update(meta?.sourceChannelSlug ?? "")
      .update("|")
      .update(meta?.externalMessageId ?? "")
      .update("|")
      .update(parsed.kind)
      .update("|")
      .update(parsed.addressText ?? "")
      .update("|")
      .update(text)
      .digest("hex");

    const geocode = await geocodeAddress(parsed);
    const record = await upsertWaterIncident({
      telegramId,
      fingerprint,
      sourceTitle: meta?.sourceTitle,
      sourceUrl: meta?.sourceUrl,
      sourceChannelSlug: meta?.sourceChannelSlug,
      externalMessageId: meta?.externalMessageId,
      rawText: normalizeWhitespace(text),
      excerpt: parsed.excerpt,
      kind: parsed.kind,
      state: parsed.state,
      city: parsed.city,
      street: parsed.street,
      house: parsed.house,
      addressText: parsed.addressText,
      lat: geocode?.lat,
      lon: geocode?.lon,
      reportedAt: meta?.reportedAt ?? new Date().toISOString(),
      geocodedAt: geocode?.lat && geocode?.lon ? new Date().toISOString() : undefined,
    });

    if (!firstRecord) {
      firstRecord = record;
    }
  }

  return firstRecord;
}
