function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get APP_URL() {
    return required("APP_URL");
  },
  get APP_SECRET() {
    return required("APP_SECRET");
  },
  get TELEGRAM_BOT_TOKEN() {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get TELEGRAM_WEBHOOK_SECRET() {
    return process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  },
  get MICROSOFT_CLIENT_ID() {
    return required("MICROSOFT_CLIENT_ID");
  },
  get MICROSOFT_CLIENT_SECRET() {
    return required("MICROSOFT_CLIENT_SECRET");
  },
  get MICROSOFT_TENANT_ID() {
    return process.env.MICROSOFT_TENANT_ID ?? "common";
  },
  get GOOGLE_CLIENT_ID() {
    return required("GOOGLE_CLIENT_ID");
  },
  get GOOGLE_CLIENT_SECRET() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get SUPABASE_URL() {
    return required("SUPABASE_URL");
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get CRON_SECRET() {
    return required("CRON_SECRET");
  },
};
