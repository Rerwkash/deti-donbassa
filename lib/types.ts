export type WaterRule = {
  startDate: string;
  intervalDays: number;
  horizonDays: number;
  title: string;
  startTime?: string;
  endTime?: string;
};

export type MicrosoftToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  userPrincipalName: string;
  displayName: string;
};

export type GoogleToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  email: string;
  displayName: string;
};

export type TelegramAccountToken = {
  session: string;
  phoneNumber: string;
  userId: string;
  username?: string;
  displayName: string;
  connectedAt: string;
};

export type UserRecord = {
  telegramId: string;
  microsoft?: MicrosoftToken;
  google?: GoogleToken;
  telegramAccount?: TelegramAccountToken;
  waterRule?: WaterRule;
  botState?: BotState;
  notificationState?: NotificationState;
  lastSyncAt?: string;
};

export type NewsSourceRecord = {
  id: number;
  telegramId: string;
  url: string;
  channelSlug: string;
  title?: string;
  lastPostId?: number;
  lastCheckedAt?: string;
  enabled: boolean;
  createdAt?: string;
};

export type NewsSourceSuggestion = {
  channelSlug: string;
  title: string;
  url: string;
  kind: "channel" | "group";
};

export type WaterIncidentKind = "water_outage" | "water_restored" | "low_pressure";

export type WaterIncidentState = "problem" | "restored";

export type WaterIncidentRecord = {
  id: number;
  telegramId: string;
  fingerprint: string;
  sourceTitle?: string;
  sourceUrl?: string;
  sourceChannelSlug?: string;
  externalMessageId?: string;
  rawText: string;
  excerpt?: string;
  kind: WaterIncidentKind;
  state: WaterIncidentState;
  city?: string;
  street?: string;
  house?: string;
  addressText?: string;
  lat?: number;
  lon?: number;
  reportedAt?: string;
  geocodedAt?: string;
  createdAt?: string;
};

export type WaterIncidentGeocode = {
  addressKey: string;
  city?: string;
  addressText: string;
  lat?: number;
  lon?: number;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ScrapedNewsPost = {
  postId: number;
  postUrl: string;
  publishedAt?: string;
  text: string;
  media: ScrapedNewsMedia[];
};

export type ScrapedNewsMedia = {
  type: "photo" | "video";
  url?: string;
  fileName?: string;
  data?: Uint8Array;
  mimeType?: string;
};

export type BotState = {
  flow?: "water_setup" | "report_start" | "report_end" | "news_setup" | "telegram_auth";
  step?:
    | "choose_month"
    | "enter_day"
    | "choose_interval"
    | "enter_time"
    | "enter_news_source"
    | "enter_news_query"
    | "enter_map_range"
    | "confirm_map_message"
    | "await_phone"
    | "await_code"
    | "await_password";
  draftMonth?: number;
  draftDay?: number;
  reportDate?: string;
  phoneNumber?: string;
  phoneCodeHash?: string;
  pendingSession?: string;
  isCodeViaApp?: boolean;
  pendingIncidentText?: string;
};

export type NotificationState = {
  dayReminderDate?: string;
  startAlertKey?: string;
  endAlertKey?: string;
};

export type TelegramUpdate = {
  message?: {
    text?: string;
    caption?: string;
    chat?: {
      id: number;
    };
    from?: {
      id: number;
    };
    contact?: {
      phone_number?: string;
      first_name?: string;
      last_name?: string;
      user_id?: number;
    };
    forward_origin?: {
      type?: string;
      chat?: {
        id?: number;
        type?: string;
        title?: string;
        username?: string;
      };
      sender_chat?: {
        id?: number;
        type?: string;
        title?: string;
        username?: string;
      };
    };
    chat_shared?: {
      chat_id?: number;
      title?: string;
      username?: string;
      type?: string;
    };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat?: {
        id: number;
      };
    };
  };
};

export type GraphEventInput = {
  subject: string;
  content: string;
  timezone: string;
  startIso?: string;
  endIso?: string;
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
};
