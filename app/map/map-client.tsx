"use client";

import dynamicImport from "next/dynamic";

type MapIncident = {
  id: number;
  state: "problem" | "restored";
  kind: string;
  title: string;
  subtitle: string;
  address: string;
  lat: number;
  lon: number;
  excerpt: string;
  source?: string;
};

const IncidentsMap = dynamicImport(() => import("./map-view").then((module) => module.IncidentsMap), {
  ssr: false,
  loading: () => (
    <div className="incidents-map incidents-map-loading">
      <p className="empty-state">Карта загружается...</p>
    </div>
  ),
});

export function IncidentsMapClient({ incidents }: { incidents: MapIncident[] }) {
  return <IncidentsMap incidents={incidents} />;
}
