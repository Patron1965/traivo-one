import { useQuery } from "@tanstack/react-query";
import {
  Users,
  ClipboardList,
  CalendarClock,
  Target,
  ClipboardCheck,
  MessageSquare,
  Image as ImageIcon,
  FileText,
  AlertTriangle,
  MapPin,
  Star,
  History,
  CircleSlash,
} from "lucide-react";
import { Object360Card, type Object360Entry } from "./Object360Card";

// Task #1128: 360°-översikt för objektdetaljsidan.
// Ett tätt rutnät av kompakta kategorikort (senaste post + karusell + källa +
// "Visa alla"). Additivt — "Visa alla" scrollar/djuplänkar till de befintliga
// djupsektionerna (som behålls som drilldown-mål).
//
// Källhänvisning byggs ENDAST från riktiga kolumner (aldrig fabricerade
// version/ändrad-av) — se memory objekt-360-metadata-view.md.

// ---- Props-former (strukturellt kompatibla med sidans egna interfaces) ----

interface OverviewContact {
  id: string;
  name: string;
  contactType?: string | null;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  inherited?: boolean;
}

interface OverviewWorkOrder {
  id: string;
  title?: string | null;
  status?: string | null;
  orderStatus?: string | null;
  scheduledDate?: string | Date | null;
  resourceName?: string | null;
  lineCount?: number;
}

interface OverviewIssue {
  id: string;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  status?: string | null;
  reporterName?: string | null;
  createdAt?: string | null;
}

interface OverviewAssignment {
  id: string;
  title?: string | null;
  status?: string | null;
  scheduledDate?: string | null;
  orderConceptName?: string | null;
  customerName?: string | null;
}

// ---- System-metadata-svarets form (endast fält vi läser) ----

interface SystemImage {
  id: string;
  imageUrl: string;
  description?: string | null;
  imageType?: string | null;
  imageDate?: string | null;
}

interface SystemGeneratedMetadata {
  address: { gatuadress: string | null; postnummer: string | null; ort: string | null };
  position: {
    latitude: number | null;
    longitude: number | null;
    geocoded: boolean;
    what3words: string | null;
  };
  pointedInConcepts: Array<{
    id: string;
    name: string | null;
    customerName?: string | null;
    invoiceModel?: string | null;
    status?: string | null;
  }>;
  unperformedTasks: Array<{
    id: string;
    title: string | null;
    reasonCode: string | null;
    reason: string | null;
    reasonText: string | null;
    impossibleAt: string | null;
    executionCode: string | null;
  }>;
  images: SystemImage[];
  ratings: Array<{
    id: string;
    resourceName: string | null;
    rating: number;
    comment: string | null;
    createdAt: string | null;
  }>;
  inspections: Array<{
    id: string;
    inspectionType: string | null;
    status: string | null;
    comment: string | null;
    inspectedBy: string | null;
    inspectedAt: string | null;
  }>;
  communications: Array<{
    id: string;
    channel: string | null;
    notificationType: string | null;
    recipientName: string | null;
    subject: string | null;
    aiGenerated: boolean;
    status: string | null;
    sentAt: string | null;
  }>;
}

interface HistoryEntry {
  id?: string;
  metadataNamn?: string | null;
  andradAv?: string | null;
  andradVid?: string | null;
  andringsMetod?: string | null;
  gammaltVarde?: string | null;
  nyttVarde?: string | null;
}

export interface ObjectOverview360Props {
  objectId: string;
  contacts: OverviewContact[];
  workOrders: OverviewWorkOrder[];
  issueReports: OverviewIssue[];
  assignments: OverviewAssignment[];
  onShowAll: (sectionKey: string) => void;
  onNavigate: (path: string) => void;
}

// ---- Hjälpare ----

const DOCUMENT_IMAGE_TYPES = new Set([
  "document",
  "dokument",
  "instruction",
  "instruktion",
  "manual",
  "drawing",
  "ritning",
]);

const IMAGE_TYPE_LABELS: Record<string, string> = {
  photo: "Foto",
  map: "Karta",
  diagram: "Diagram",
  document: "Dokument",
  instruction: "Instruktion",
  manual: "Manual",
  drawing: "Ritning",
};

const CONTACT_TYPE_LABELS: Record<string, string> = {
  primary: "Primär",
  billing: "Fakturering",
  technical: "Teknisk",
  emergency: "Nödkontakt",
  site: "Plats",
};

const COMM_CHANNEL_LABELS: Record<string, string> = {
  email: "E-post",
  sms: "SMS",
  push: "Push",
  phone: "Telefon",
};

const fmtDate = (v?: string | Date | null): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE");
};

const fmtDateTime = (v?: string | null): string | null => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const imageTypeLabel = (t?: string | null): string | null =>
  t ? (IMAGE_TYPE_LABELS[t] ?? t) : null;

const CAROUSEL_CAP = 6;

export function ObjectOverview360({
  objectId,
  contacts,
  workOrders,
  issueReports,
  assignments,
  onShowAll,
  onNavigate,
}: ObjectOverview360Props) {
  const { data: system } = useQuery<SystemGeneratedMetadata>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId,
  });

  const { data: historik = [] } = useQuery<HistoryEntry[]>({
    queryKey: ["/api/metadata/objects", objectId, "historik"],
    enabled: !!objectId,
  });

  const images = system?.images ?? [];
  const photos = images.filter((i) => !DOCUMENT_IMAGE_TYPES.has((i.imageType ?? "").toLowerCase()));
  const documents = images.filter((i) => DOCUMENT_IMAGE_TYPES.has((i.imageType ?? "").toLowerCase()));

  // ---- Bygg entries per kategori ----

  const contactEntries: Object360Entry[] = contacts.slice(0, CAROUSEL_CAP).map((c) => ({
    id: c.id,
    primary: c.name,
    secondary: c.phone || c.email || c.role || null,
    attribution: c.inherited
      ? "Ärvd"
      : c.contactType
        ? (CONTACT_TYPE_LABELS[c.contactType] ?? c.contactType)
        : null,
  }));

  const workOrderEntries: Object360Entry[] = workOrders.slice(0, CAROUSEL_CAP).map((w) => ({
    id: w.id,
    primary: w.title || "Produktionsuppgift",
    secondary: typeof w.lineCount === "number" ? `${w.lineCount} orderrader` : null,
    date: fmtDate(w.scheduledDate),
    status: w.orderStatus || w.status || null,
    attribution: w.resourceName ? `Utförd av ${w.resourceName}` : null,
    onOpen: () => onNavigate(`/work-orders/${w.id}`),
  }));

  const assignmentEntries: Object360Entry[] = assignments.slice(0, CAROUSEL_CAP).map((a) => ({
    id: a.id,
    primary: a.title || "Uppgift",
    secondary: a.customerName || null,
    date: fmtDate(a.scheduledDate),
    status: a.status || null,
    attribution: a.orderConceptName ? `Via ${a.orderConceptName}` : null,
  }));

  const conceptEntries: Object360Entry[] = (system?.pointedInConcepts ?? [])
    .slice(0, CAROUSEL_CAP)
    .map((c) => ({
      id: c.id,
      primary: c.name || "Orderkoncept",
      secondary: c.customerName || null,
      status: c.status || null,
      attribution: c.invoiceModel ? `Modell: ${c.invoiceModel}` : "Inpekat via koncept",
    }));

  const inspectionEntries: Object360Entry[] = (system?.inspections ?? [])
    .slice(0, CAROUSEL_CAP)
    .map((i) => ({
      id: i.id,
      primary: i.inspectionType || "Inspektion",
      secondary: i.comment || null,
      date: fmtDate(i.inspectedAt),
      status: i.status || null,
      attribution: i.inspectedBy ? `Inspekterad av ${i.inspectedBy}` : null,
    }));

  const communicationEntries: Object360Entry[] = (system?.communications ?? [])
    .slice(0, CAROUSEL_CAP)
    .map((c) => ({
      id: c.id,
      primary: c.subject || c.notificationType || "Meddelande",
      secondary: c.recipientName ? `Till ${c.recipientName}` : null,
      date: fmtDate(c.sentAt),
      status: c.status || null,
      attribution: c.aiGenerated
        ? "System (AI)"
        : c.channel
          ? (COMM_CHANNEL_LABELS[c.channel] ?? c.channel)
          : null,
    }));

  const photoEntries: Object360Entry[] = photos.slice(0, CAROUSEL_CAP).map((p) => ({
    id: p.id,
    primary: p.description || imageTypeLabel(p.imageType) || "Bild",
    secondary: imageTypeLabel(p.imageType),
    date: fmtDate(p.imageDate),
    onOpen: () => window.open(p.imageUrl, "_blank", "noopener"),
  }));

  const documentEntries: Object360Entry[] = documents.slice(0, CAROUSEL_CAP).map((d) => ({
    id: d.id,
    primary: d.description || imageTypeLabel(d.imageType) || "Dokument",
    secondary: imageTypeLabel(d.imageType),
    date: fmtDate(d.imageDate),
    onOpen: () => window.open(d.imageUrl, "_blank", "noopener"),
  }));

  const issueEntries: Object360Entry[] = issueReports.slice(0, CAROUSEL_CAP).map((it) => ({
    id: it.id,
    primary: it.title || it.description || "Felanmälan",
    secondary: it.category || null,
    date: fmtDate(it.createdAt),
    status: it.status || null,
    attribution: it.reporterName ? `Anmäld av ${it.reporterName}` : null,
    onOpen: () => onNavigate(`/cases?case=public:${it.id}`),
  }));

  // Task #1155 (Feature G): Ej-utförda uppgifter ("kunde ej utföras")
  const unperformedEntries: Object360Entry[] = (system?.unperformedTasks ?? [])
    .slice(0, CAROUSEL_CAP)
    .map((u) => ({
      id: u.id,
      primary: u.title || "Uppgift",
      secondary: u.reasonText || null,
      date: fmtDate(u.impossibleAt),
      status: u.reason || null,
      onOpen: () => onNavigate(`/work-orders/${u.id}`),
    }));

  const ratingEntries: Object360Entry[] = (system?.ratings ?? []).slice(0, CAROUSEL_CAP).map((r) => ({
    id: r.id,
    primary: `${r.rating}/5 ★`,
    secondary: r.comment || null,
    date: fmtDate(r.createdAt),
    attribution: r.resourceName || null,
  }));

  const historyEntries: Object360Entry[] = historik.slice(0, CAROUSEL_CAP).map((h, idx) => ({
    id: h.id || `hist-${idx}`,
    primary: h.metadataNamn || "Ändring",
    secondary:
      h.gammaltVarde || h.nyttVarde
        ? `${h.gammaltVarde || "(tomt)"} → ${h.nyttVarde || "(tomt)"}`
        : null,
    date: fmtDateTime(h.andradVid),
    attribution: [h.andradAv || null, h.andringsMetod || null].filter(Boolean).join(" · ") || null,
  }));

  // geografisk information = ett sammansatt "senaste"-kort (single entry)
  const addr = system?.address;
  const pos = system?.position;
  const hasGeo = !!(addr?.gatuadress || addr?.ort || (pos?.latitude && pos?.longitude));
  const geoEntries: Object360Entry[] = hasGeo
    ? [
        {
          id: "geo",
          primary: addr?.gatuadress || "Adress saknas",
          secondary: [addr?.postnummer, addr?.ort].filter(Boolean).join(" ") || null,
          attribution: pos?.geocoded
            ? "Geokodad position"
            : pos?.what3words
              ? `///${pos.what3words}`
              : null,
        },
      ]
    : [];

  type CardDef = {
    key: string;
    title: string;
    icon: typeof Users;
    entries: Object360Entry[];
    total: number;
    onShowAll?: () => void;
    emptyText: string;
    testId: string;
    accent?: "default" | "warning" | "destructive";
    alwaysShow?: boolean;
  };

  const cards: CardDef[] = [
    {
      key: "contacts",
      title: "Kontakter",
      icon: Users,
      entries: contactEntries,
      total: contacts.length,
      onShowAll: () => onShowAll("contacts"),
      emptyText: "Inga kontakter kopplade.",
      testId: "contacts",
      alwaysShow: true,
    },
    {
      key: "workorders",
      title: "Produktionsuppgifter",
      icon: ClipboardList,
      entries: workOrderEntries,
      total: workOrders.length,
      onShowAll: () => onShowAll("info-packages"),
      emptyText: "Inga produktionsuppgifter ännu.",
      testId: "workorders",
      alwaysShow: true,
    },
    {
      key: "assignments",
      title: "Kopplade uppgifter",
      icon: CalendarClock,
      entries: assignmentEntries,
      total: assignments.length,
      onShowAll: () => onShowAll("info-packages"),
      emptyText: "Inga planerade uppgifter.",
      testId: "assignments",
    },
    {
      key: "concepts",
      title: "Orderkoncept",
      icon: Target,
      entries: conceptEntries,
      total: system?.pointedInConcepts.length ?? 0,
      onShowAll: () => onNavigate("/order-concepts"),
      showAllLabel: "Öppna koncept",
      emptyText: "Objektet är inte inpekat i något koncept.",
      testId: "concepts",
    } as CardDef & { showAllLabel?: string },
    {
      key: "inspections",
      title: "Inspektionsresultat",
      icon: ClipboardCheck,
      entries: inspectionEntries,
      total: system?.inspections.length ?? 0,
      onShowAll: () => onShowAll("inspections"),
      emptyText: "Inga inspektioner registrerade.",
      testId: "inspections",
    },
    {
      key: "communications",
      title: "Kommunikation",
      icon: MessageSquare,
      entries: communicationEntries,
      total: system?.communications.length ?? 0,
      onShowAll: () => onShowAll("communications"),
      emptyText: "Ingen kundkommunikation loggad.",
      testId: "communications",
    },
    {
      key: "photos",
      title: "Bilder",
      icon: ImageIcon,
      entries: photoEntries,
      total: photos.length,
      onShowAll: () => onShowAll("images"),
      emptyText: "Inga bilder uppladdade.",
      testId: "photos",
    },
    {
      key: "documents",
      title: "Dokument",
      icon: FileText,
      entries: documentEntries,
      total: documents.length,
      onShowAll: () => onShowAll("images"),
      emptyText: "Inga dokument uppladdade.",
      testId: "documents",
    },
    {
      key: "issues",
      title: "Driftstörningar & felanmälningar",
      icon: AlertTriangle,
      entries: issueEntries,
      total: issueReports.length,
      onShowAll: () => onNavigate("/cases"),
      showAllLabel: "Öppna ärenden",
      emptyText: "Inga felanmälningar.",
      testId: "issues",
      accent: "warning",
      alwaysShow: true,
    } as CardDef & { showAllLabel?: string },
    {
      key: "unperformed",
      title: "Ej-utförda uppgifter",
      icon: CircleSlash,
      entries: unperformedEntries,
      total: system?.unperformedTasks.length ?? 0,
      onShowAll: () => onNavigate("/missade-jobb"),
      showAllLabel: "Öppna rapport",
      emptyText: "Inga ej-utförda uppgifter.",
      testId: "unperformed",
      accent: "destructive",
    } as CardDef & { showAllLabel?: string },
    {
      key: "geo",
      title: "Geografisk information",
      icon: MapPin,
      entries: geoEntries,
      total: geoEntries.length,
      onShowAll: () => onShowAll("location"),
      emptyText: "Ingen adress eller position registrerad.",
      testId: "geo",
      alwaysShow: true,
    },
    {
      key: "ratings",
      title: "Betyg",
      icon: Star,
      entries: ratingEntries,
      total: system?.ratings.length ?? 0,
      onShowAll: () => onShowAll("ratings"),
      emptyText: "Inga betyg ännu.",
      testId: "ratings",
    },
    {
      key: "history",
      title: "Historik & logg",
      icon: History,
      entries: historyEntries,
      total: historik.length,
      onShowAll: () => onShowAll("deep-tools"),
      emptyText: "Ingen ändringshistorik.",
      testId: "history",
    },
  ];

  const visibleCards = cards.filter((c) => c.total > 0 || c.alwaysShow);

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
      data-testid="grid-object-360"
    >
      {visibleCards.map((c) => (
        <Object360Card
          key={c.key}
          title={c.title}
          icon={c.icon}
          entries={c.entries}
          total={c.total}
          onShowAll={c.onShowAll}
          showAllLabel={(c as { showAllLabel?: string }).showAllLabel}
          emptyText={c.emptyText}
          testId={c.testId}
          accent={c.accent}
        />
      ))}
    </div>
  );
}
