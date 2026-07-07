import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Contact, Image as ImageIcon, FileText, MessageSquare, ClipboardList,
  ClipboardCheck, AlertTriangle, Star, MapPin, Target, History, Plus,
  Trash2, Phone, Mail, Pencil, Sparkles, Calendar, CalendarClock,
  CircleSlash, Link as LinkIcon, Users, Map as MapIcon, Loader2,
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
import { ObjectTimeline } from "@/components/timeline/ObjectTimeline";
import type { ServiceObject, WorkOrderWithObject } from "@shared/schema";
import { DomainCarouselCard } from "./DomainCarouselCard";

// Task #1160+: enhetligt domänkort-nät för objektsidan (mockup). Alla domäner
// renderas som likformiga, kompakta kort i ETT responsivt nät under de sex
// ankargrupperna. Systemgenererade domäner (SYS) läses från den delade single-
// source-endpointen `GET /api/objects/:id/system-generated-metadata`.

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
interface SystemRating {
  id: string;
  workOrderId: string | null;
  resourceName: string | null;
  rating: number;
  comment: string | null;
  createdAt: string | null;
}
interface SystemInspection {
  id: string;
  inspectionType: string | null;
  status: string | null;
  comment: string | null;
  inspectedBy: string | null;
  inspectedAt: string | null;
}
interface SystemCommunication {
  id: string;
  channel: string | null;
  notificationType: string | null;
  recipientName: string | null;
  subject: string | null;
  aiGenerated: boolean;
  status: string | null;
  sentAt: string | null;
}
interface SystemIssueReport {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  status: string | null;
  photos: string[] | null;
  createdAt: string | null;
}
interface SystemGeneratedMetadata {
  pointedInConcepts: PointedInConcept[];
  tasksHistory: SystemTaskHistory[];
  tasksFuture: SystemTaskFuture[];
  unperformedTasks: SystemUnperformedTask[];
  ratings: SystemRating[];
  inspections: SystemInspection[];
  communications: SystemCommunication[];
  issueReports: SystemIssueReport[];
}

type LinkedTaskItem =
  | { kind: "future"; data: SystemTaskFuture }
  | { kind: "unperformed"; data: SystemUnperformedTask };

const COMM_CHANNEL_LABELS: Record<string, string> = {
  email: "E-post", sms: "SMS", push: "Push", phone: "Telefon",
};
const ISSUE_STATUS_LABELS: Record<string, string> = {
  open: "Öppen", new: "Ny", in_progress: "Pågår", pending: "Väntar",
  resolved: "Åtgärdad", closed: "Stängd",
};

const fmtDate = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE");
};

const contactTypeLabel = (c: ObjectContactLite): string =>
  c.contactType === "primary" ? "Primär kontakt" : (c.role || c.contactType || "Kontakt");

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
  objectId: string;
  obj: any;
  contacts: ObjectContactLite[];
  images: ObjectImageLite[];
  metadata: any[];
  onAddContact: () => void;
  onDeleteContact: (id: string) => void;
  contactDeletePending: boolean;
  onAddImage: () => void;
  onDeleteImage: (id: string) => void;
  imageDeletePending: boolean;
  onEditGeo: () => void;
  navigate: (path: string) => void;
  fetchTimeline: (startDate: string, endDate: string) => Promise<WorkOrderWithObject[]>;
  onSelectTimelineTask: (id: string) => void;
}

export function ObjectDomainGrid({
  objectId,
  obj,
  contacts,
  images,
  metadata,
  onAddContact,
  onDeleteContact,
  contactDeletePending,
  onAddImage,
  onDeleteImage,
  imageDeletePending,
  onEditGeo,
  navigate,
  fetchTimeline,
  onSelectTimelineTask,
}: ObjectDomainGridProps) {
  const mapConfig = useMapConfig();
  const [mapOpen, setMapOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data, isLoading } = useQuery<SystemGeneratedMetadata>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId,
  });

  const concepts = data?.pointedInConcepts ?? [];
  const history = data?.tasksHistory ?? [];
  const future = data?.tasksFuture ?? [];
  const unperformed = data?.unperformedTasks ?? [];
  const ratings = data?.ratings ?? [];
  const inspections = data?.inspections ?? [];
  const communications = data?.communications ?? [];
  const issueReports = data?.issueReports ?? [];

  const primaryContacts = contacts.filter((c) => c.contactType === "primary");
  const otherContacts = contacts.filter((c) => c.contactType !== "primary");

  const linkedTasks: LinkedTaskItem[] = [
    ...future.map((data): LinkedTaskItem => ({ kind: "future", data })),
    ...unperformed.map((data): LinkedTaskItem => ({ kind: "unperformed", data })),
  ];

  // Dokument & avtal: härleds ur objektets metadata (svenska katalogen) —
  // fält vars område/kategori/namn antyder dokument/avtal/kontrakt/bilaga.
  // Döljs när inget matchar (hideWhenEmpty).
  const docItems = (metadata ?? []).filter((m: any) => {
    if (m?.softDeleted || m?.raderad) return false;
    const hay = `${m?.katalog?.area ?? ""} ${m?.katalog?.kategori ?? ""} ${m?.katalog?.namn ?? m?.namn ?? ""}`.toLowerCase();
    return /dokument|avtal|kontrakt|bilag/.test(hay);
  });

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

  const renderDoc = (m: any) => {
    const label = m?.katalog?.visningsnamn || m?.katalog?.namn || m?.namn || "Dokument";
    const value = m?.varde ?? m?.value ?? m?.displayValue ?? m?.varde_text ?? null;
    return (
      <div className="p-3 border rounded-lg" data-testid={`doc-card-${m?.id ?? label}`}>
        <div className="text-sm font-medium truncate">{label}</div>
        {value != null && String(value).trim() !== "" && (
          <div className="text-xs text-muted-foreground mt-0.5 break-words">{String(value)}</div>
        )}
      </div>
    );
  };

  const renderCommunication = (c: SystemCommunication) => (
    <div className="rounded-lg border border-border p-3" data-testid={`row-communication-${c.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {c.subject || c.notificationType || "Meddelande"}
          </div>
          {c.recipientName && (
            <p className="mt-1 text-xs text-muted-foreground">Till {c.recipientName}</p>
          )}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {c.channel && (
              <Badge variant="outline" className="text-xs">
                {COMM_CHANNEL_LABELS[c.channel] ?? c.channel}
              </Badge>
            )}
            {c.aiGenerated && (
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> AI
              </Badge>
            )}
          </div>
        </div>
        {c.status && <Badge variant="outline" className="text-xs shrink-0">{c.status}</Badge>}
      </div>
    </div>
  );

  const renderProduction = (o: SystemTaskHistory) => (
    <button
      type="button"
      onClick={() => navigate(`/work-orders/${o.id}`)}
      className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent transition-colors"
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

  const renderInspection = (i: SystemInspection) => (
    <div className="rounded-lg border border-border p-3" data-testid={`row-inspection-${i.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{i.inspectionType || "Inspektion"}</div>
          {i.comment && <p className="mt-1 text-xs text-muted-foreground break-words">{i.comment}</p>}
          {i.inspectedBy && (
            <p className="mt-1 text-xs text-muted-foreground">Inspekterad av {i.inspectedBy}</p>
          )}
        </div>
        {i.status && <Badge variant="outline" className="text-xs shrink-0">{i.status}</Badge>}
      </div>
    </div>
  );

  const renderIssueReport = (it: SystemIssueReport) => (
    <div className="rounded-lg border border-border p-3" data-testid={`row-issue-report-${it.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{it.title || "Felanmälan"}</div>
          {it.description && (
            <p className="mt-1 text-xs text-muted-foreground break-words">{it.description}</p>
          )}
          {it.category && <Badge variant="outline" className="mt-1 text-xs">{it.category}</Badge>}
        </div>
        {it.status && (
          <Badge variant="outline" className="text-xs shrink-0">
            {ISSUE_STATUS_LABELS[it.status] ?? it.status}
          </Badge>
        )}
      </div>
      {Array.isArray(it.photos) && it.photos.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {it.photos.slice(0, 6).map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Foto ${i + 1} för ${it.title || "felanmälan"}`}
              className="h-14 w-14 rounded object-cover border border-border shrink-0"
              data-testid={`img-issue-report-${it.id}-${i}`}
            />
          ))}
        </div>
      )}
    </div>
  );

  const renderRating = (r: SystemRating) => (
    <div className="rounded-lg border border-border p-3" data-testid={`row-rating-${r.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-4 w-4 ${i < r.rating ? "fill-warning text-warning" : "text-muted-foreground"}`}
              />
            ))}
            {r.resourceName && (
              <span className="text-xs text-muted-foreground ml-2 truncate">{r.resourceName}</span>
            )}
          </div>
          {r.comment && <p className="mt-1 text-xs text-muted-foreground break-words">{r.comment}</p>}
        </div>
      </div>
    </div>
  );

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

  const latestHistory = history.slice(0, 4);

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      data-testid="object-domain-grid"
    >
      {/* ---------- KONTAKTUPPGIFTER ---------- */}
      <DomainCarouselCard<ObjectContactLite>
        sectionId="object-section-contacts"
        className={GRID_CARD}
        icon={Contact}
        title="Kontaktperson"
        items={primaryContacts}
        getKey={(c) => c.id}
        hideWhenEmpty={false}
        emptyText="Ingen primär kontakt."
        testidPrefix="primary-contacts"
        getFooter={(c) => ({ kalla: c.inherited ? "S" : "M", who: c.inherited ? "Ärvd" : undefined })}
        headerAction={
          <Button variant="outline" size="sm" onClick={onAddContact} data-testid="button-add-contact">
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        }
        renderItem={renderContact}
      />

      <DomainCarouselCard<ObjectContactLite>
        className={GRID_CARD}
        icon={Users}
        title="Andra kontakter"
        items={otherContacts}
        getKey={(c) => c.id}
        hideWhenEmpty={false}
        emptyText="Inga övriga kontakter."
        testidPrefix="other-contacts"
        getFooter={(c) => ({ kalla: c.inherited ? "S" : "M", who: c.inherited ? "Ärvd" : undefined })}
        headerAction={
          <Button variant="outline" size="sm" onClick={onAddContact} data-testid="button-add-other-contact">
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        }
        renderItem={renderContact}
      />

      <DomainCarouselCard<any>
        className={GRID_CARD}
        icon={FileText}
        title="Dokument & avtal"
        items={docItems}
        getKey={(m) => String(m?.id ?? m?.metadataKatalogId ?? m?.namn)}
        hideWhenEmpty
        emptyText="Inga dokument eller avtal."
        testidPrefix="documents"
        getFooter={() => ({ kalla: "M" })}
        renderItem={renderDoc}
      />

      <DomainCarouselCard<SystemCommunication>
        className={GRID_CARD}
        icon={MessageSquare}
        title="Kommunikation"
        items={communications}
        getKey={(c) => c.id}
        loading={isLoading}
        emptyText="Ingen kundkommunikation loggad."
        testidPrefix="communications"
        getFooter={(c) => ({ time: c.sentAt, who: c.recipientName, kalla: "SYS" })}
        renderItem={renderCommunication}
      />

      {/* ---------- PRODUKTIONSUPPGIFTER ---------- */}
      <DomainCarouselCard<SystemTaskHistory>
        sectionId="object-section-production"
        className={GRID_CARD}
        icon={ClipboardList}
        title="Produktionsuppgifter"
        description="Utförda och historiska uppgifter på detta objekt."
        items={history}
        getKey={(o) => o.id}
        loading={isLoading}
        emptyText="Inga utförda uppgifter ännu."
        testidPrefix="production"
        getFooter={(o) => ({ time: o.scheduledDate, kalla: "SYS" })}
        renderItem={renderProduction}
      />

      <DomainCarouselCard<SystemInspection>
        className={GRID_CARD}
        icon={ClipboardCheck}
        title="Inspektionsresultat"
        items={inspections}
        getKey={(i) => i.id}
        loading={isLoading}
        emptyText="Inga inspektioner registrerade."
        testidPrefix="inspections"
        getFooter={(i) => ({ time: i.inspectedAt, who: i.inspectedBy, kalla: "SYS" })}
        renderItem={renderInspection}
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
        headerAction={
          <Button variant="outline" size="sm" onClick={onAddImage} data-testid="button-add-image">
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        }
        renderItem={renderImage}
      />

      <DomainCarouselCard<SystemIssueReport>
        className={GRID_CARD}
        icon={AlertTriangle}
        title="Driftstörningar"
        description="Inkomna felanmälningar och driftstörningar."
        items={issueReports}
        getKey={(it) => it.id}
        loading={isLoading}
        emptyText="Inga felanmälningar."
        testidPrefix="issue-reports"
        getFooter={(it) => ({ time: it.createdAt, kalla: "SYS" })}
        renderItem={renderIssueReport}
      />

      {/* ---------- GEOGRAFISK INFORMATION ---------- */}
      <Card id="object-section-location" className={`scroll-mt-24 ${GRID_CARD}`} data-testid="card-location">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Geografisk information
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

      {/* ---------- KOPPLADE UPPGIFTER ---------- */}
      <DomainCarouselCard<LinkedTaskItem>
        sectionId="object-section-linked-tasks"
        className={GRID_CARD}
        icon={ClipboardList}
        title="Kopplade uppgifter"
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
        renderItem={renderLinkedTask}
      />

      {/* ---------- KOPPLADE ORDERKONCEPT ---------- */}
      <DomainCarouselCard<PointedInConcept>
        sectionId="object-section-linked-concepts"
        className={GRID_CARD}
        icon={Target}
        title="Kopplade orderkoncept"
        description="Orderkoncept som pekar in på detta objekt."
        items={concepts}
        getKey={(c) => c.id}
        loading={isLoading}
        emptyText="Inga orderkoncept pekar in."
        testidPrefix="linked-concepts"
        getFooter={(c) => ({ kalla: "SYS" })}
        renderItem={renderConcept}
      />

      {/* ---------- HISTORIK & LOGG ---------- */}
      <Card id="object-section-timeline" className={`scroll-mt-24 ${GRID_CARD}`} data-testid="card-timeline">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Historik &amp; logg
            <KallaBadge kalla="SYS" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Laddar…
            </div>
          ) : latestHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-timeline">
              Inga händelser ännu.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {latestHistory.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => onSelectTimelineTask(o.id)}
                    className="w-full text-left rounded-md border border-border px-2.5 py-1.5 hover:bg-accent transition-colors"
                    data-testid={`timeline-event-${o.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate">{o.title || "Uppgift"}</span>
                      {fmtDate(o.scheduledDate) && (
                        <span className="text-xs text-muted-foreground shrink-0">{fmtDate(o.scheduledDate)}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setHistoryOpen(true)}
            data-testid="button-show-full-history"
          >
            <History className="h-3.5 w-3.5 mr-1" /> Visa fullständig historik
          </Button>
        </CardContent>
      </Card>

      {/* ---------- BETYG (extra, döljs när tomt) ---------- */}
      <DomainCarouselCard<SystemRating>
        className={GRID_CARD}
        icon={Star}
        title="Betyg"
        items={ratings}
        getKey={(r) => r.id}
        loading={isLoading}
        emptyText="Inga betyg ännu."
        testidPrefix="ratings"
        getFooter={(r) => ({ time: r.createdAt, who: r.resourceName, kalla: "SYS" })}
        renderItem={renderRating}
      />

      {/* ---------- Karta-dialog (mount-on-open) ---------- */}
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

      {/* ---------- Fullständig tidslinje-dialog ---------- */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Historik &amp; logg</DialogTitle>
            <DialogDescription>
              Zoombar tidslinje över objektets och underträdets arbetsordrar.
            </DialogDescription>
          </DialogHeader>
          {historyOpen && (
            <div className="max-h-[70vh] overflow-y-auto">
              <ObjectTimeline
                fetchTimeline={fetchTimeline}
                queryKeyPrefix={["/api/objects", objectId, "timeline"]}
                onSelectTask={(taskId) => { setHistoryOpen(false); onSelectTimelineTask(taskId); }}
                initialViewMode="month"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
