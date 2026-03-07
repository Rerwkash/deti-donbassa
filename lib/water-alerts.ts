import { listUsers, upsertUser } from "@/lib/storage";
import { sendTelegramMessage } from "@/lib/telegram";
import { sendWaterDayReminder } from "@/lib/telegram-bot";
import { currentDateString, currentTimeString, formatExpectedWindow, isWaterDay, notificationKey } from "@/lib/water";

const DAY_REMINDER_TIME = "06:00";

export async function processWaterAlerts(now = new Date()) {
  const users = await listUsers();
  const today = currentDateString(now);
  const currentTime = currentTimeString(now);
  let reminded = 0;

  for (const user of users) {
    if (!user.waterRule || !isWaterDay(user.waterRule, today)) {
      continue;
    }

    const nextNotificationState = { ...(user.notificationState ?? {}) };

    if (currentTime >= DAY_REMINDER_TIME && nextNotificationState.dayReminderDate !== today) {
      await sendWaterDayReminder(
        user.telegramId,
        [
          `Сегодня, ${today}, по графику должна быть вода.`,
          formatExpectedWindow(user.waterRule),
          "Когда вода реально пойдет или закончится, отметь это кнопками ниже.",
        ].join("\n"),
        today,
      );
      nextNotificationState.dayReminderDate = today;
      reminded += 1;
    }

    if (user.waterRule.startTime) {
      const startKey = notificationKey(today, user.waterRule.startTime);
      if (currentTime >= user.waterRule.startTime && nextNotificationState.startAlertKey !== startKey) {
        await sendTelegramMessage(
          user.telegramId,
          `По графику вода должна уже пойти.\nОжидаемое время: ${user.waterRule.startTime}`,
        );
        nextNotificationState.startAlertKey = startKey;
        reminded += 1;
      }
    }

    if (user.waterRule.endTime) {
      const endKey = notificationKey(today, user.waterRule.endTime);
      if (currentTime >= user.waterRule.endTime && nextNotificationState.endAlertKey !== endKey) {
        await sendTelegramMessage(
          user.telegramId,
          `По графику вода должна уже закончиться.\nОжидаемое время окончания: ${user.waterRule.endTime}`,
        );
        nextNotificationState.endAlertKey = endKey;
        reminded += 1;
      }
    }

    await upsertUser(user.telegramId, (current) => ({
      ...current,
      notificationState: nextNotificationState,
    }));
  }

  return {
    ok: true,
    reminded,
  };
}
