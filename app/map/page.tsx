import Link from "next/link";

import { listWaterIncidents } from "@/lib/storage";

import { IncidentsMapClient } from "./map-client";

export const dynamic = "force-dynamic";

function formatIncidentTime(value?: string): string {
  if (!value) {
    return "без времени";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function incidentTitle(kind: string, state: "problem" | "restored"): string {
  if (kind === "low_pressure") {
    return "Проблема с давлением";
  }

  return state === "restored" ? "Вода появилась" : "Нет воды";
}

export default async function MapPage() {
  const incidents = await listWaterIncidents(undefined, 250);
  const latestByAddress = new Map<string, (typeof incidents)[number]>();
  for (const incident of incidents) {
    const key = [incident.city, incident.addressText].filter(Boolean).join("|").toLowerCase();
    if (!key || latestByAddress.has(key)) {
      continue;
    }

    latestByAddress.set(key, incident);
  }

  const latestIncidents = Array.from(latestByAddress.values());
  const geocoded = latestIncidents.filter((incident) => typeof incident.lat === "number" && typeof incident.lon === "number");
  const withoutCoords = incidents.filter((incident) => typeof incident.lat !== "number" || typeof incident.lon !== "number");

  const problemCount = geocoded.filter((incident) => incident.state === "problem").length;
  const restoredCount = geocoded.filter((incident) => incident.state === "restored").length;

  const mapIncidents = geocoded.map((incident) => ({
    id: incident.id,
    state: incident.state,
    kind: incident.kind,
    title: incidentTitle(incident.kind, incident.state),
    subtitle: formatIncidentTime(incident.reportedAt),
    address: [incident.city, incident.addressText].filter(Boolean).join(", "),
    lat: incident.lat!,
    lon: incident.lon!,
    excerpt: incident.excerpt ?? incident.rawText,
    source: incident.sourceTitle ?? incident.sourceChannelSlug,
  }));

  return (
    <main className="incidents-shell">
      <section className="incidents-header">
        <div>
          <p className="eyebrow">Deti Donbassa</p>
          <h1>Карта проблем с водой</h1>
          <p className="lead">
            Здесь собираются сообщения из источников, где удалось распознать адрес и понять, что вода пропала,
            давление слабое или вода снова пошла.
          </p>
        </div>
        <div className="stats-grid">
          <article className="stat-card">
            <span>Всего точек</span>
            <strong>{geocoded.length}</strong>
          </article>
          <article className="stat-card stat-problem">
            <span>Проблемы</span>
            <strong>{problemCount}</strong>
          </article>
          <article className="stat-card stat-restored">
            <span>Восстановлено</span>
            <strong>{restoredCount}</strong>
          </article>
        </div>
      </section>

      <section className="incidents-grid">
        <div className="map-card">
          <IncidentsMapClient incidents={mapIncidents} />
        </div>

        <aside className="feed-card">
          <div className="feed-card-header">
            <h2>Последние сообщения</h2>
            <Link href="/" className="map-link">
              На главную
            </Link>
          </div>

          <div className="feed-list">
            {incidents.length === 0 ? (
              <p className="empty-state">Пока нет сообщений, которые удалось положить на карту.</p>
            ) : (
              incidents.map((incident) => (
                <article key={incident.id} className="feed-item">
                  <div className="feed-item-top">
                    <strong>{incidentTitle(incident.kind, incident.state)}</strong>
                    <span>{formatIncidentTime(incident.reportedAt ?? incident.createdAt)}</span>
                  </div>
                  <p className="feed-address">
                    {[incident.city, incident.addressText].filter(Boolean).join(", ") || "Адрес не распознан"}
                  </p>
                  <p className="feed-excerpt">{incident.excerpt ?? incident.rawText}</p>
                  <p className="feed-source">{incident.sourceTitle ?? incident.sourceChannelSlug ?? "Источник не указан"}</p>
                </article>
              ))
            )}
          </div>

          {withoutCoords.length > 0 ? (
            <div className="feed-note">
              Без координат пока осталось: <strong>{withoutCoords.length}</strong>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
