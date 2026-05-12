"use client";

import { MapContainer, CircleMarker, Popup, TileLayer } from "react-leaflet";

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

const DONETSK_CENTER: [number, number] = [48.0159, 37.8028];

function markerColor(state: "problem" | "restored"): string {
  return state === "restored" ? "#1f8f63" : "#c6522b";
}

function markerRadius(kind: string): number {
  return kind === "low_pressure" ? 9 : 11;
}

function spreadIncidents(
  incidents: MapIncident[],
): Array<MapIncident & { displayLat: number; displayLon: number }> {
  const groups = new Map<string, MapIncident[]>();

  for (const incident of incidents) {
    const key = `${incident.lat.toFixed(6)}:${incident.lon.toFixed(6)}`;
    const current = groups.get(key) ?? [];
    current.push(incident);
    groups.set(key, current);
  }

  return incidents.map((incident) => {
    const key = `${incident.lat.toFixed(6)}:${incident.lon.toFixed(6)}`;
    const group = groups.get(key) ?? [incident];
    if (group.length === 1) {
      return {
        ...incident,
        displayLat: incident.lat,
        displayLon: incident.lon,
      };
    }

    const index = group.findIndex((item) => item.id === incident.id);
    const angle = (Math.PI * 2 * index) / group.length;
    const offset = 0.00022;

    return {
      ...incident,
      displayLat: incident.lat + Math.sin(angle) * offset,
      displayLon: incident.lon + Math.cos(angle) * offset,
    };
  });
}

export function IncidentsMap({ incidents }: { incidents: MapIncident[] }) {
  const displayIncidents = spreadIncidents(incidents);
  const center =
    displayIncidents.length > 0
      ? ([displayIncidents[0].lat, displayIncidents[0].lon] as [number, number])
      : DONETSK_CENTER;

  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom className="incidents-map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {displayIncidents.map((incident) => (
        <CircleMarker
          key={incident.id}
          center={[incident.displayLat, incident.displayLon]}
          radius={markerRadius(incident.kind)}
          pathOptions={{
            color: markerColor(incident.state),
            fillColor: markerColor(incident.state),
            fillOpacity: 0.7,
            weight: 2,
          }}
        >
          <Popup>
            <strong>{incident.title}</strong>
            <br />
            {incident.address}
            <br />
            {incident.subtitle}
            {incident.source ? (
              <>
                <br />
                Источник: {incident.source}
              </>
            ) : null}
            <br />
            <br />
            {incident.excerpt}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
