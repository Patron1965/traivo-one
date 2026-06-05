import { useState, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Globe, Plus, Pencil, Trash2, MapPin, Layers } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useMapConfig } from "@/hooks/use-map-config";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { GeographicDistrict, DistrictZone } from "@shared/schema";

const districtFormSchema = z.object({
  name: z.string().min(1, "Namn krävs"),
  code: z.string().optional(),
  description: z.string().optional(),
  color: z.string().min(1).default("#3B82F6"),
  centerLat: z.string().optional(),
  centerLng: z.string().optional(),
  status: z.string().default("active"),
});
type DistrictFormValues = z.infer<typeof districtFormSchema>;

const zoneFormSchema = z.object({
  name: z.string().min(1, "Namn krävs"),
  code: z.string().optional(),
  postalCodes: z.string().optional(),
  centerLat: z.string().optional(),
  centerLng: z.string().optional(),
});
type ZoneFormValues = z.infer<typeof zoneFormSchema>;

function parseCoord(v?: string): number | null {
  if (!v || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function MapAutoFit({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points.map((p) => L.latLng(p[0], p[1]))), {
        padding: [40, 40],
        maxZoom: 11,
      });
    } else {
      map.setView([59.3293, 18.0686], 5);
    }
  }, [points, map]);
  return null;
}

const districtIcon = (color: string) =>
  L.divIcon({
    className: "district-marker",
    html: `<div style="background-color:${color};color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:12px;">●</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

export default function DistrictsAdminPage() {
  const { toast } = useToast();
  const mapConfig = useMapConfig();

  const [districtDialogOpen, setDistrictDialogOpen] = useState(false);
  const [editingDistrict, setEditingDistrict] = useState<GeographicDistrict | null>(null);
  const [deleteDistrict, setDeleteDistrict] = useState<GeographicDistrict | null>(null);
  const [selectedDistrictId, setSelectedDistrictId] = useState<string | null>(null);

  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<DistrictZone | null>(null);
  const [deleteZone, setDeleteZone] = useState<DistrictZone | null>(null);

  const districtsQuery = useQuery<GeographicDistrict[]>({
    queryKey: ["/api/districts"],
  });

  const zonesQuery = useQuery<DistrictZone[]>({
    queryKey: ["/api/district-zones", selectedDistrictId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/district-zones?districtId=${encodeURIComponent(selectedDistrictId!)}`,
      );
      return res.json();
    },
    enabled: !!selectedDistrictId,
  });

  const districts = districtsQuery.data ?? [];
  const selectedDistrict = districts.find((d) => d.id === selectedDistrictId) ?? null;

  const mapPoints = useMemo<[number, number][]>(
    () =>
      districts
        .filter((d) => d.centerLat != null && d.centerLng != null)
        .map((d) => [d.centerLat as number, d.centerLng as number]),
    [districts],
  );

  const districtForm = useForm<DistrictFormValues>({
    resolver: zodResolver(districtFormSchema),
    defaultValues: { name: "", code: "", description: "", color: "#3B82F6", centerLat: "", centerLng: "", status: "active" },
  });

  const zoneForm = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneFormSchema),
    defaultValues: { name: "", code: "", postalCodes: "", centerLat: "", centerLng: "" },
  });

  function openCreateDistrict() {
    setEditingDistrict(null);
    districtForm.reset({ name: "", code: "", description: "", color: "#3B82F6", centerLat: "", centerLng: "", status: "active" });
    setDistrictDialogOpen(true);
  }

  function openEditDistrict(d: GeographicDistrict) {
    setEditingDistrict(d);
    districtForm.reset({
      name: d.name,
      code: d.code ?? "",
      description: d.description ?? "",
      color: d.color ?? "#3B82F6",
      centerLat: d.centerLat != null ? String(d.centerLat) : "",
      centerLng: d.centerLng != null ? String(d.centerLng) : "",
      status: d.status ?? "active",
    });
    setDistrictDialogOpen(true);
  }

  const districtMutation = useMutation({
    mutationFn: async (values: DistrictFormValues) => {
      const payload = {
        name: values.name,
        code: values.code || null,
        description: values.description || null,
        color: values.color || "#3B82F6",
        centerLat: parseCoord(values.centerLat),
        centerLng: parseCoord(values.centerLng),
        status: values.status || "active",
      };
      if (editingDistrict) {
        return apiRequest("PATCH", `/api/districts/${editingDistrict.id}`, payload);
      }
      return apiRequest("POST", "/api/districts", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/districts"] });
      setDistrictDialogOpen(false);
      toast({ title: editingDistrict ? "Distrikt uppdaterat" : "Distrikt skapat" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte spara distrikt", description: e.message, variant: "destructive" }),
  });

  const districtDeleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/districts/${id}`),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/districts"] });
      if (selectedDistrictId === id) setSelectedDistrictId(null);
      setDeleteDistrict(null);
      toast({ title: "Distrikt borttaget" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte ta bort", description: e.message, variant: "destructive" }),
  });

  function openCreateZone() {
    setEditingZone(null);
    zoneForm.reset({ name: "", code: "", postalCodes: "", centerLat: "", centerLng: "" });
    setZoneDialogOpen(true);
  }

  function openEditZone(z: DistrictZone) {
    setEditingZone(z);
    zoneForm.reset({
      name: z.name,
      code: z.code ?? "",
      postalCodes: (z.postalCodes ?? []).join(", "),
      centerLat: z.centerLat != null ? String(z.centerLat) : "",
      centerLng: z.centerLng != null ? String(z.centerLng) : "",
    });
    setZoneDialogOpen(true);
  }

  const zoneMutation = useMutation({
    mutationFn: async (values: ZoneFormValues) => {
      const payload = {
        districtId: selectedDistrictId,
        name: values.name,
        code: values.code || null,
        postalCodes: (values.postalCodes || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        centerLat: parseCoord(values.centerLat),
        centerLng: parseCoord(values.centerLng),
      };
      if (editingZone) {
        return apiRequest("PATCH", `/api/district-zones/${editingZone.id}`, payload);
      }
      return apiRequest("POST", "/api/district-zones", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/district-zones", selectedDistrictId] });
      setZoneDialogOpen(false);
      toast({ title: editingZone ? "Zon uppdaterad" : "Zon skapad" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte spara zon", description: e.message, variant: "destructive" }),
  });

  const zoneDeleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/district-zones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/district-zones", selectedDistrictId] });
      setDeleteZone(null);
      toast({ title: "Zon borttagen" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte ta bort", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        icon={Globe}
        title="Distrikt"
        description="Hantera geografiska distrikt och zoner (postnummer/polygon) för grovplanering"
        testId="text-districts-title"
      >
        <Button onClick={openCreateDistrict} data-testid="button-create-district">
          <Plus className="h-4 w-4 mr-2" /> Nytt distrikt
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Distrikt</CardTitle>
          </CardHeader>
          <CardContent>
            <QueryState
              isLoading={districtsQuery.isLoading}
              isError={districtsQuery.isError}
              isEmpty={districts.length === 0}
              error={districtsQuery.error as Error | null}
              onRetry={() => districtsQuery.refetch()}
              loadingVariant="skeleton-rows"
              emptyTitle="Inga distrikt"
              emptyDescription="Skapa ditt första distrikt för att gruppera arbete geografiskt."
              emptyAction={
                <Button onClick={openCreateDistrict} data-testid="button-create-district-empty">
                  <Plus className="h-4 w-4 mr-2" /> Nytt distrikt
                </Button>
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Namn</TableHead>
                    <TableHead>Kod</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Åtgärder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {districts.map((d) => (
                    <TableRow
                      key={d.id}
                      className={`cursor-pointer ${selectedDistrictId === d.id ? "bg-muted" : ""}`}
                      onClick={() => setSelectedDistrictId(d.id)}
                      data-testid={`row-district-${d.id}`}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-border"
                            style={{ backgroundColor: d.color ?? "#3B82F6" }}
                          />
                          {d.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.code || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={d.status === "active" ? "default" : "secondary"}>
                          {d.status === "active" ? "Aktiv" : "Inaktiv"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDistrict(d)}
                          data-testid={`button-edit-district-${d.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteDistrict(d)}
                          data-testid={`button-delete-district-${d.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </QueryState>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Karta
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full overflow-hidden rounded-md border border-border" data-testid="map-districts">
              <MapContainer center={[59.3293, 18.0686]} zoom={5} className="h-full w-full" scrollWheelZoom>
                <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} maxZoom={mapConfig.maxZoom} />
                <MapAutoFit points={mapPoints} />
                {districts
                  .filter((d) => d.centerLat != null && d.centerLng != null)
                  .map((d) => (
                    <div key={d.id}>
                      <Circle
                        center={[d.centerLat as number, d.centerLng as number]}
                        radius={8000}
                        pathOptions={{ color: d.color ?? "#3B82F6", fillColor: d.color ?? "#3B82F6", fillOpacity: 0.12 }}
                      />
                      <Marker
                        position={[d.centerLat as number, d.centerLng as number]}
                        icon={districtIcon(d.color ?? "#3B82F6")}
                        eventHandlers={{ click: () => setSelectedDistrictId(d.id) }}
                      >
                        <Popup>{d.name}</Popup>
                      </Marker>
                    </div>
                  ))}
              </MapContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedDistrict && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4" /> Zoner i {selectedDistrict.name}
            </CardTitle>
            <Button size="sm" onClick={openCreateZone} data-testid="button-create-zone">
              <Plus className="h-4 w-4 mr-2" /> Ny zon
            </Button>
          </CardHeader>
          <CardContent>
            <QueryState
              isLoading={zonesQuery.isLoading}
              isError={zonesQuery.isError}
              isEmpty={(zonesQuery.data ?? []).length === 0}
              error={zonesQuery.error as Error | null}
              onRetry={() => zonesQuery.refetch()}
              loadingVariant="skeleton-rows"
              emptyTitle="Inga zoner"
              emptyDescription="Lägg till zoner (t.ex. postnummerområden) inom distriktet."
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Namn</TableHead>
                    <TableHead>Kod</TableHead>
                    <TableHead>Postnummer</TableHead>
                    <TableHead className="text-right">Åtgärder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(zonesQuery.data ?? []).map((z) => (
                    <TableRow key={z.id} data-testid={`row-zone-${z.id}`}>
                      <TableCell className="font-medium">{z.name}</TableCell>
                      <TableCell className="text-muted-foreground">{z.code || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {(z.postalCodes ?? []).length > 0 ? (z.postalCodes ?? []).join(", ") : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openEditZone(z)} data-testid={`button-edit-zone-${z.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteZone(z)} data-testid={`button-delete-zone-${z.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </QueryState>
          </CardContent>
        </Card>
      )}

      {/* District dialog */}
      <Dialog open={districtDialogOpen} onOpenChange={setDistrictDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDistrict ? "Redigera distrikt" : "Nytt distrikt"}</DialogTitle>
            <DialogDescription>Geografiskt distrikt för gruppering och grovplanering.</DialogDescription>
          </DialogHeader>
          <Form {...districtForm}>
            <form
              onSubmit={districtForm.handleSubmit((v) => districtMutation.mutate(v))}
              className="space-y-4"
            >
              <FormField
                control={districtForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-district-name" placeholder="t.ex. Norra distriktet" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={districtForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kod</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-district-code" placeholder="NORR" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={districtForm.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Färg</FormLabel>
                      <FormControl>
                        <Input type="color" {...field} data-testid="input-district-color" className="h-10 p-1" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={districtForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beskrivning</FormLabel>
                    <FormControl>
                      <Textarea {...field} data-testid="input-district-description" rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={districtForm.control}
                  name="centerLat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Latitud (centrum)</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-district-lat" placeholder="59.33" inputMode="decimal" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={districtForm.control}
                  name="centerLng"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Longitud (centrum)</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-district-lng" placeholder="18.07" inputMode="decimal" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDistrictDialogOpen(false)} data-testid="button-cancel-district">
                  Avbryt
                </Button>
                <Button type="submit" disabled={districtMutation.isPending} data-testid="button-save-district">
                  {districtMutation.isPending ? "Sparar…" : "Spara"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Zone dialog */}
      <Dialog open={zoneDialogOpen} onOpenChange={setZoneDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingZone ? "Redigera zon" : "Ny zon"}</DialogTitle>
            <DialogDescription>Zon inom {selectedDistrict?.name}.</DialogDescription>
          </DialogHeader>
          <Form {...zoneForm}>
            <form onSubmit={zoneForm.handleSubmit((v) => zoneMutation.mutate(v))} className="space-y-4">
              <FormField
                control={zoneForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-zone-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={zoneForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kod</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-zone-code" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={zoneForm.control}
                name="postalCodes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postnummer (kommaseparerade)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-zone-postalcodes" placeholder="11122, 11123" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={zoneForm.control}
                  name="centerLat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Latitud</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-zone-lat" inputMode="decimal" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={zoneForm.control}
                  name="centerLng"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Longitud</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-zone-lng" inputMode="decimal" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setZoneDialogOpen(false)} data-testid="button-cancel-zone">
                  Avbryt
                </Button>
                <Button type="submit" disabled={zoneMutation.isPending} data-testid="button-save-zone">
                  {zoneMutation.isPending ? "Sparar…" : "Spara"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete district confirm */}
      <AlertDialog open={!!deleteDistrict} onOpenChange={(o) => !o && setDeleteDistrict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort distrikt?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDistrict?.name} tas bort. Zoner i distriktet tas också bort. Detta går inte att ångra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-district">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDistrict && districtDeleteMutation.mutate(deleteDistrict.id)}
              data-testid="button-confirm-delete-district"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete zone confirm */}
      <AlertDialog open={!!deleteZone} onOpenChange={(o) => !o && setDeleteZone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort zon?</AlertDialogTitle>
            <AlertDialogDescription>{deleteZone?.name} tas bort. Detta går inte att ångra.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-zone">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteZone && zoneDeleteMutation.mutate(deleteZone.id)}
              data-testid="button-confirm-delete-zone"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
