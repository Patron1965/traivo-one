import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Contact, Image as ImageIcon, ClipboardList, MapPin, Target, Plus,
  Trash2, Phone, Mail, Pencil, Calendar, CalendarClock, CircleSlash,
  Link as LinkIcon, Users, Map as MapIcon, Zap,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { KallaBadge } from "@/lib/metadata-kalla";
import { getWorkOrderStatusBadge } from "@/lib/status-colors";
import { objectLocationTypeLabel, objectLocationTypeBadgeClass } from "@/lib/object-location";
import { useMapConfig } from "@/hooks/use-map-config";
import { PolylineEditor } from "@/components/PolylineEditor";
import type { ServiceObject } from "@shared/schema";
import { DomainCarouselCard } from "./DomainCarouselCard";

// Task #1160+/objektvy-omstrukturering: samlingskort på objektsidan, uppdelade i
// två sektioner via `section`-propen:
//   - "collections" (METADATA): Kontakt, Produktion, Geografi — karuseller.
//   - "linked" (KOPPLADE): Orderkoncept, Snabbordrar, Uppgifter, Bilder — sökbara
//     list-block (bläddra + sök). Systemgenererade domäner (SYS) läses från den
//     delade endpointen `GET /api/objects/:id/system-generated-metadata`.

interface ObjectContactLite {
  id: string;
  name: string;
  contactType?: string;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
  inherited?: boolean;
}
interface ObjectImageLite {
  id: string;
  url?: string | null;
  imageUrl?: string | null;
  title?: string | null;
  description?: string | null;
}
interface ObjectWorkOrderLite {
  id: string;
  title?: string | null;
  status?: string | null;
  orderStatus?: string | null;
  scheduledDate?: string | Date | null;
  lineCount?: number;
  resourceName?: string;
}

interface PointedInConcept {
  id: string;
  name: string;
  status: string | null;
  invoiceModel: string | null;
  customerId: string | null;
  customerName: string | null;
}
interface SystemTaskHistory {
  id: string;
  title: string | null;
  status: string | null;
  orderStatus: string | null;
  scheduledDate: string | null;
  lineCount: number;
}
interface SystemTaskFuture {
  id: string;
  title: string | null;
  status: string | null;
  priority: string | null;
  scheduledDate: string | null;
  quantity: number | null;
  orderConceptId: string | null;
  orderConceptName: string | null;
  customerId: string | null;
  customerName: string | null;
}
interface SystemUnperformedTask {
  id: string;
  title: string | null;
  reasonCode: string | null;
  reason: string | null;
  reasonText: string | null;
  impossibleAt: string | null;
  executionCode: string | null;
}
interface SystemGeneratedMetadata {
  pointedInConcepts: PointedInConcept[];
  tasksHistory: SystemTaskHistory[];
  tasksFuture: SystemTaskFuture[];
  unperformedTasks: SystemUnperformedTask[];
}

type LinkedTaskItem =
  | { kind: "future"; data: SystemTaskFuture }
  | { kind: "unperformed"; data: SystemUnperformedTask };

const fmtDate = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE");
};

const contactTypeLabel = (c: ObjectContactLite): string =>
  c.contactType === "primary" ? "Primär kontakt" : (c.role || c.contactType || "Kontakt");

const woNumberOf = (o: ObjectWorkOrderLite): string =>
  String((o as any).workOrderNumber ?? (o as any).orderNumber ?? "");

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const GRID_CARD = "h-full";

export interface ObjectDomainGridProps {
  /** "collections" = METADATA-samlingar (Kontakt/Produktion/Geografi);
   *  "linked" = KOPPLADE list-block (Orderkoncept/Snabbordrar/Uppgifter/Bilder). */
  section: "collections" | "linked";
  objectId: string;
  obj: any;
  contacts: ObjectContactLite[];
  images: ObjectImageLite[];
  workOrders?: ObjectWorkOrderLite[];
  onAddContact: () => void;
  onDeleteContact: (id: string) => void;
  contactDeletePending: boolean;
  onAddImage: () => void;
  onDeleteImage: (id: string) => void;
  imageDeletePending: boolean;
  onEditGeo: () => void;
  navigate: (path: string) => void;
}

export function ObjectDomainGrid({
  section,
  objectId,
  obj,
  contacts,
  images,
  workOrders = [],
  onAddContact,
  onDeleteContact,
  contactDeletePending,
  onAddImage,
  onDeleteImage,
  imageDeletePending,
  onEditGeo,
  navigate,
}: ObjectDomainGridProps) {
  const mapConfig = useMapConfig();
  const [mapOpen, setMapOpen] = useState(false);

  const { data, isLoading } = useQuery<SystemGeneratedMetadata>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId,
  });

  const concepts = data?.pointedInConcepts ?? [];
  const history = data?.tasksHistory ?? [];
  const future = data?.tasksFuture ?? [];
  const unperformed = data?.unperformedTasks ?? [];

  // Slå ihop primär + övriga kontakter till EN samling; primär överst.
  const sortedContacts = [...contacts].sort(
    (a, b) => (b.contactType === "primary" ? 1 : 0) - (a.contactType === "primary" ? 1 : 0),
  );

  const linkedTasks: LinkedTaskItem[] = [
    ...future.map((d): LinkedTaskItem => ({ kind: "future", data: d })),
    ...unperformed.map((d): LinkedTaskItem => ({ kind: "unperformed", data: d })),
  ];

  const hasCoordinates = obj?.latitude != null && obj?.longitude != null;
  const hasEntrance = obj?.entranceLatitude != null && obj?.entranceLongitude != null;

  const renderContact = (c: ObjectContactLite) => (
    <div className="p-3 border rounded-lg" data-testid={`contact-card-${c.id}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm truncate">{c.name}</span>
        <div className="flex items-center gap-1">
          {c.inherited && <Badge variant="outline" className="text-[10px]">Ärvd</Badge>}
          {!c.inherited && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => onDeleteContact(c.id)}
              disabled={contactDeletePending}
              data-testid={`button-delete-contact-${c.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">{contactTypeLabel(c)}</div>
      {c.phone && (
        <div className="text-xs mt-1 flex items-center gap-1">
          <Phone className="h-3 w-3 text-muted-foreground" /> {c.phone}
        </div>
      )}
      {c.email && (
        <div className="text-xs flex items-center gap-1">
          <Mail className="h-3 w-3 text-muted-foreground" /> {c.email}
        </div>
      )}
    </div>
  );

  const renderImage = (img: ObjectImageLite) => (
    <div className="relative group" data-testid={`image-card-${img.id}`}>
      <div className="aspect-video rounded-lg overflow-hidden border bg-muted">
        <img
          src={img.url || img.imageUrl || ""}
          alt={img.description || img.title || "Bild"}
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>
      <Button
        variant="destructive"
        size="sm"
        className="absolute top-1 right-1 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onDeleteImage(img.id)}
        disabled={imageDeletePending}
        data-testid={`button-delete-image-${img.id}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      {img.description && (
        <div className="text-xs text-muted-foreground mt-1 truncate">{img.description}</div>
      )}
    </div>
  );

  const renderProduction = (o: SystemTaskHistory) => (
    <button
      type="button"
      onClick={() => navigate(`/work-orders/${o.id}`)}
      className="w-full text-left rounded-lg border border-border p-3 hover-elevate"
      data-testid={`row-production-${o.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{o.title || "Uppgift"}</div>
          <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            {fmtDate(o.scheduledDate) && <span>{fmtDate(o.scheduledDate)}</span>}
            {o.lineCount > 0 && <span>{o.lineCount} rader</span>}
          </div>
        </div>
        {o.orderStatus && (
          <Badge className={`text-[10px] shrink-0 ${getWorkOrderStatusBadge(o.orderStatus)}`}>
            {o.orderStatus}
          </Badge>
        )}
      </div>
    </button>
  );

  const renderWorkOrder = (o: ObjectWorkOrderLite) => {
    const num = woNumberOf(o);
    const badge = o.orderStatus || o.status;
    return (
      <button
        type="button"
        onClick={() => navigate(`/work-orders/${o.id}`)}
        className="w-full text-left rounded-lg border border-border p-3 hover-elevate"
        data-testid={`row-workorder-${o.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{o.title || "Snabborder"}</div>
            <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
              {num && <span className="font-mono">#{num}</span>}
              {fmtDate(o.scheduledDate) && (
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(o.scheduledDate)}</span>
              )}
              {typeof o.lineCount === "number" && o.lineCount > 0 && <span>{o.lineCount} rader</span>}
              {o.resourceName && <span className="truncate">{o.resourceName}</span>}
            </div>
          </div>
          {badge && (
            <Badge className={`text-[10px] shrink-0 ${getWorkOrderStatusBadge(badge)}`}>{badge}</Badge>
          )}
        </div>
      </button>
    );
  };

  const renderLinkedTask = (item: LinkedTaskItem) => {
    if (item.kind === "future") {
      const a = item.data;
      return (
        <div className="rounded-lg border border-border p-3" data-testid={`linked-task-future-${a.id}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{a.title || "Uppgift"}</div>
              <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> Kommande</span>
                {fmtDate(a.scheduledDate) && (
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(a.scheduledDate)}</span>
                )}
                {typeof a.quantity === "number" && a.quantity > 0 && <span>{a.quantity} st</span>}
              </div>
            </div>
            {a.status && (
              <Badge className={`text-[10px] shrink-0 ${getWorkOrderStatusBadge(a.status)}`}>{a.status}</Badge>
            )}
          </div>
          {(a.orderConceptId || a.customerId) && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {a.orderConceptId && (
                <Button
                  variant="outline" size="sm" className="h-7 px-2 text-xs"
                  onClick={() => navigate(`/order-concepts/${a.orderConceptId}/edit`)}
                  data-testid={`link-linked-task-concept-${a.id}`}
                >
                  <LinkIcon className="h-3 w-3 mr-1" />{a.orderConceptName || "Orderkoncept"}
                </Button>
              )}
              {a.customerId && (
                <Button
                  variant="ghost" size="sm" className="h-7 px-2 text-xs"
                  onClick={() => navigate(`/customers/${a.customerId}`)}
                  data-testid={`link-linked-task-customer-${a.id}`}
                >
                  <Users className="h-3 w-3 mr-1" />{a.customerName || "Kund"}
                </Button>
              )}
            </div>
          )}
        </div>
      );
    }
    const u = item.data;
    return (
      <div className="rounded-lg border border-destructive/30 p-3" data-testid={`linked-task-unperformed-${u.id}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate flex items-center gap-1.5">
              <CircleSlash className="h-3.5 w-3.5 text-destructive" />{u.title || "Uppgift"}
            </div>
            {u.reasonText && <div className="text-xs text-muted-foreground truncate">{u.reasonText}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
            {u.reason && <Badge variant="destructive" className="text-[10px]">{u.reason}</Badge>}
            {fmtDate(u.impossibleAt) && <span className="text-xs">{fmtDate(u.impossibleAt)}</span>}
          </div>
        </div>
      </div>
    );
  };

  const renderConcept = (c: PointedInConcept) => (
    <div className="rounded-lg border border-border p-3" data-testid={`linked-concept-${c.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{c.name}</div>
          {c.customerName && <div className="text-xs text-muted-foreground truncate">{c.customerName}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {c.invoiceModel && <Badge variant="outline" className="text-[10px]">{c.invoiceModel}</Badge>}
          {c.status && <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <Button
          variant="outline" size="sm" className="h-7 px-2 text-xs"
          onClick={() => navigate(`/order-concepts/${c.id}/edit`)}
          data-testid={`link-linked-concept-open-${c.id}`}
        >
          <LinkIcon className="h-3 w-3 mr-1" /> Öppna orderkoncept
        </Button>
      </div>
    </div>
  );

  // ==================== KOPPLADE (list-block: bläddra + sök) ====================
  if (section === "linked") {
    return (
      <div
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        data-testid="object-domain-grid-linked"
      >
        <DomainCarouselCard<PointedInConcept>
          className={GRID_CARD}
          icon={Target}
          title="Kopplade orderkoncept"
          description="Orderkoncept som pekar in på detta objekt."
          items={concepts}
          getKey={(c) => c.id}
          loading={isLoading}
          emptyText="Inga orderkoncept pekar in."
          testidPrefix="linked-concepts"
          getFooter={() => ({ kalla: "SYS" })}
          getSearchText={(c) => `${c.name} ${c.customerName ?? ""}`}
          renderItem={renderConcept}
        />

        <DomainCarouselCard<ObjectWorkOrderLite>
          className={GRID_CARD}
          icon={Zap}
          title="Snabbordrar"
          description="Objektets arbetsordrar."
          items={workOrders}
          getKey={(o) => o.id}
          emptyText="Inga arbetsordrar."
          testidPrefix="workorders"
          getFooter={(o) => ({ time: o.scheduledDate, kalla: "M" })}
          getSearchText={(o) => `${o.title ?? ""} ${o.orderStatus ?? o.status ?? ""} ${woNumberOf(o)}`}
          renderItem={renderWorkOrder}
        />

        <DomainCarouselCard<LinkedTaskItem>
          className={GRID_CARD}
          icon={ClipboardList}
          title="Uppgifter"
          description="Kommande (planeringslager) och ej-utförda uppgifter."
          items={linkedTasks}
          getKey={(t) => `${t.kind}-${t.data.id}`}
          loading={isLoading}
          emptyText="Inga kopplade uppgifter."
          testidPrefix="linked-tasks"
          getFooter={(t) => ({
            time: t.kind === "future" ? t.data.scheduledDate : t.data.impossibleAt,
            kalla: "SYS",
          })}
          getSearchText={(t) =>
            t.kind === "future"
              ? `${t.data.title ?? ""} ${t.data.orderConceptName ?? ""} ${t.data.customerName ?? ""}`
              : `${t.data.title ?? ""} ${t.data.reason ?? ""} ${t.data.reasonText ?? ""}`
          }
          renderItem={renderLinkedTask}
        />

        <DomainCarouselCard<ObjectImageLite>
          className={GRID_CARD}
          icon={ImageIcon}
          title="Bilder"
          items={images}
          getKey={(img) => img.id}
          hideWhenEmpty={false}
          emptyText="Inga bilder uppladdade."
          testidPrefix="images"
          getFooter={() => ({ kalla: "M" })}
          getSearchText={(img) => `${img.description ?? ""} ${img.title ?? ""}`}
          headerAction={
            <Button variant="outline" size="sm" onClick={onAddImage} data-testid="button-add-image">
              <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
            </Button>
          }
          renderItem={renderImage}
        />
      </div>
    );
  }

  // ==================== METADATA-SAMLINGAR (karuseller) ====================
  return (
    <>
      <div
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        data-testid="object-domain-grid-collections"
      >
        <DomainCarouselCard<ObjectContactLite>
          className={GRID_CARD}
          icon={Contact}
          title="Kontakt"
          description="Objektets kontaktpersoner (primär överst, ärvda inkluderade)."
          items={sortedContacts}
          getKey={(c) => c.id}
          hideWhenEmpty={false}
          emptyText="Inga kontakter."
          testidPrefix="contacts"
          getFooter={(c) => ({ kalla: c.inherited ? "S" : "M", who: c.inherited ? "Ärvd" : undefined })}
          headerAction={
            <Button variant="outline" size="sm" onClick={onAddContact} data-testid="button-add-contact">
              <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
            </Button>
          }
          renderItem={renderContact}
        />

        <DomainCarouselCard<SystemTaskHistory>
          className={GRID_CARD}
          icon={ClipboardList}
          title="Produktion"
          description="Utförda och historiska uppgifter på detta objekt."
          items={history}
          getKey={(o) => o.id}
          loading={isLoading}
          emptyText="Inga utförda uppgifter ännu."
          testidPrefix="production"
          getFooter={(o) => ({ time: o.scheduledDate, kalla: "SYS" })}
          renderItem={renderProduction}
        />

        {/* Geografi (karta i dialog) */}
        <Card className={`${GRID_CARD}`} data-testid="card-location">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Geografi
                <KallaBadge kalla="SYS" />
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEditGeo} data-testid="button-edit-location">
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Badge variant="outline" className={objectLocationTypeBadgeClass(obj)} data-testid="badge-location-type">
              {objectLocationTypeLabel(obj)}
            </Badge>
            {obj?.address && (
              <div className="text-sm break-words" data-testid="text-location-address">{obj.address}</div>
            )}
            {hasCoordinates ? (
              <div className="text-xs text-muted-foreground tabular-nums" data-testid="text-location-coords">
                {Number(obj.latitude).toFixed(5)}, {Number(obj.longitude).toFixed(5)}
                {hasEntrance && " • entré satt"}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Inga koordinater tillgängliga.</div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-1 w-full"
              onClick={() => setMapOpen(true)}
              data-testid="button-show-map"
            >
              <MapIcon className="h-3.5 w-3.5 mr-1" /> Visa på karta
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Karta-dialog (mount-on-open) */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Karta — {obj?.name || obj?.objectNumber || "Objekt"}</DialogTitle>
            <DialogDescription>Objektets position, entrékoordinat och rutt.</DialogDescription>
          </DialogHeader>
          {mapOpen && hasCoordinates ? (
            <div className="space-y-4">
              <div className="rounded-lg overflow-hidden border" style={{ height: 400 }}>
                <MapContainer
                  center={[Number(obj.latitude), Number(obj.longitude)]}
                  zoom={16}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} />
                  <Marker position={[Number(obj.latitude), Number(obj.longitude)]} icon={defaultIcon}>
                    <Popup>
                      <strong>{obj.name || obj.objectNumber}</strong>
                      {obj.address && <br />}
                      {obj.address}
                    </Popup>
                  </Marker>
                  {hasEntrance && (
                    <Marker
                      position={[Number(obj.entranceLatitude), Number(obj.entranceLongitude)]}
                      icon={L.divIcon({
                        className: "entrance-marker",
                        html: '<div style="background:#22c55e;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>',
                        iconSize: [12, 12],
                        iconAnchor: [6, 6],
                      })}
                    >
                      <Popup>Entrékoordinat</Popup>
                    </Marker>
                  )}
                </MapContainer>
              </div>
              <PolylineEditor object={obj as ServiceObject} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 bg-muted/30 rounded-lg">
              <div className="text-center text-muted-foreground">
                <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Inga koordinater tillgängliga</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
