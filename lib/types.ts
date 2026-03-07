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

export type UserRecord = {
  telegramId: string;
  microsoft?: MicrosoftToken;
  google?: GoogleToken;
  waterRule?: WaterRule;
  botState?: BotState;
  notificationState?: NotificationState;
  lastSyncAt?: string;
};

export type BotState = {
  flow?: "water_setup" | "report_start" | "report_end";
  step?: "choose_month" | "enter_day" | "choose_interval" | "enter_time";
  draftMonth?: number;
  draftDay?: number;
  reportDate?: string;
};

export type NotificationState = {
  dayReminderDate?: string;
  startAlertKey?: string;
  endAlertKey?: string;
};

export type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: {
      id: number;
    };
    from?: {
      id: number;
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
