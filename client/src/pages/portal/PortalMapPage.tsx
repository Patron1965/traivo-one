import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, Loader2, Map as MapIcon } from "lucide-react";
import { useMapConfig } from "@/hooks/use-map-config";

interface PortalObject {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  objectType?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

const objectTypeLabels: Record<string, string> = {
  omrade: "Område",
  fastighet: "Fastighet",
  serviceboende: "Serviceboende",
  rum: "Rum",
  soprum: "Soprum",
  kok: "Kök",
  uj_hushallsavfall: "UJ Hushållsavfall",
  matafall: "Matavfall",
  atervinning: "Återvinning",
};

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

async function portalFetch(url: string) {
  const token = getSessionToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    window.location.href = "/portal";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Något gick fel" }));
    throw new Error(error.error || "Något gick fel");
  }
  return res.json();
}

function createObjectIcon() {
  return L.divIcon({
    className: "portal-object-marker",
    html: `<div style="
      background-color: #1B4B6B;
      color: white;
      border-radius: 50% 50% 50% 0;
      width: 28px;
      height: 28px;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    "><div style="transform: rotate(45deg); width: 8px; height: 8px; border-radius: 50%; background: white;"></div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -26],
  });
}

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [points, map]);
  return null;
}

export default function PortalMapPage() {
  const mapConfig = useMapConfig();

  const { data: objects, isLoading, error } = useQuery<PortalObject[]>({
    queryKey: ["/api/portal/objects"],
    queryFn: () => portalFetch("/api/portal/objects"),
  });

  const withCoords = useMemo(
    () =>
      (objects ?? []).filter(
        (o): o is PortalObject & { latitude: number; longitude: number } =>
          typeof o.latitude === "number" && typeof o.longitude === "number"
      ),
    [objects]
  );

  const withoutCoords = useMemo(
    () => (objects ?? []).filter((o) => typeof o.latitude !== "number" || typeof o.longitude !== "number"),
    [objects]
  );

  const points = useMemo<Array<[number, number]>>(
    () => withCoords.map((o) => [o.latitude, o.longitude] as [number, number]),
    [withCoords]
  );

  const icon = useMemo(createObjectIcon, []);

  const defaultCenter: [number, number] = [62.0, 15.0];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link href="/portal/dashboard">
            <Button variant="ghost" size="sm" data-testid="button-back-dashboard">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Tillbaka
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <MapIcon className="h-5 w-5 text-[#1B4B6B]" />
            <h1 className="text-lg font-semibold" data-testid="text-page-title">Karta över mina objekt</h1>
          </div>
          {objects && (
            <Badge variant="secondary" className="ml-auto" data-testid="badge-object-count">
              {withCoords.length} av {objects.length} på karta
            </Badge>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="p-12 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Kunde inte ladda objekt: {(error as Error).message}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden">
              <div className="h-[60vh] w-full" data-testid="map-portal-objects">
                <MapContainer
                  center={points[0] ?? defaultCenter}
                  zoom={points.length > 0 ? 13 : 5}
                  scrollWheelZoom
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} />
                  <FitBounds points={points} />
                  {withCoords.map((o) => (
                    <Marker
                      key={o.id}
                      position={[o.latitude, o.longitude]}
                      icon={icon}
                    >
                      <Popup>
                        <div className="space-y-1 min-w-[180px]">
                          <div className="font-semibold text-sm" data-testid={`text-popup-name-${o.id}`}>
                            {o.name}
                          </div>
                          {o.objectType && (
                            <div className="text-xs text-muted-foreground">
                              {objectTypeLabels[o.objectType] ?? o.objectType}
                            </div>
                          )}
                          {(o.address || o.city) && (
                            <div className="text-xs flex items-start gap-1">
                              <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                              <span>
                                {[o.address, [o.postalCode, o.city].filter(Boolean).join(" ")]
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            </div>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            </Card>

            {withCoords.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-coords">
                  Inga objekt har koordinater ännu. Kontakta din leverantör för att få objekten geokodade.
                </CardContent>
              </Card>
            )}

            {withoutCoords.length > 0 && (
              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="text-sm font-medium" data-testid="text-missing-heading">
                    Objekt utan koordinater ({withoutCoords.length})
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Dessa objekt visas inte på kartan eftersom de saknar position.
                  </div>
                  <ul className="text-sm divide-y">
                    {withoutCoords.map((o) => (
                      <li key={o.id} className="py-2 flex items-center justify-between gap-2" data-testid={`row-missing-${o.id}`}>
                        <span className="truncate">{o.name}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {[o.address, o.city].filter(Boolean).join(", ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
