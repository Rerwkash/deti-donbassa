import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deti Donbassa Bot",
  description: "Telegram bot and Microsoft Calendar sync for water schedules.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
