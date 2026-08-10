import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Contact, Image as ImageIcon, ClipboardList, MapPin, Target,
  Phone, Mail,
  Link as LinkIcon, Map as MapIcon, Pencil, Copy,
  MoreVertical, Trash2, Archive, EyeOff,
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
import { deriveMetadataOriginBadge, METADATA_ORIGIN_BADGE_LABELS } from "@shared/metadata-origin";
import { getWorkOrderStatusBadge } from "@/lib/status-colors";
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
import { ObjectContactEditDialog, type EditableContact } from "./ObjectContactEditDialog";
import {
  ObjectContactLifecycleDialog,
  type ContactLifecycleAction,
} from "./ObjectContactLifecycleDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface ObjectContactLite extends EditableContact {
  id: string;
  name: string;
  contactType?: string;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
  inherited?: boolean;
  createdAt?: string | Date | null;
  inheritedFromObjectName?: string | null;
}
interface ObjectImageLite {
  id: string;
  url?: string | null;
  imageUrl?: string | null;
  title?: string | null;
  description?: string | null;
  createdAt?: string | Date | null;
  imageDate?: string | Date | null;
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
// Speglar SystemGeoField (server/metadata-queries.ts) — de äkta, systemlåsta
// geografi-metadatafälten (P1 standardadress + P2 fördjupad position).
// Delad cache-nyckel med ObjectHeaderPanel/ObjectSystemGeneratedPanel.
interface GeoFieldLite {
  value: string | null;
  point: { lat: number; lng: number } | null;
  source: "own" | "inherited" | "missing";
  fromObject: { id: string; namn: string } | null;
  metod?: string | null;
}
interface SystemPositionLite {
  what3words?: string | null;
}
interface SystemGeneratedMetadata {
  pointedInConcepts: PointedInConcept[];
  images: ObjectImageLite[];
  tasksHistory: SystemTaskHistory[];
  tasksFuture: SystemTaskFuture[];
  unperformedTasks: SystemUnperformedTask[];
  standardAddress?: {
    gatuadress: GeoFieldLite;
    postnummer: GeoFieldLite;
    postort: GeoFieldLite;
    koordinater: GeoFieldLite;
  };
  advancedPosition?: {
    fordjupadPosition: GeoFieldLite;
    avdelningPortVaning: GeoFieldLite;
  };
  /** Expand-contract: systemhärledd position (what3words m.m.). */
  position?: SystemPositionLite;
}

// Task #1438: ursprungs-badge per geo-rad enligt den delade mappningen
// (import→Importerad, auto/geokodad→Systemgenererad, ärvd→Ärvd, annars Egen).
const geoOriginBadge = (field: GeoFieldLite) => {
  if (field.source === "missing") return null;
  const badge = deriveMetadataOriginBadge(field.metod ?? null, field.source === "inherited");
  const label = METADATA_ORIGIN_BADGE_LABELS[badge];
  const title =
    badge === "arvd" && field.fromObject
      ? `Ärvd från ${field.fromObject.namn}`
      : badge === "systemgenererad"
        ? "Automatiskt härledd av systemet (t.ex. geokodad från adressen)"
        : badge === "importerad"
          ? "Värdet skrevs av en import"
          : "Satt direkt på objektet";
  return (
    <Badge
      variant={badge === "egen" ? "secondary" : "outline"}
      className="text-[10px] px-1 py-0 font-normal shrink-0"
      title={title}
    >
      {label}
    </Badge>
  );
};

const geoFieldRow = (label: string, field: GeoFieldLite | undefined) => {
  if (!field || (field.value == null && field.source === "missing")) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs" data-testid={`text-geo-${label.toLowerCase()}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 min-w-0">
        <span className="truncate text-right">{field.value ?? "—"}</span>
        {geoOriginBadge(field)}
      </span>
    </div>
  );
};

const fmtDate = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE");
};

const fmtTime = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
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
  /** "collections" = METADATA-samlingar (Produktion/Geografi);
   *  "kontakt" = ENBART kontaktkortet (renderas under metadataområdet
   *  Kontaktinformation i ObjectMetadataBody — produktägarbeslut 2026-08-10);
   *  "linked" = KOPPLADE list-block (Orderkoncept/Bilder) — snabbordrar och
   *  uppgifter visas i de subträds-medvetna sektionerna (Task #1474). */
  section: "collections" | "kontakt" | "linked";
  objectId: string;
  obj: any;
  contacts: ObjectContactLite[];
  /** Task #1440: redigeringsknappen i kontaktkortet visas bara för roller med
   *  redigeringsrätt (servern kräver dessutom planner/admin för mutationerna). */
  canEditContacts?: boolean;
  /** Task #1468: permanent radering och anonymisering är admin-åtgärder
   *  (servern kräver requireAdmin — UI-gating är bara bekvämlighet). */
  isAdmin?: boolean;
  onEditGeo: () => void;
  navigate: (path: string) => void;
}

export function ObjectDomainGrid({
  section,
  objectId,
  obj,
  contacts,
  canEditContacts = false,
  isAdmin = false,
  onEditGeo,
  navigate,
}: ObjectDomainGridProps) {
  const mapConfig = useMapConfig();
  const { toast } = useToast();
  const [mapOpen, setMapOpen] = useState(false);
  // Task #1440: kontakt som redigeras i kortets metadata-dialog.
  const [editingContact, setEditingContact] = useState<ObjectContactLite | null>(null);
  // Task #1468: kontakt + livscykelåtgärd (radera/arkivera/anonymisera) med
  // separata bekräftelsedialoger.
  const [lifecycleTarget, setLifecycleTarget] = useState<{
    contact: ObjectContactLite;
    action: ContactLifecycleAction;
  } | null>(null);

  const { data, isLoading } = useQuery<SystemGeneratedMetadata>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId,
  });

  const concepts = data?.pointedInConcepts ?? [];
  // Etapp 5: bilder läses ur metadata-systemet (datatyp='image') via
  // system-generated-metadata — object_images-tabellen är borttagen.
  const images = data?.images ?? [];
  const history = data?.tasksHistory ?? [];

  // Slå ihop primär + övriga kontakter till EN samling; primär överst.
  const sortedContacts = [...contacts].sort(
    (a, b) => (b.contactType === "primary" ? 1 : 0) - (a.contactType === "primary" ? 1 : 0),
  );

  const standardAddress = data?.standardAddress;
  const advancedPosition = data?.advancedPosition;
  const hasCoordinates = obj?.latitude != null && obj?.longitude != null;
  const hasEntrance = obj?.entranceLatitude != null && obj?.entranceLongitude != null;

  // Task #1440: kontaktkortet är HUVUDVISNINGEN för kontaktpersoner — med
  // redigering (metadata-vägen) och kopiering direkt i kortet. Delvis ifyllda
  // kontakter renderas med "—" för saknat namn.
  const copyContact = async (c: ObjectContactLite) => {
    const lines = [
      c.name ? `Namn: ${c.name}` : null,
      c.role ? `Titel: ${c.role}` : null,
      c.phone ? `Telefon: ${c.phone}` : null,
      c.email ? `E-post: ${c.email}` : null,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: "Kontakt kopierad" });
    } catch {
      toast({ title: "Kunde inte kopiera", variant: "destructive" });
    }
  };

  // Task #1468: arkivering/anonymisering går via fält-nivå-endpoints som
  // träffar HELA fältet på objektet — bara säkert med exakt en kontakt (samma
  // konvention som tömning i redigeringsdialogen).
  const fieldLevelActionsSafe = contacts.length === 1;

  const renderContact = (c: ObjectContactLite) => (
    <div className="p-3 border rounded-lg" data-testid={`contact-card-${c.id}`}>
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="font-medium text-sm truncate">{c.name || "—"}</span>
        <div className="flex items-center gap-1 shrink-0">
          {c.inherited && <Badge variant="outline" className="text-[10px]">Ärvd</Badge>}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => copyContact(c)}
            aria-label="Kopiera kontakt"
            data-testid={`button-copy-contact-${c.id}`}
          >
            <Copy className="h-3 w-3" />
          </Button>
          {canEditContacts && !c.inherited && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setEditingContact(c)}
              aria-label="Redigera kontakt"
              data-testid={`button-edit-contact-${c.id}`}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {canEditContacts && !c.inherited && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  aria-label="Fler åtgärder"
                  data-testid={`button-contact-actions-${c.id}`}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Kontaktåtgärder</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={!fieldLevelActionsSafe}
                  onClick={() => setLifecycleTarget({ contact: c, action: "archive" })}
                  data-testid={`menu-archive-contact-${c.id}`}
                >
                  <Archive className="h-3.5 w-3.5 mr-2" />
                  <div className="flex flex-col">
                    <span>Arkivera</span>
                    <span className="text-xs text-muted-foreground">
                      {fieldLevelActionsSafe
                        ? "Inaktiv men bevarad — kan återställas"
                        : "Kräver att objektet har exakt en kontakt"}
                    </span>
                  </div>
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!fieldLevelActionsSafe}
                      onClick={() => setLifecycleTarget({ contact: c, action: "anonymize" })}
                      data-testid={`menu-anonymize-contact-${c.id}`}
                    >
                      <EyeOff className="h-3.5 w-3.5 mr-2" />
                      <div className="flex flex-col">
                        <span>Anonymisera (GDPR)</span>
                        <span className="text-xs text-muted-foreground">
                          {fieldLevelActionsSafe
                            ? "Skrubbar personuppgifter, bevarar historik"
                            : "Kräver att objektet har exakt en kontakt"}
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setLifecycleTarget({ contact: c, action: "delete" })}
                      data-testid={`menu-delete-contact-${c.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      <div className="flex flex-col">
                        <span>Radera permanent</span>
                        <span className="text-xs text-muted-foreground">
                          Spärras vid historik/kopplingar
                        </span>
                      </div>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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

  // Task #1474: renderWorkOrder/renderLinkedTask borttagna — snabbordrar och
  // uppgifter visas nu i den subträds-medvetna ordertabellen resp. uppgiftsnavet.

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

        {/* Task #1474 konsolidering: "Snabbordrar"- och "Uppgifter"-korten är
            borttagna — samma information visas nu (med subträds-växel) i
            ordertabellen resp. uppgiftsnavet. Kvar här: orderkoncept-
            inpekningarna (SYS) och bilderna. */}
        <DomainCarouselCard<ObjectImageLite>
          className={GRID_CARD}
          icon={ImageIcon}
          title="Bilder"
          items={images}
          getKey={(img) => img.id}
          hideWhenEmpty={false}
          emptyText="Inga bilder uppladdade."
          testidPrefix="images"
          getFooter={(img) => ({
            kalla: "M",
            rows: [
              { label: "Datum", value: fmtDate(img.createdAt ?? img.imageDate) },
              { label: "Tid", value: fmtTime(img.createdAt ?? img.imageDate) },
              { label: "Ursprung", value: "Bild-metadata på objektet" },
            ],
          })}
          getSearchText={(img) => `${img.description ?? ""} ${img.title ?? ""}`}
          renderItem={renderImage}
        />
      </div>
    );
  }

  // Kontakt-redigerings-/livscykeldialoger — hör till kontaktkortet.
  const kontaktDialogs = (
    <>
      {editingContact && (
        <ObjectContactEditDialog
          objectId={objectId}
          contact={editingContact}
          structuralEditsSafe={contacts.length === 1}
          open={!!editingContact}
          onOpenChange={(o) => { if (!o) setEditingContact(null); }}
        />
      )}
      {lifecycleTarget && (
        <ObjectContactLifecycleDialog
          objectId={objectId}
          contact={lifecycleTarget.contact}
          action={lifecycleTarget.action}
          archiveSafe={fieldLevelActionsSafe}
          open={!!lifecycleTarget}
          onOpenChange={(o) => { if (!o) setLifecycleTarget(null); }}
        />
      )}
    </>
  );

  // ==================== KONTAKT (under metadataområdet Kontaktinformation) ====================
  if (section === "kontakt") {
    return (
      <>
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
          getFooter={(c) => ({
            kalla: c.inherited ? "S" : "M",
            rows: [
              { label: "Datum", value: fmtDate(c.createdAt) },
              { label: "Tid", value: fmtTime(c.createdAt) },
              {
                label: "Ursprung",
                value: c.inherited
                  ? `Ärvd${c.inheritedFromObjectName ? ` från ${c.inheritedFromObjectName}` : ""}`
                  : "Manuellt tillagd på objektet",
              },
            ],
          })}
          renderItem={renderContact}
        />

        {kontaktDialogs}
      </>
    );
  }

  // ==================== METADATA-SAMLINGAR (karuseller) ====================
  return (
    <>
      <div
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        data-testid="object-domain-grid-collections"
      >
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

        {/* Geografi (äkta metadatafält: standardadress P1 + fördjupad position P2) */}
        <Card className={`${GRID_CARD}`} data-testid="card-location">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Geografi
                <KallaBadge kalla="SYS" />
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              {geoFieldRow("Gatuadress", standardAddress?.gatuadress)}
              {geoFieldRow("Postnummer", standardAddress?.postnummer)}
              {geoFieldRow("Postort", standardAddress?.postort)}
              {standardAddress?.koordinater?.point && (
                <div className="flex items-center justify-between gap-2 text-xs" data-testid="text-location-coords">
                  <span className="text-muted-foreground">Koordinater</span>
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="tabular-nums">
                      {standardAddress.koordinater.point.lat.toFixed(5)}, {standardAddress.koordinater.point.lng.toFixed(5)}
                    </span>
                    {geoOriginBadge(standardAddress.koordinater)}
                  </span>
                </div>
              )}
              {data?.position?.what3words && (
                <div className="flex items-center justify-between gap-2 text-xs" data-testid="text-geo-what3words">
                  <span className="text-muted-foreground">what3words</span>
                  <span className="truncate text-right">{data.position.what3words}</span>
                </div>
              )}
            </div>
            {(advancedPosition?.fordjupadPosition?.point || advancedPosition?.avdelningPortVaning?.value) && (
              <div className="pt-2 border-t space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Fördjupad position (ej ruttbar)
                </div>
                {geoFieldRow("Avdelning/Port/Våning", advancedPosition?.avdelningPortVaning)}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-1 w-full"
              onClick={() => setMapOpen(true)}
              disabled={!hasCoordinates}
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
