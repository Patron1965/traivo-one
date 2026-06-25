import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useUpload } from "@/hooks/use-upload";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatSekFromOre } from "@/lib/format";
import { metadataDisplayName } from "@/lib/metadata-display";
import { computeArticlePricing } from "@shared/article-pricing";
import type {
  Article,
  ArticleTypeDefinition,
  IconDefinition,
  AssociationCondition,
  Supplier,
} from "@shared/schema";
import { getLucideIconByName } from "@/lib/icon-registry";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FortnoxArticleNumberField } from "@/components/articles/FortnoxArticleNumberField";
import {
  Package,
  FileText,
  Warehouse,
  DollarSign,
  CalendarClock,
  Layers,
  LinkIcon,
  ListChecks,
  Database,
  Users,
  Plus,
  Trash2,
  X,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Upload,
  Beaker,
  CheckCircle2,
  Pin,
  Circle,
  Keyboard,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Fallback om registret ännu inte hunnit laddas (eller är tomt). Riktiga
// alternativ hämtas per-tenant från /api/article-types (Task #834).
const DEFAULT_ARTICLE_TYPE_OPTIONS = [
  { value: "tjanst", label: "Tjänst" },
  { value: "felanmalan", label: "Felanmälan" },
  { value: "kontroll", label: "Kontroll" },
  { value: "vara", label: "Vara" },
  { value: "beroende", label: "Beroende" },
];

// Status-livscykel: aktiv → utgående → utgått. Legacy "active"/"inactive" stöds
// fortfarande (visas men nya artiklar använder de svenska värdena).
const ARTICLE_STATUS_OPTIONS = [
  { value: "aktiv", label: "Aktiv" },
  { value: "utgående", label: "Utgående" },
  { value: "utgått", label: "Utgått" },
] as const;

// Debiteringsmodell (sektion 4).
const CHARGE_MODEL_OPTIONS = [
  { value: "per_styck", label: "Per styck" },
  { value: "per_timme", label: "Per timme" },
  { value: "fast", label: "Fast pris" },
  { value: "per_meter", label: "Per meter" },
  { value: "per_kvm", label: "Per kvadratmeter" },
];

interface HookConditions {
  container_type?: string;
  requires_access_code?: boolean;
  min_volume?: number;
  max_volume?: number;
}

interface ArticleFile {
  name: string;
  url: string;
  size?: number | null;
}

interface StockLocationRow {
  location: string;
  balance?: number | null;
  minLevel?: number | null;
  reorderPoint?: number | null;
}

interface InformationRequirement {
  type: string;
  required: boolean;
  metadataField?: string | null;
}

interface ShowMetadataRow {
  metadataField: string;
  clarification: string;
  canUpdate: boolean;
}

interface LeaveMetadataRow {
  metadataField: string;
  instruction: string;
  required: boolean;
}

interface ArticleFormData {
  articleNumber: string;
  name: string;
  description: string;
  internalDescription: string;
  articleType: string;
  hookLevel: string;
  hookConditions: HookConditions;
  objectTypes: string[];
  productionTime: number;
  cost: number;
  listPrice: number;
  unit: string;
  status: string;
  fetchMetadataCode: string;
  leaveMetadataCode: string;
  leaveMetadataFormat: string;
  leaveMetadataRequired: boolean;
  maxPerAddress: number | null;
  associationLabel: string;
  associationValue: string;
  associationOperator: string;
  associationRules: AssociationCondition[];
  fetchMetadataLabel: string;
  fetchMetadataLabelFormat: string;
  canUpdateMetadata: boolean;
  updateMetadataLabel: string;
  updateMetadataFormat: string;
  showPreviousValue: boolean;
  isInfoCarrier: boolean;
  limitationType: string;
  quantityMode: string;
  operatorCanUpdateQuantity: boolean;
  freeMetadataUpdate: boolean;
  hideQuantityInApp: boolean;
  quantityMetadataField: string;
  quantityFormula: string;
  quantityUnit: string;
  groupSize: number;
  offsetMinutes: number;
  leadTimeDays: number | null;
  requiresAcknowledgment: boolean;
  dependencyCriticality: string;
  isStructure: boolean;
  isComponent: boolean;
  isGeoDependent: boolean;
  defaultMetadataAssociation: string;
  stockLocation: string;
  supplierNumbers: string[];
  replacementArticleId: string;
  externInfoUrl: string;
  externInfoDescription: string;
  externInfoFileUrl: string;
  // "Ny artikel"-layoutspec: nya fält
  files: ArticleFile[];
  stockLocations: StockLocationRow[];
  defaultSupplierId: string;
  reorderPoint: number | null;
  safetyStock: number | null;
  minOrderQuantity: number | null;
  purchasePrice: number;
  standardCost: number;
  materialCost: number;
  freightCost: number;
  warehouseCost: number;
  markupPercent: number | null;
  chargeModel: string;
  informationRequirements: InformationRequirement[];
  showMetadataFields: ShowMetadataRow[];
  leaveMetadataFields: LeaveMetadataRow[];
  performerCategory: string;
  competencyRequirements: string[];
  iconKey: string;
}

interface ComponentDraft {
  id?: string;
  childArticleId: string;
  quantityMode: "follows_parent" | "fixed";
  quantity: number;
  isMandatory: boolean;
  notes: string;
}

const emptyFormData: ArticleFormData = {
  articleNumber: "",
  name: "",
  description: "",
  internalDescription: "",
  articleType: "tjanst",
  hookLevel: "",
  hookConditions: {},
  objectTypes: [],
  productionTime: 15,
  cost: 0,
  listPrice: 0,
  unit: "st",
  status: "aktiv",
  fetchMetadataCode: "",
  leaveMetadataCode: "",
  leaveMetadataFormat: "",
  leaveMetadataRequired: false,
  maxPerAddress: null,
  associationLabel: "",
  associationValue: "",
  associationOperator: "equals",
  associationRules: [],
  fetchMetadataLabel: "",
  fetchMetadataLabelFormat: "",
  canUpdateMetadata: false,
  updateMetadataLabel: "",
  updateMetadataFormat: "",
  showPreviousValue: false,
  isInfoCarrier: false,
  limitationType: "unlimited",
  quantityMode: "group",
  operatorCanUpdateQuantity: false,
  freeMetadataUpdate: false,
  hideQuantityInApp: false,
  quantityMetadataField: "",
  quantityFormula: "",
  quantityUnit: "st",
  groupSize: 1,
  offsetMinutes: 0,
  leadTimeDays: null,
  requiresAcknowledgment: false,
  dependencyCriticality: "critical",
  isStructure: false,
  isComponent: false,
  isGeoDependent: true,
  defaultMetadataAssociation: "",
  stockLocation: "",
  supplierNumbers: [],
  replacementArticleId: "",
  externInfoUrl: "",
  externInfoDescription: "",
  externInfoFileUrl: "",
  files: [],
  stockLocations: [],
  defaultSupplierId: "",
  reorderPoint: null,
  safetyStock: null,
  minOrderQuantity: null,
  purchasePrice: 0,
  standardCost: 0,
  materialCost: 0,
  freightCost: 0,
  warehouseCost: 0,
  markupPercent: null,
  chargeModel: "",
  informationRequirements: [],
  showMetadataFields: [],
  leaveMetadataFields: [],
  performerCategory: "",
  competencyRequirements: [],
  iconKey: "",
};

// ── Hybrid-layout: sektionsdefinitioner & completeness ──────────────────────
type SectionStat = { filled: number; total: number };
type SectionStatus = "complete" | "partial" | "empty";

const ARTICLE_SECTIONS: { id: string; title: string; icon: LucideIcon }[] = [
  { id: "grunddata", title: "Grunddata", icon: Package },
  { id: "fordjupad-info", title: "Fördjupad artikelinfo", icon: FileText },
  { id: "lager-inkop", title: "Lager & Inköp", icon: Warehouse },
  { id: "pris-ekonomi", title: "Pris & Ekonomi", icon: DollarSign },
  { id: "planeringslogik", title: "Planeringslogik", icon: CalendarClock },
  { id: "struktur", title: "Strukturartikel", icon: Layers },
  { id: "fasthakning", title: "Fasthakningslogik", icon: LinkIcon },
  { id: "antalslogik", title: "Antalslogik", icon: ListChecks },
  { id: "metadata", title: "Visa och uppdatera metadata", icon: Database },
  { id: "utforarkategori", title: "Utförarkategori", icon: Users },
];

function sectionStatus(stat?: SectionStat): SectionStatus {
  if (!stat || stat.filled === 0) return "empty";
  if (stat.filled >= stat.total) return "complete";
  return "partial";
}

function countFilled(values: boolean[]): SectionStat {
  return { filled: values.filter(Boolean).length, total: values.length };
}

// Räknar nyckelfält per sektion (approximation av ifyllnadsgrad, inte 1:1 med
// varje renderat fält) för badge + status-ikon i navigeringen.
function getSectionStats(
  fd: ArticleFormData,
  componentDraft: ComponentDraft[],
): Record<string, SectionStat> {
  const assocCount = fd.associationRules.filter((c) => c.source === "metadata").length;
  return {
    grunddata: countFilled([
      fd.articleNumber.trim() !== "",
      fd.name.trim() !== "",
      fd.description.trim() !== "",
      fd.internalDescription.trim() !== "",
    ]),
    "fordjupad-info": countFilled([
      fd.files.length > 0,
      fd.externInfoUrl.trim() !== "",
      fd.externInfoDescription.trim() !== "",
      fd.supplierNumbers.length > 0,
    ]),
    "lager-inkop": countFilled([
      fd.stockLocations.length > 0,
      fd.defaultSupplierId.trim() !== "",
      fd.reorderPoint != null,
      fd.safetyStock != null,
      fd.minOrderQuantity != null,
      fd.leadTimeDays != null,
    ]),
    "pris-ekonomi": countFilled([
      fd.listPrice > 0,
      fd.cost > 0,
      fd.purchasePrice > 0,
      fd.standardCost > 0,
      fd.materialCost > 0,
      fd.freightCost > 0,
      fd.warehouseCost > 0,
      fd.markupPercent != null,
      fd.chargeModel.trim() !== "",
      fd.productionTime > 0,
    ]),
    planeringslogik: countFilled([fd.offsetMinutes !== 0, fd.groupSize > 1]),
    struktur: { filled: componentDraft.length > 0 ? 1 : 0, total: 1 },
    fasthakning: { filled: assocCount > 0 ? 1 : 0, total: 1 },
    antalslogik: countFilled([
      fd.quantityMode === "formula"
        ? fd.quantityFormula.trim() !== ""
        : fd.quantityMode === "per_styck" || fd.quantityMode === "matches_field"
          ? fd.quantityMetadataField.trim() !== ""
          : fd.groupSize > 0,
      fd.operatorCanUpdateQuantity,
    ]),
    metadata: countFilled([
      fd.showMetadataFields.length > 0,
      fd.leaveMetadataFields.length > 0,
    ]),
    utforarkategori: countFilled([
      fd.performerCategory.trim() !== "",
      fd.competencyRequirements.length > 0,
    ]),
  };
}

function SectionStatusIcon({
  status,
  className = "",
}: {
  status: SectionStatus;
  className?: string;
}) {
  if (status === "complete")
    return <CheckCircle2 className={`h-4 w-4 text-chart-2 ${className}`} aria-hidden="true" />;
  if (status === "partial")
    return <AlertTriangle className={`h-4 w-4 text-warning ${className}`} aria-hidden="true" />;
  return <Circle className={`h-4 w-4 text-muted-foreground ${className}`} aria-hidden="true" />;
}

function statusBadgeTone(status: SectionStatus): string {
  if (status === "complete") return "bg-chart-2/15 text-chart-2";
  if (status === "partial") return "bg-warning/15 text-warning";
  return "bg-muted text-muted-foreground";
}

function FieldCountBadge({
  stat,
  status,
  testId,
}: {
  stat?: SectionStat;
  status: SectionStatus;
  testId?: string;
}) {
  if (!stat) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeTone(status)}`}
      data-testid={testId}
    >
      {stat.filled}/{stat.total}
    </span>
  );
}

function statusText(status: SectionStatus): string {
  if (status === "complete") return "komplett";
  if (status === "partial") return "delvis ifylld";
  return "tom";
}

function QuickNav({
  sections,
  stats,
  pinnedSections,
  activeSection,
  onSectionClick,
  onExpandAll,
  onCollapseAll,
}: {
  sections: { id: string; title: string; icon: LucideIcon }[];
  stats: Record<string, SectionStat>;
  pinnedSections: string[];
  activeSection: string;
  onSectionClick: (id: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <nav
      aria-label="Artikelsektioner navigation"
      data-testid="nav-article-sections"
      className="sticky top-0 z-30 hidden max-h-[calc(100vh-3.5rem)] shrink-0 basis-[clamp(15rem,16vw,20rem)] self-start overflow-y-auto border-r bg-muted/30 px-3 py-4 lg:block"
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sektioner
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onExpandAll}
            data-testid="button-expand-all"
            title="Expandera alla (E)"
          >
            Alla
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onCollapseAll}
            data-testid="button-collapse-all"
            title="Kollapsa alla (C)"
          >
            Dölj
          </Button>
        </div>
      </div>
      <ul role="list" className="space-y-1">
        {sections.map((s) => {
          const stat = stats[s.id];
          const status = sectionStatus(stat);
          const isActive = activeSection === s.id;
          const isPinned = pinnedSections.includes(s.id);
          const Icon = s.icon;
          const borderTone = isActive
            ? "border-l-primary"
            : status === "complete"
              ? "border-l-chart-2"
              : status === "partial"
                ? "border-l-warning"
                : "border-l-border";
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSectionClick(s.id)}
                aria-current={isActive ? "true" : undefined}
                aria-label={`${s.title}, ${statusText(status)}${stat ? `, ${stat.filled} av ${stat.total} fält` : ""}`}
                data-testid={`nav-section-${s.id}`}
                className={`flex w-full items-center gap-2 rounded-md border-l-[3px] ${borderTone} px-2.5 py-2 text-left text-sm transition-colors hover-elevate ${isActive ? "bg-accent font-semibold text-accent-foreground" : "text-foreground"}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {isPinned && <Pin className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {stat && (
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${statusBadgeTone(status)}`}
                    data-testid={`nav-badge-${s.id}`}
                  >
                    {stat.filled}/{stat.total}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <details className="mt-4 rounded-md border bg-card px-2 py-1.5 text-xs text-muted-foreground">
        <summary
          className="flex cursor-pointer items-center gap-1.5 font-medium"
          data-testid="button-shortcuts-help"
        >
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" /> Kortkommandon
        </summary>
        <dl className="mt-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <dt>Hoppa till 1–9</dt>
            <dd className="font-mono">⌘/Ctrl + 1–9</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>Navigera</dt>
            <dd className="font-mono">↑ ↓</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>Expandera/kollapsa</dt>
            <dd className="font-mono">Space</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>Expandera alla</dt>
            <dd className="font-mono">E</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>Kollapsa alla</dt>
            <dd className="font-mono">C</dd>
          </div>
        </dl>
      </details>
    </nav>
  );
}

function FormSection({
  id,
  title,
  icon,
  description,
  testId,
  alwaysExpanded = false,
  expanded = false,
  onToggle,
  pinned = false,
  onPin,
  stat,
  registerRef,
  children,
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  description?: string;
  testId?: string;
  alwaysExpanded?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  pinned?: boolean;
  onPin?: () => void;
  stat?: SectionStat;
  registerRef?: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}) {
  const isOpen = alwaysExpanded || expanded;
  const status = sectionStatus(stat);
  const headingId = `${id}-heading`;
  const contentId = `${id}-content`;
  return (
    <section
      id={id}
      data-section-id={id}
      ref={registerRef}
      aria-labelledby={headingId}
      className={`scroll-mt-4 ${alwaysExpanded ? "rounded-lg border-2 border-primary/40 bg-muted/20" : ""}`}
    >
      <Card className={alwaysExpanded ? "border-0 bg-transparent shadow-none" : undefined}>
        <Collapsible open={isOpen} onOpenChange={alwaysExpanded ? undefined : onToggle}>
          <div id={headingId} className="flex items-center gap-1 pr-2">
            {alwaysExpanded ? (
              <div className="flex flex-1 items-center gap-2 px-4 py-3">
                {icon}
                <span className="text-sm font-semibold">{title}</span>
                <SectionStatusIcon status={status} />
                <FieldCountBadge stat={stat} status={status} testId={`badge-${id}`} />
              </div>
            ) : (
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  data-testid={testId}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  className="flex flex-1 items-center gap-2 rounded-md px-4 py-3 text-left hover-elevate"
                >
                  {icon}
                  <span className="text-sm font-semibold">{title}</span>
                  {pinned && <Pin className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                  <SectionStatusIcon status={status} />
                  <FieldCountBadge stat={stat} status={status} testId={`badge-${id}`} />
                  <ChevronDown
                    className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
            )}
            {!alwaysExpanded && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onPin?.();
                }}
                aria-pressed={pinned}
                data-testid={`button-pin-${id}`}
                title={pinned ? "Avpinna sektion" : "Pinna sektion"}
              >
                <Pin
                  className={`h-4 w-4 ${pinned ? "fill-current text-primary" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
                <span className="sr-only">{pinned ? "Avpinna sektion" : "Pinna sektion"}</span>
              </Button>
            )}
          </div>
          {alwaysExpanded ? (
            <div id={contentId} className="px-4 pb-4 pt-1">
              {description && <p className="mb-3 text-xs text-muted-foreground">{description}</p>}
              <div className="space-y-4">{children}</div>
            </div>
          ) : (
            <CollapsibleContent id={contentId} className="px-4 pb-4 pt-1">
              {description && <p className="mb-3 text-xs text-muted-foreground">{description}</p>}
              <div className="space-y-4">{children}</div>
            </CollapsibleContent>
          )}
        </Collapsible>
      </Card>
    </section>
  );
}

export default function ArticleFormPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const [, navigate] = useLocation();
  const params = useParams();
  const id = params.id;
  const isEditMode = !!id;

  const [formData, setFormData] = useState<ArticleFormData>(emptyFormData);
  // Task #837: Fortnox-koppling. `fortnoxArticleNumber` skickas bara när
  // `fortnoxLinkTouched` är true så att oförändrad redigering inte raderar kopplingen.
  const [fortnoxArticleNumber, setFortnoxArticleNumber] = useState<string | null>(null);
  const [fortnoxLinkTouched, setFortnoxLinkTouched] = useState(false);
  const [supplierNumberInput, setSupplierNumberInput] = useState("");
  const [competencyInput, setCompetencyInput] = useState("");
  const [debouncedArticleNumber, setDebouncedArticleNumber] = useState("");
  const [offsetValueInput, setOffsetValueInput] = useState<string>("0");
  const [offsetUnit, setOffsetUnit] = useState<"minutes" | "days">("minutes");
  const [offsetType, setOffsetType] = useState<"before" | "same" | "after">("same");
  const [componentDraft, setComponentDraft] = useState<ComponentDraft[]>([]);
  const [originalComponents, setOriginalComponents] = useState<{ id: string; childArticleId: string }[]>([]);
  const [assocTestResult, setAssocTestResult] = useState<{
    matchCount: number;
    matches: Array<{ objectId: string; objectName: string; objectAddress: string; metadataValue: string | null }>;
    labelFound: boolean;
    labelName?: string;
  } | null>(null);
  const [assocTestLoading, setAssocTestLoading] = useState(false);
  // Create-läge initieras direkt; redigeringsläge initieras när artikeln hämtats.
  const [initialized, setInitialized] = useState(!isEditMode);

  // ── Hybrid-layout: sektionsnavigering, expand/pin & persistence ──────────
  const layoutStorageKey = `traivo_article_${id ?? "new"}_layout_prefs`;
  const allSectionIds = useMemo(() => ARTICLE_SECTIONS.map((s) => s.id), []);
  const [expandedSections, setExpandedSections] = useState<string[]>(["grunddata"]);
  const [pinnedSections, setPinnedSections] = useState<string[]>([]);
  const [activeSection, setActiveSection] = useState<string>("grunddata");
  const [srAnnouncement, setSrAnnouncement] = useState("");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollContainerRef = useRef<HTMLFormElement | null>(null);

  const sectionStats = useMemo(
    () => getSectionStats(formData, componentDraft),
    [formData, componentDraft],
  );

  const orderedNavSections = useMemo(() => {
    const grund = ARTICLE_SECTIONS.filter((s) => s.id === "grunddata");
    const pinned = pinnedSections
      .filter((pid) => pid !== "grunddata")
      .map((pid) => ARTICLE_SECTIONS.find((s) => s.id === pid))
      .filter((s): s is (typeof ARTICLE_SECTIONS)[number] => Boolean(s));
    const rest = ARTICLE_SECTIONS.filter(
      (s) => s.id !== "grunddata" && !pinnedSections.includes(s.id),
    );
    return [...grund, ...pinned, ...rest];
  }, [pinnedSections]);

  // Ladda sparade preferenser (per artikel, 7 dagars TTL).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(layoutStorageKey);
      if (!stored) return;
      const prefs = JSON.parse(stored) as {
        expandedSections?: string[];
        pinnedSections?: string[];
        timestamp?: number;
      };
      if (!prefs.timestamp || Date.now() - prefs.timestamp > 7 * 24 * 60 * 60 * 1000) return;
      const pinned = (prefs.pinnedSections ?? [])
        .filter((s) => allSectionIds.includes(s) && s !== "grunddata")
        .slice(0, 3);
      const expanded = (prefs.expandedSections ?? []).filter((s) => allSectionIds.includes(s));
      setPinnedSections(pinned);
      setExpandedSections(Array.from(new Set(["grunddata", ...expanded, ...pinned])));
    } catch (e) {
      console.error("Kunde inte läsa layout-preferenser:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutStorageKey]);

  // Spara preferenser vid ändring.
  useEffect(() => {
    try {
      localStorage.setItem(
        layoutStorageKey,
        JSON.stringify({
          expandedSections: expandedSections.filter((s) => s !== "grunddata"),
          pinnedSections,
          timestamp: Date.now(),
        }),
      );
    } catch {
      /* localStorage kan vara otillgängligt – ignorera */
    }
  }, [expandedSections, pinnedSections, layoutStorageKey]);

  const toggleSection = useCallback((sectionId: string) => {
    if (sectionId === "grunddata") return;
    setExpandedSections((prev) => {
      const isOpen = prev.includes(sectionId);
      setSrAnnouncement(
        `${ARTICLE_SECTIONS.find((s) => s.id === sectionId)?.title ?? "Sektion"} ${isOpen ? "kollapsad" : "expanderad"}`,
      );
      return isOpen ? prev.filter((s) => s !== sectionId) : [...prev, sectionId];
    });
  }, []);

  const togglePin = useCallback(
    (sectionId: string) => {
      if (sectionId === "grunddata") return;
      setPinnedSections((prev) => {
        const isPinned = prev.includes(sectionId);
        if (!isPinned && prev.length >= 3) {
          toast({
            title: "Max 3 sektioner kan pinnas",
            description: "Avpinna en sektion innan du pinnar en ny.",
            variant: "destructive",
          });
          return prev;
        }
        if (!isPinned) {
          setExpandedSections((e) => (e.includes(sectionId) ? e : [...e, sectionId]));
        }
        return isPinned ? prev.filter((s) => s !== sectionId) : [...prev, sectionId];
      });
    },
    [toast],
  );

  const handleSectionClick = useCallback((sectionId: string) => {
    if (sectionId !== "grunddata") {
      setExpandedSections((prev) => (prev.includes(sectionId) ? prev : [...prev, sectionId]));
    }
    setActiveSection(sectionId);
    window.setTimeout(() => {
      sectionRefs.current[sectionId]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, []);

  const expandAllSections = useCallback(() => {
    setExpandedSections(allSectionIds);
    setSrAnnouncement("Alla sektioner expanderade");
  }, [allSectionIds]);

  const collapseAllSections = useCallback(() => {
    setExpandedSections(Array.from(new Set(["grunddata", ...pinnedSections])));
    setSrAnnouncement("Sektioner kollapsade");
  }, [pinnedSections]);

  // IntersectionObserver → uppdatera aktiv sektion vid scroll.
  useEffect(() => {
    const els = allSectionIds
      .map((sid) => sectionRefs.current[sid])
      .filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0;
        let activeId: string | null = null;
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            activeId = entry.target.getAttribute("data-section-id");
          }
        });
        if (activeId && maxRatio > 0.2) setActiveSection(activeId);
      },
      {
        root: scrollContainerRef.current ?? null,
        rootMargin: "0px 0px -55% 0px",
        threshold: [0, 0.2, 0.5, 1],
      },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [allSectionIds, initialized]);

  // Tangentbordsgenvägar för sektionsnavigering.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isFormField =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        Boolean(target?.isContentEditable);
      if (isFormField) return;
      const isCmd = e.metaKey || e.ctrlKey;
      if (isCmd && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = Number.parseInt(e.key, 10) - 1;
        if (allSectionIds[idx]) handleSectionClick(allSectionIds[idx]);
        return;
      }
      if (isCmd) return;
      // Stör inte inbyggd tangentbordsnavigering i sammansatta kontroller
      // (Select, dropdown, combobox, popover, meny, dialog).
      const inComposite = Boolean(
        target?.closest(
          '[role="menu"],[role="menuitem"],[role="listbox"],[role="option"],[role="combobox"],[role="dialog"],[data-radix-popper-content-wrapper]',
        ),
      );
      if (inComposite) return;
      const isButtonish = tag === "BUTTON" || tag === "A";
      if (e.key === " ") {
        if (isButtonish) return;
        e.preventDefault();
        toggleSection(activeSection);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = allSectionIds.indexOf(activeSection);
        const next =
          e.key === "ArrowDown"
            ? Math.min(i + 1, allSectionIds.length - 1)
            : Math.max(i - 1, 0);
        handleSectionClick(allSectionIds[next]);
      } else if (e.key === "e" || e.key === "E") {
        expandAllSections();
      } else if (e.key === "c" || e.key === "C") {
        collapseAllSections();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    activeSection,
    allSectionIds,
    handleSectionClick,
    toggleSection,
    expandAllSections,
    collapseAllSections,
  ]);

  const sectionProps = useCallback(
    (sid: string) => ({
      id: sid,
      expanded: expandedSections.includes(sid),
      onToggle: () => toggleSection(sid),
      pinned: pinnedSections.includes(sid),
      onPin: () => togglePin(sid),
      stat: sectionStats[sid],
      registerRef: (el: HTMLElement | null) => {
        sectionRefs.current[sid] = el;
      },
    }),
    [expandedSections, pinnedSections, sectionStats, toggleSection, togglePin],
  );

  const computeOffsetMinutes = (
    unit: "minutes" | "days",
    type: "before" | "same" | "after",
    magnitudeStr: string,
  ): number => {
    if (type === "same") return 0;
    const mag = Math.abs(parseInt(magnitudeStr, 10) || 0);
    const minutes = unit === "days" ? mag * 1440 : mag;
    return type === "before" ? -minutes : minutes;
  };

  // Lista för komponentval/ersättningsartikel.
  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  // Redigeringsläge: hämta artikeln via GET /api/articles/:id (default-fetchern
  // bygger url:en av queryKey.join("/")).
  const {
    data: editingArticle = null,
    isLoading: articleLoading,
    isError: articleError,
  } = useQuery<Article>({
    queryKey: ["/api/articles", id],
    enabled: isEditMode,
  });

  const { data: metadataTypes = [] } = useQuery<{ id: string; namn: string; visningsnamn?: string | null; datatyp: string; parentMetadataId: string | null }[]>({
    queryKey: ["/api/metadata/types"],
  });

  // Grupp-expansion (Alt B): ett katalogfält med barn (t.ex. "Kontakt") kan väljas
  // som GRUPP — då sparas bara förälderns rad och alla barn inkluderas dynamiskt vid
  // utförande (lägg till ett barn senare → inkluderas automatiskt). Föräldern bär
  // aldrig ett eget värde. Här byggs index barn-per-förälder + listan med enskilda
  // (icke-grupp) fält så att selektorn kan visa både grupper och enskilda fält.
  const metadataChildrenByParentName = useMemo(() => {
    const byId = new Map(metadataTypes.map((t) => [t.id, t]));
    const map = new Map<string, string[]>();
    for (const t of metadataTypes) {
      if (!t.parentMetadataId) continue;
      const parent = byId.get(t.parentMetadataId);
      if (!parent) continue;
      const arr = map.get(parent.namn) ?? [];
      arr.push(t.namn);
      map.set(parent.namn, arr);
    }
    return map;
  }, [metadataTypes]);
  const groupParentNames = useMemo(
    () => new Set(metadataChildrenByParentName.keys()),
    [metadataChildrenByParentName],
  );
  const groupParentTypes = useMemo(
    () => metadataTypes.filter((t) => groupParentNames.has(t.namn)),
    [metadataTypes, groupParentNames],
  );
  const individualMetadataTypes = useMemo(
    () => metadataTypes.filter((t) => !groupParentNames.has(t.namn)),
    [metadataTypes, groupParentNames],
  );

  const { data: articleTypeDefs = [] } = useQuery<ArticleTypeDefinition[]>({
    queryKey: ["/api/article-types"],
  });
  const articleTypeOptions = useMemo(
    () =>
      articleTypeDefs.length > 0
        ? articleTypeDefs.map((d) => ({ value: d.key, label: d.label }))
        : DEFAULT_ARTICLE_TYPE_OPTIONS,
    [articleTypeDefs],
  );

  const { data: iconDefs = [] } = useQuery<IconDefinition[]>({
    queryKey: ["/api/icons"],
  });

  const { data: metadataLabels = [] } = useQuery<{ id: string; namn: string; visningsnamn?: string | null; beteckning: string | null; datatyp: string }[]>({
    queryKey: ["/api/metadata-labels"],
    select: (data: any[]) => data.map((d: any) => ({ id: d.id, namn: d.namn, visningsnamn: d.visningsnamn ?? null, beteckning: d.beteckning, datatyp: d.datatyp })),
  });

  // Standardleverantör (sektion 3) — GET /api/suppliers.
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  // Fördjupad artikelinfo (sektion 2): flera filer.
  const { uploadFile: uploadArticleFile, isUploading: filesUploading } = useUpload({
    onSuccess: (res) => {
      setFormData((prev) => ({
        ...prev,
        files: [...prev.files, { name: res.metadata?.name || "Fil", url: res.objectPath, size: res.metadata?.size ?? null }],
      }));
    },
    onError: (err) => {
      toast({ title: "Uppladdning misslyckades", description: err.message, variant: "destructive" });
    },
  });

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      if (file.size > 20 * 1024 * 1024) {
        toast({
          title: "Filen är för stor",
          description: `${file.name} överskrider gränsen på 20 MB och laddades inte upp.`,
          variant: "destructive",
        });
        continue;
      }
      await uploadArticleFile(file);
    }
  };

  const handleTestAssociation = async () => {
    const needsValue = formData.associationOperator !== "has_value";
    if (!formData.associationLabel || (needsValue && !formData.associationValue)) return;
    setAssocTestLoading(true);
    setAssocTestResult(null);
    try {
      const artId = id || "new";
      const res = await fetch(`/api/articles/${artId}/test-association`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          label: formData.associationLabel,
          value: formData.associationValue,
          operator: formData.associationOperator,
        }),
      });
      if (res.ok) {
        setAssocTestResult(await res.json());
      }
    } catch {
      /* ignore */
    }
    setAssocTestLoading(false);
  };

  // Debounce artikelnummer för dubblettkoll.
  useEffect(() => {
    const trimmed = formData.articleNumber.trim();
    const handle = setTimeout(() => setDebouncedArticleNumber(trimmed), 350);
    return () => clearTimeout(handle);
  }, [formData.articleNumber]);

  const { data: articleNumberCheck } = useQuery<{ available: boolean; reason?: string; existingId?: string; existingName?: string }>({
    queryKey: ["/api/articles/validate-number", debouncedArticleNumber, id ?? ""],
    queryFn: async () => {
      const queryParams = new URLSearchParams({ number: debouncedArticleNumber });
      if (id) queryParams.set("excludeId", id);
      const res = await fetch(`/api/articles/validate-number?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte validera artikelnummer");
      return res.json();
    },
    enabled: debouncedArticleNumber.length > 0,
  });

  const articleNumberDuplicate =
    !!articleNumberCheck &&
    articleNumberCheck.available === false &&
    articleNumberCheck.reason === "duplicate" &&
    debouncedArticleNumber === formData.articleNumber.trim();

  // Redigeringsläge: fyll formuläret via samma mappning som dagens openEditDialog.
  useEffect(() => {
    if (initialized) return;
    if (!editingArticle) return;
    const article = editingArticle;
    setFormData({
      articleNumber: article.articleNumber,
      name: article.name,
      description: article.description || "",
      internalDescription: (article as any).internalDescription || "",
      articleType: article.articleType,
      hookLevel: article.hookLevel || "",
      hookConditions: (article.hookConditions as HookConditions) || {},
      objectTypes: article.objectTypes || [],
      productionTime: article.articleType === "vara" ? 0 : (article.productionTime ?? 15),
      cost: article.cost || 0,
      listPrice: article.listPrice || 0,
      unit: article.unit || "st",
      status: article.status || "active",
      fetchMetadataCode: article.fetchMetadataCode || "",
      leaveMetadataCode: article.leaveMetadataCode || "",
      leaveMetadataFormat: article.leaveMetadataFormat || "",
      leaveMetadataRequired: (article as any).leaveMetadataRequired ?? false,
      maxPerAddress: article.maxPerAddress ?? null,
      associationLabel: article.associationLabel || "",
      associationValue: article.associationValue || "",
      associationOperator: article.associationOperator || "equals",
      associationRules: Array.isArray(article.associationRules) ? (article.associationRules as AssociationCondition[]) : [],
      fetchMetadataLabel: article.fetchMetadataLabel || "",
      fetchMetadataLabelFormat: article.fetchMetadataLabelFormat || "",
      canUpdateMetadata: article.canUpdateMetadata || false,
      updateMetadataLabel: article.updateMetadataLabel || "",
      updateMetadataFormat: article.updateMetadataFormat || "",
      showPreviousValue: article.showPreviousValue || false,
      isInfoCarrier: article.isInfoCarrier || false,
      limitationType: article.limitationType || "unlimited",
      quantityMode:
        article.quantityMode === "use_object_quantity" ||
        article.quantityMode === "configurable" ||
        article.quantityMode === "matches_field" ||
        !article.quantityMode
          ? "per_styck"
          : article.quantityMode,
      operatorCanUpdateQuantity: (article as any).operatorCanUpdateQuantity ?? false,
      freeMetadataUpdate: (article as any).freeMetadataUpdate ?? false,
      hideQuantityInApp: (article as any).hideQuantityInApp ?? false,
      quantityMetadataField: article.quantityMetadataField || "",
      quantityFormula: (article as any).quantityFormula || "",
      quantityUnit: article.quantityUnit || "",
      groupSize: article.groupSize ?? 1,
      offsetMinutes: article.offsetMinutes ?? 0,
      leadTimeDays: (article as any).leadTimeDays ?? null,
      requiresAcknowledgment: (article as any).requiresAcknowledgment ?? false,
      dependencyCriticality: (article as any).dependencyCriticality ?? "critical",
      isStructure: (article as any).isStructure ?? false,
      isComponent: (article as any).isComponent ?? false,
      isGeoDependent: (article as any).isGeoDependent ?? true,
      defaultMetadataAssociation: article.defaultMetadataAssociation || "",
      stockLocation: article.stockLocation || "",
      supplierNumbers: article.supplierNumbers || [],
      replacementArticleId: article.replacementArticleId || "",
      externInfoUrl: article.externInfoUrl || "",
      externInfoDescription: article.externInfoDescription || "",
      externInfoFileUrl: (article as any).externInfoFileUrl || "",
      files: Array.isArray((article as any).files) ? ((article as any).files as ArticleFile[]) : [],
      stockLocations: Array.isArray((article as any).stockLocations) ? ((article as any).stockLocations as StockLocationRow[]) : [],
      defaultSupplierId: (article as any).defaultSupplierId || "",
      reorderPoint: (article as any).reorderPoint ?? null,
      safetyStock: (article as any).safetyStock ?? null,
      minOrderQuantity: (article as any).minOrderQuantity ?? null,
      purchasePrice: (article as any).purchasePrice ?? 0,
      standardCost: (article as any).standardCost ?? 0,
      materialCost: (article as any).materialCost ?? 0,
      freightCost: (article as any).freightCost ?? 0,
      warehouseCost: (article as any).warehouseCost ?? 0,
      markupPercent: (article as any).markupPercent ?? null,
      chargeModel: (article as any).chargeModel || "",
      informationRequirements: Array.isArray((article as any).informationRequirements)
        ? ((article as any).informationRequirements as InformationRequirement[])
        : [],
      showMetadataFields: Array.isArray((article as any).showMetadataFields)
        ? ((article as any).showMetadataFields as ShowMetadataRow[])
        : [],
      leaveMetadataFields: Array.isArray((article as any).leaveMetadataFields)
        ? ((article as any).leaveMetadataFields as LeaveMetadataRow[])
        : [],
      performerCategory: (article as any).performerCategory || "",
      iconKey: (article as any).iconKey || "",
      competencyRequirements: Array.isArray((article as any).competencyRequirements)
        ? ((article as any).competencyRequirements as string[])
        : [],
    });
    {
      const om = article.offsetMinutes ?? 0;
      const type: "before" | "same" | "after" = om < 0 ? "before" : om > 0 ? "after" : "same";
      const absMin = Math.abs(om);
      const useDays = absMin !== 0 && absMin % 1440 === 0;
      setOffsetType(type);
      setOffsetUnit(useDays ? "days" : "minutes");
      setOffsetValueInput(String(type === "same" ? 0 : useDays ? absMin / 1440 : absMin));
    }
    if ((article as any).isStructure) {
      apiRequest("GET", `/api/articles/${article.id}/components`)
        .then((res) => res.json())
        .then((rows: any[]) => {
          const sorted = [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          setComponentDraft(
            sorted.map((r) => ({
              id: r.id,
              childArticleId: r.childArticleId,
              quantityMode: r.quantityFormula === "follows_parent" ? "follows_parent" : "fixed",
              quantity: typeof r.quantity === "number" ? r.quantity : 1,
              isMandatory: r.isMandatory ?? true,
              notes: r.notes || "",
            })),
          );
          setOriginalComponents(sorted.map((r) => ({ id: r.id, childArticleId: r.childArticleId })));
        })
        .catch(() => {
          toast({ title: "Kunde inte läsa strukturkomponenter", variant: "destructive" });
        });
    }
    setInitialized(true);
  }, [editingArticle, initialized, toast]);

  // Task #835: multi-AND metadata-villkor (Association).
  type MetadataCondition = Extract<AssociationCondition, { source: "metadata" }>;
  const metadataConditions = formData.associationRules.filter(
    (c): c is MetadataCondition => c.source === "metadata",
  );
  const writeMetadataConditions = (next: MetadataCondition[]) => {
    setFormData((prev) => ({
      ...prev,
      associationRules: [...prev.associationRules.filter((c) => c.source !== "metadata"), ...next],
    }));
  };
  const addMetadataCondition = () =>
    writeMetadataConditions([...metadataConditions, { source: "metadata", label: "", operator: "equals", value: "" }]);
  const updateMetadataCondition = (idx: number, patch: Partial<MetadataCondition>) =>
    writeMetadataConditions(metadataConditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const removeMetadataCondition = (idx: number) =>
    writeMetadataConditions(metadataConditions.filter((_, i) => i !== idx));

  // Strukturartikel (BOM): synka draft-komponenter mot servern efter spara.
  const reconcileComponents = async (
    parentId: string,
    draft: ComponentDraft[],
    originals: { id: string; childArticleId: string }[],
  ) => {
    const draftIds = new Set(draft.filter((d) => d.id).map((d) => d.id as string));
    for (const o of originals) {
      if (!draftIds.has(o.id)) {
        await apiRequest("DELETE", `/api/articles/${parentId}/components/${o.id}`);
      }
    }
    for (let i = 0; i < draft.length; i++) {
      const d = draft[i];
      if (!d.childArticleId) continue;
      const payload = {
        childArticleId: d.childArticleId,
        quantity: d.quantityMode === "follows_parent" ? 1 : Number.isFinite(d.quantity) && d.quantity > 0 ? d.quantity : 1,
        quantityFormula: d.quantityMode === "follows_parent" ? "follows_parent" : null,
        isMandatory: d.isMandatory,
        notes: d.notes || null,
        sortOrder: i,
      };
      if (d.id) {
        await apiRequest("PATCH", `/api/articles/${parentId}/components/${d.id}`, payload);
      } else {
        await apiRequest("POST", `/api/articles/${parentId}/components`, payload);
      }
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: Partial<ArticleFormData>) => {
      const res = await apiRequest("POST", "/api/articles", data);
      const created = await res.json();
      if (data.isStructure && created?.id) {
        await reconcileComponents(created.id, componentDraft, []);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: "Artikel skapad", description: "Artikeln har lagts till." });
      navigate("/articles");
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa artikel", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id: articleId, data }: { id: string; data: Partial<ArticleFormData> }) => {
      const res = await apiRequest("PATCH", `/api/articles/${articleId}`, data);
      const updated = await res.json();
      await reconcileComponents(articleId, data.isStructure ? componentDraft : [], originalComponents);
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: "Artikel uppdaterad", description: "Artikeln har uppdaterats." });
      navigate("/articles");
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte uppdatera artikel", description: error.message, variant: "destructive" });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Antalslogik: "Antalskälla" är UI-radion som mappar mot artikelns quantityMode.
  // Fast antal -> group (antalet = groupSize), Metadatafält -> per_styck (legacy
  // matches_field renderas som Metadatafält), Formel -> formula. Härleds från
  // quantityMode så att inget separat state behöver hållas i synk.
  const antalskalla: "fast" | "metadata" | "formel" =
    formData.quantityMode === "formula"
      ? "formel"
      : formData.quantityMode === "per_styck" || formData.quantityMode === "matches_field"
        ? "metadata"
        : "fast";
  const setAntalskalla = (val: "fast" | "metadata" | "formel") => {
    setFormData((prev) => ({
      ...prev,
      quantityMode: val === "formel" ? "formula" : val === "metadata" ? "per_styck" : "group",
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.articleNumber.trim() || !formData.name.trim()) {
      toast({ title: "Fyll i obligatoriska fält", description: "Artikelnummer och namn krävs innan du sparar.", variant: "destructive" });
      return;
    }
    if (articleNumberDuplicate) {
      toast({ title: "Artikelnummer används redan", description: "Välj ett unikt artikelnummer innan du sparar.", variant: "destructive" });
      return;
    }
    if (filesUploading) {
      toast({ title: "Vänta på uppladdning", description: "En fil laddas fortfarande upp.", variant: "destructive" });
      return;
    }
    if (formData.isStructure) {
      const rows = componentDraft;
      if (rows.some((d) => !d.childArticleId)) {
        toast({ title: "Ofullständig komponent", description: "Välj en artikel för varje komponentrad eller ta bort tomma rader.", variant: "destructive" });
        return;
      }
      const ids = rows.map((d) => d.childArticleId);
      if (new Set(ids).size !== ids.length) {
        toast({ title: "Dubblerad komponent", description: "Samma artikel får bara förekomma en gång i strukturen.", variant: "destructive" });
        return;
      }
    }

    const payload: Partial<ArticleFormData> & { fortnoxArticleNumber?: string | null } = { ...formData };
    payload.stockLocations = formData.stockLocations.filter((r) => (r.location || "").trim() !== "");
    payload.informationRequirements = formData.informationRequirements.filter((r) => (r.type || "").trim() !== "");
    payload.showMetadataFields = formData.showMetadataFields
      .filter((r) => (r.metadataField || "").trim() !== "")
      .map((r) => ({ metadataField: r.metadataField.trim(), clarification: (r.clarification || "").trim(), canUpdate: !!r.canUpdate }));
    payload.leaveMetadataFields = formData.leaveMetadataFields
      .filter((r) => (r.metadataField || "").trim() !== "")
      .map((r) => ({ metadataField: r.metadataField.trim(), instruction: (r.instruction || "").trim(), required: !!r.required }));
    payload.competencyRequirements = formData.competencyRequirements.filter((c) => (c || "").trim() !== "");
    if (fortnoxLinkTouched) {
      payload.fortnoxArticleNumber = fortnoxArticleNumber;
    }
    // Antalslogik: persistera bara fältet som hör till vald Antalskälla.
    if (formData.quantityMode === "formula") {
      const f = formData.quantityFormula.trim();
      if (!f) {
        toast({ title: "Formel saknas", description: "Ange en formel för antalet, t.ex. [Antal kärl] * 2.", variant: "destructive" });
        return;
      }
      (payload as any).quantityFormula = f;
      payload.quantityMetadataField = "";
    } else {
      (payload as any).quantityFormula = null;
      if (formData.quantityMode === "group" || formData.quantityMode === "single_per_task") {
        payload.quantityMetadataField = "";
      }
    }
    if (isEditMode && id) {
      updateMutation.mutate({ id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const pricing = computeArticlePricing({
    articleType: formData.articleType,
    purchasePrice: formData.purchasePrice || 0,
    standardCost: formData.standardCost || 0,
    materialCost: formData.materialCost || 0,
    freightCost: formData.freightCost || 0,
    warehouseCost: formData.warehouseCost || 0,
    markupPercent: formData.markupPercent,
    listPrice: formData.listPrice || 0,
    // Internkostnad är admin-only; uteslut den ur den visade självkostnaden för
    // icke-admins så att summan matchar förklaringstexten och inte avslöjar det
    // dolda fältet via subtraktion.
    cost: isAdmin ? (formData.cost || 0) : 0,
  });
  const marginOre = pricing.marginPerUnitOre;
  const marginPositive = marginOre >= 0;
  // Självkostnadens poster, beskrivet exakt så användaren ser vad som ingår.
  // Kostnadsbasen styrs av artikeltypen: vara → inköpspris, annars standardkostnad.
  const selfCostBasisLabel =
    formData.articleType === "vara" ? "inköpspris" : "standardkostnad";
  const selfCostParts = [selfCostBasisLabel, "materialkostnad", "fraktkostnad", "lagerkostnad"];
  if (isAdmin) selfCostParts.push("internkostnad");
  const selfCostFormula = selfCostParts.join(" + ");
  const marginReferenceLabel =
    (formData.listPrice || 0) > 0 ? "satt listpris" : "beräknat listpris";

  // Redigeringsläge: visa laddnings-/feltillstånd tills artikeln hämtats.
  if (isEditMode && articleLoading && !initialized) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="state-loading-article">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isEditMode && articleError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6" data-testid="state-error-article">
        <p className="text-sm text-destructive">Kunde inte läsa artikeln.</p>
        <Button variant="outline" onClick={() => navigate("/articles")} data-testid="button-back-articles">
          Tillbaka till artiklar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold" data-testid="text-form-title">
              {isEditMode ? "Redigera artikel" : "Ny artikel"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isEditMode ? "Uppdatera artikelinformation" : "Lägg till en ny artikel i systemet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => navigate("/articles")} data-testid="button-cancel-article">
              Avbryt
            </Button>
            <Button
              type="submit"
              form="article-form"
              disabled={isSaving || articleNumberDuplicate}
              data-testid="button-save-article"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Spara artikel
            </Button>
          </div>
        </div>
      </header>

      <form
        id="article-form"
        ref={scrollContainerRef}
        onSubmit={handleSubmit}
        className="flex-1 overflow-auto"
      >
        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="text-sr-announcement"
        >
          {srAnnouncement}
        </div>
        <div className="flex w-full items-start">
          <QuickNav
            sections={orderedNavSections}
            stats={sectionStats}
            pinnedSections={pinnedSections}
            activeSection={activeSection}
            onSectionClick={handleSectionClick}
            onExpandAll={expandAllSections}
            onCollapseAll={collapseAllSections}
          />
          <div className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:px-8">
          {/* 1. Grunddata */}
          <FormSection title="Grunddata" icon={<Package className="h-4 w-4" />} alwaysExpanded testId="section-grunddata" {...sectionProps("grunddata")}>
            <div className="space-y-2">
              <Label htmlFor="articleNumber">
                Artikelnummer <span className="text-destructive">*</span>
              </Label>
              <FortnoxArticleNumberField
                value={formData.articleNumber}
                onChange={(v) => {
                  setFormData((prev) => ({ ...prev, articleNumber: v }));
                  setFortnoxLinkTouched(true);
                  setFortnoxArticleNumber((prev) => (prev === v ? prev : null));
                }}
                onSelectFortnox={(a) => {
                  setFormData((prev) => {
                    const unitEmpty = !prev.unit.trim() || prev.unit === "st";
                    const priceEmpty = !prev.listPrice;
                    return {
                      ...prev,
                      articleNumber: a.articleNumber,
                      name: prev.name.trim() ? prev.name : a.description.slice(0, 50),
                      unit: unitEmpty && a.unit?.trim() ? a.unit.trim() : prev.unit,
                      listPrice: priceEmpty && a.salesPrice ? Math.round(a.salesPrice * 100) : prev.listPrice,
                    };
                  });
                  setFortnoxArticleNumber(a.articleNumber);
                  setFortnoxLinkTouched(true);
                }}
                invalid={articleNumberDuplicate}
              />
              {articleNumberDuplicate ? (
                <p className="flex items-start gap-1 text-xs text-destructive" data-testid="error-article-number-duplicate">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Artikelnumret används redan{articleNumberCheck?.existingName ? ` av "${articleNumberCheck.existingName}"` : ""}.</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Sök i Fortnox eller skriv fritext — måste vara unikt per organisation.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">
                Namn <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value.slice(0, 50) })}
                placeholder="Kärltömning 240L"
                required
                maxLength={50}
                data-testid="input-name"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Visningsnamn på artikeln.</p>
                <span
                  className={`text-xs tabular-nums ${formData.name.length >= 50 ? "text-warning" : "text-muted-foreground"}`}
                  data-testid="text-name-char-count"
                >
                  {formData.name.length}/50
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) =>
                    setFormData({ ...formData, status: value, ...(value !== "utgått" ? { replacementArticleId: "" } : {}) })
                  }
                >
                  <SelectTrigger id="status" data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ARTICLE_STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                    {(formData.status === "active" || formData.status === "inactive") && (
                      <SelectItem value={formData.status}>
                        {formData.status === "active" ? "Aktiv (äldre)" : "Inaktiv (äldre)"}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Enhet</Label>
                <Input
                  id="unit"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  placeholder="st"
                  data-testid="input-unit"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="articleType">Artikeltyp</Label>
                <Select
                  value={formData.articleType}
                  onValueChange={(value) =>
                    setFormData({ ...formData, articleType: value, ...(value === "vara" ? { productionTime: 0 } : {}) })
                  }
                >
                  <SelectTrigger id="articleType" data-testid="select-article-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {articleTypeOptions.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                    {formData.articleType && !articleTypeOptions.some((t) => t.value === formData.articleType) && (
                      <SelectItem value={formData.articleType}>{formData.articleType} (arkiverad)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="iconKey">Ikon</Label>
                <Select
                  value={formData.iconKey || "_none"}
                  onValueChange={(value) => setFormData({ ...formData, iconKey: value === "_none" ? "" : value })}
                >
                  <SelectTrigger id="iconKey" data-testid="select-article-icon">
                    <SelectValue placeholder="Ingen ikon" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Ingen ikon</SelectItem>
                    {iconDefs.map((icon) => {
                      const IconCmp = getLucideIconByName(icon.lucideName);
                      return (
                        <SelectItem key={icon.key} value={icon.key}>
                          <span className="flex items-center gap-2">
                            <IconCmp className="h-4 w-4" />
                            {icon.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                    {formData.iconKey && !iconDefs.some((i) => i.key === formData.iconKey) && (
                      <SelectItem value={formData.iconKey}>{formData.iconKey} (arkiverad)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.status === "utgått" && (
              <div className="space-y-2" data-testid="field-replacement-article">
                <Label htmlFor="replacementArticleId">Ersättningsartikel</Label>
                <Select
                  value={formData.replacementArticleId || "_none"}
                  onValueChange={(v) => setFormData({ ...formData, replacementArticleId: v === "_none" ? "" : v })}
                >
                  <SelectTrigger id="replacementArticleId" data-testid="select-replacement-article">
                    <SelectValue placeholder="Välj ersättningsartikel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Ingen</SelectItem>
                    {articles
                      .filter((a) => a.id !== id && a.status !== "utgått")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="mr-1 font-mono text-xs">{a.articleNumber}</span>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  När en utgången artikel läggs till på en order används ersättningsartikeln automatiskt.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="description">Kundbeskrivning</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Beskrivning som kan visas för kund (fakturor, följesedlar)..."
                rows={3}
                data-testid="input-description"
              />
              <div className="flex items-center justify-end">
                <span className="text-xs tabular-nums text-muted-foreground" data-testid="text-description-char-count">
                  {formData.description.length} tecken
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="internalDescription">Intern beskrivning</Label>
              <Textarea
                id="internalDescription"
                value={formData.internalDescription}
                onChange={(e) => setFormData({ ...formData, internalDescription: e.target.value })}
                placeholder="Intern beskrivning för administration (visas aldrig för kund)..."
                rows={3}
                data-testid="input-internal-description"
              />
              <div className="flex items-center justify-end">
                <span className="text-xs tabular-nums text-muted-foreground" data-testid="text-internal-description-char-count">
                  {formData.internalDescription.length} tecken
                </span>
              </div>
            </div>
          </FormSection>

          {/* 2. Fördjupad artikelinfo */}
          <FormSection title="Fördjupad artikelinfo" icon={<FileText className="h-4 w-4" />} testId="section-fordjupad-info" {...sectionProps("fordjupad-info")}>
            <div className="space-y-2">
              <Label>Filer</Label>
              <label
                htmlFor="input-files"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center hover-elevate"
                data-testid="dropzone-files"
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Klicka för att välja filer (max 20 MB per fil)</span>
                <input
                  id="input-files"
                  type="file"
                  multiple
                  className="hidden"
                  disabled={filesUploading}
                  onChange={(e) => {
                    handleFilesSelected(e.target.files);
                    e.target.value = "";
                  }}
                  data-testid="input-files"
                />
              </label>
              {filesUploading && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Laddar upp...
                </p>
              )}
              {formData.files.length > 0 && (
                <div className="space-y-2 pt-1">
                  {formData.files.map((file, i) => (
                    <div
                      key={`${file.url}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                      data-testid={`row-file-${i}`}
                    >
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 items-center gap-2 text-primary hover:underline"
                        data-testid={`link-file-${i}`}
                      >
                        <FileText className="h-4 w-4 shrink-0" />
                        <span className="truncate">{file.name}</span>
                        {typeof file.size === "number" && (
                          <span className="shrink-0 text-xs text-muted-foreground">({Math.round(file.size / 1024)} kB)</span>
                        )}
                      </a>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, files: formData.files.filter((_, idx) => idx !== i) })}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        data-testid={`button-remove-file-${i}`}
                        aria-label="Ta bort fil"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="externInfoUrl">Extern info — länk</Label>
              <Input
                id="externInfoUrl"
                type="url"
                value={formData.externInfoUrl}
                onChange={(e) => setFormData({ ...formData, externInfoUrl: e.target.value })}
                placeholder="https://..."
                data-testid="input-extern-info-url"
              />
              <Textarea
                id="externInfoDescription"
                value={formData.externInfoDescription}
                onChange={(e) => setFormData({ ...formData, externInfoDescription: e.target.value })}
                placeholder="Beskrivning av den externa länken (t.ex. produktblad, säkerhetsdatablad)..."
                rows={2}
                data-testid="input-extern-info-description"
              />
              {formData.externInfoFileUrl && (
                <div className="pt-1 space-y-1">
                  <Label className="text-sm">Bifogad fil</Label>
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm" data-testid="row-extern-info-file">
                    <a
                      href={formData.externInfoFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 truncate text-primary hover:underline"
                      data-testid="link-extern-info-file"
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">Öppna bifogad fil</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, externInfoFileUrl: "" })}
                      className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                      data-testid="button-remove-extern-info-file"
                      aria-label="Ta bort fil"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplierNumberInput">Leverantörsnummer</Label>
              <div className="flex gap-2">
                <Input
                  id="supplierNumberInput"
                  value={supplierNumberInput}
                  onChange={(e) => setSupplierNumberInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = supplierNumberInput.trim();
                      if (v && !formData.supplierNumbers.includes(v)) {
                        setFormData({ ...formData, supplierNumbers: [...formData.supplierNumbers, v] });
                      }
                      setSupplierNumberInput("");
                    }
                  }}
                  placeholder="Lägg till leverantörsnummer och tryck Enter"
                  data-testid="input-supplier-number"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const v = supplierNumberInput.trim();
                    if (v && !formData.supplierNumbers.includes(v)) {
                      setFormData({ ...formData, supplierNumbers: [...formData.supplierNumbers, v] });
                    }
                    setSupplierNumberInput("");
                  }}
                  data-testid="button-add-supplier-number"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {formData.supplierNumbers.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {formData.supplierNumbers.map((sn, i) => (
                    <Badge key={`${sn}-${i}`} variant="secondary" className="gap-1" data-testid={`badge-supplier-number-${i}`}>
                      <span className="font-mono text-xs">{sn}</span>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, supplierNumbers: formData.supplierNumbers.filter((_, idx) => idx !== i) })}
                        className="ml-0.5 hover:text-destructive"
                        data-testid={`button-remove-supplier-number-${i}`}
                        aria-label="Ta bort leverantörsnummer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Artikelns nummer hos olika leverantörer (valfritt, flera tillåtna).</p>
            </div>
          </FormSection>

          {/* 3. Lager & Inköp */}
          <FormSection title="Lager & Inköp" icon={<Warehouse className="h-4 w-4" />} testId="section-lager-inkop" {...sectionProps("lager-inkop")}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Lagerplatser</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      stockLocations: [...formData.stockLocations, { location: "", balance: null, minLevel: null, reorderPoint: null }],
                    })
                  }
                  data-testid="button-add-stock-location"
                >
                  <Plus className="mr-1 h-4 w-4" /> Lägg till lagerplats
                </Button>
              </div>
              {formData.stockLocations.length === 0 && (
                <p className="text-xs text-muted-foreground">Inga lagerplatser angivna.</p>
              )}
              {formData.stockLocations.map((row, idx) => {
                const patch = (p: Partial<StockLocationRow>) =>
                  setFormData((prev) => ({
                    ...prev,
                    stockLocations: prev.stockLocations.map((r, i) => (i === idx ? { ...r, ...p } : r)),
                  }));
                const numOrNull = (v: string): number | null => (v.trim() === "" ? null : parseInt(v, 10) || 0);
                return (
                  <div key={idx} className="space-y-2 rounded-md border p-3" data-testid={`row-stock-location-${idx}`}>
                    <div className="flex items-center gap-2">
                      <Input
                        value={row.location}
                        onChange={(e) => patch({ location: e.target.value })}
                        placeholder="Lagerplats (t.ex. Lager A, hylla 3)"
                        className="flex-1"
                        data-testid={`input-stock-location-name-${idx}`}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setFormData({ ...formData, stockLocations: formData.stockLocations.filter((_, i) => i !== idx) })}
                        data-testid={`button-remove-stock-location-${idx}`}
                        aria-label="Ta bort lagerplats"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Saldo (beräknat)</Label>
                        <Input
                          type="number"
                          value={row.balance ?? ""}
                          disabled
                          placeholder="—"
                          data-testid={`input-stock-balance-${idx}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Miniminivå</Label>
                        <Input
                          type="number"
                          value={row.minLevel ?? ""}
                          onChange={(e) => patch({ minLevel: numOrNull(e.target.value) })}
                          placeholder="—"
                          data-testid={`input-stock-min-level-${idx}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Beställningspunkt</Label>
                        <Input
                          type="number"
                          value={row.reorderPoint ?? ""}
                          onChange={(e) => patch({ reorderPoint: numOrNull(e.target.value) })}
                          placeholder="—"
                          data-testid={`input-stock-reorder-point-${idx}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="defaultSupplierId">Standardleverantör</Label>
                <Select
                  value={formData.defaultSupplierId || "_none"}
                  onValueChange={(v) => setFormData({ ...formData, defaultSupplierId: v === "_none" ? "" : v })}
                >
                  <SelectTrigger id="defaultSupplierId" data-testid="select-default-supplier">
                    <SelectValue placeholder="Ingen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Ingen</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="leadTimeDays">Leveranstid (dagar)</Label>
                <Input
                  id="leadTimeDays"
                  type="number"
                  min="0"
                  step="1"
                  value={formData.leadTimeDays ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setFormData({ ...formData, leadTimeDays: raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0) });
                  }}
                  data-testid="input-lead-time-days"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reorderPoint">Beställningspunkt</Label>
                <Input
                  id="reorderPoint"
                  type="number"
                  min="0"
                  value={formData.reorderPoint ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setFormData({ ...formData, reorderPoint: raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0) });
                  }}
                  data-testid="input-reorder-point"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="safetyStock">Säkerhetslager</Label>
                <Input
                  id="safetyStock"
                  type="number"
                  min="0"
                  value={formData.safetyStock ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setFormData({ ...formData, safetyStock: raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0) });
                  }}
                  data-testid="input-safety-stock"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minOrderQuantity">Minsta orderantal</Label>
                <Input
                  id="minOrderQuantity"
                  type="number"
                  min="0"
                  value={formData.minOrderQuantity ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setFormData({ ...formData, minOrderQuantity: raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0) });
                  }}
                  data-testid="input-min-order-quantity"
                />
              </div>
            </div>
          </FormSection>

          {/* 4. Pris & Ekonomi */}
          <FormSection title="Pris & Ekonomi" icon={<DollarSign className="h-4 w-4" />} testId="section-pris-ekonomi" {...sectionProps("pris-ekonomi")}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="listPrice">Listpris (kr)</Label>
                <Input
                  id="listPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.listPrice ? (formData.listPrice / 100).toString() : ""}
                  placeholder="0.00"
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData({ ...formData, listPrice: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                  }}
                  data-testid="input-list-price"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="purchasePrice">Inköpspris (kr)</Label>
                <Input
                  id="purchasePrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.purchasePrice ? (formData.purchasePrice / 100).toString() : ""}
                  placeholder="0.00"
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData({ ...formData, purchasePrice: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                  }}
                  data-testid="input-purchase-price"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="standardCost">Standardkostnad (kr)</Label>
                <Input
                  id="standardCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.standardCost ? (formData.standardCost / 100).toString() : ""}
                  placeholder="0.00"
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData({ ...formData, standardCost: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                  }}
                  data-testid="input-standard-cost"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="materialCost">Materialkostnad (kr)</Label>
                <Input
                  id="materialCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.materialCost ? (formData.materialCost / 100).toString() : ""}
                  placeholder="0.00"
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData({ ...formData, materialCost: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                  }}
                  data-testid="input-material-cost"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="freightCost">Fraktkostnad (kr)</Label>
                <Input
                  id="freightCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.freightCost ? (formData.freightCost / 100).toString() : ""}
                  placeholder="0.00"
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData({ ...formData, freightCost: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                  }}
                  data-testid="input-freight-cost"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warehouseCost">Lagerkostnad (kr)</Label>
                <Input
                  id="warehouseCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.warehouseCost ? (formData.warehouseCost / 100).toString() : ""}
                  placeholder="0.00"
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData({ ...formData, warehouseCost: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                  }}
                  data-testid="input-warehouse-cost"
                />
              </div>
              {isAdmin && (
                <div className="space-y-2">
                  <Label htmlFor="cost">Internkostnad (kr)</Label>
                  <Input
                    id="cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.cost ? (formData.cost / 100).toString() : ""}
                    placeholder="0.00"
                    onChange={(e) => {
                      const v = e.target.value;
                      setFormData({ ...formData, cost: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                    }}
                    data-testid="input-cost"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="markupPercent">Påslag (%)</Label>
                <Input
                  id="markupPercent"
                  type="number"
                  step="0.1"
                  value={formData.markupPercent ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setFormData({ ...formData, markupPercent: raw === "" ? null : parseFloat(raw) || 0 });
                  }}
                  data-testid="input-markup-percent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="chargeModel">Debiteringsmodell</Label>
                <Select
                  value={formData.chargeModel || "_none"}
                  onValueChange={(v) => setFormData({ ...formData, chargeModel: v === "_none" ? "" : v })}
                >
                  <SelectTrigger id="chargeModel" data-testid="select-charge-model">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">—</SelectItem>
                    {CHARGE_MODEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {formData.articleType !== "vara" && (
                <div className="space-y-2">
                  <Label htmlFor="productionTime">Produktionstid (min)</Label>
                  <Input
                    id="productionTime"
                    type="number"
                    min="0"
                    value={formData.productionTime}
                    onChange={(e) => setFormData({ ...formData, productionTime: parseInt(e.target.value) || 0 })}
                    data-testid="input-production-time"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-md border bg-muted/40 px-3 py-3 text-sm" data-testid="panel-price-buildup">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Självkostnad</span>
                <span className="font-mono" data-testid="text-article-self-cost">
                  {formatSekFromOre(pricing.selfCostOre, { decimals: true })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Beräknat listpris (självkostnad × påslag)</span>
                <span className="font-mono" data-testid="text-article-computed-list-price">
                  {formatSekFromOre(pricing.computedListPriceOre, { decimals: true })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Marginal (mot {marginReferenceLabel})</span>
                <span className="font-mono" data-testid="text-article-margin-percent">
                  {pricing.marginPercent != null ? `${pricing.marginPercent.toFixed(1)} %` : "–"}
                </span>
              </div>
            </div>
            <div
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                marginPositive
                  ? "border-chart-2/20 bg-chart-2/10 text-chart-2"
                  : "border-destructive/20 bg-destructive/10 text-destructive"
              }`}
              data-testid="text-article-margin"
            >
              <span className="font-medium">Marginal per enhet</span>
              <span className="font-mono">
                {marginPositive ? "+" : ""}
                {formatSekFromOre(marginOre, { decimals: true })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="text-self-cost-explainer">
              Självkostnad = {selfCostFormula} (kostnadsbas: {formData.articleType === "vara" ? "inköpspris för vara" : "standardkostnad för tjänst"}).
              Beräknat listpris = självkostnad × (1 + påslag%). Marginal beräknas mot {marginReferenceLabel} (satt listpris om det finns, annars beräknat listpris).
            </p>
          </FormSection>

          {/* 5. Planeringslogik */}
          <FormSection title="Planeringslogik" icon={<CalendarClock className="h-4 w-4" />} testId="section-planeringslogik" {...sectionProps("planeringslogik")}>
            <div className="space-y-3">
              <Label>Offsettid</Label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="offsetUnit" className="text-sm text-muted-foreground">
                    Enhet
                  </Label>
                  <Select
                    value={offsetUnit}
                    onValueChange={(v) => {
                      const unit = v as "minutes" | "days";
                      setOffsetUnit(unit);
                      setFormData((prev) => ({ ...prev, offsetMinutes: computeOffsetMinutes(unit, offsetType, offsetValueInput) }));
                    }}
                  >
                    <SelectTrigger id="offsetUnit" data-testid="select-offset-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">Minuter</SelectItem>
                      <SelectItem value="days">Dagar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="offsetValue" className="text-sm text-muted-foreground">
                    Värde
                  </Label>
                  <Input
                    id="offsetValue"
                    type="number"
                    min="0"
                    step="1"
                    value={offsetValueInput}
                    disabled={offsetType === "same"}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setOffsetValueInput(raw);
                      setFormData((prev) => ({ ...prev, offsetMinutes: computeOffsetMinutes(offsetUnit, offsetType, raw) }));
                    }}
                    onBlur={() => {
                      const mag = Math.abs(parseInt(offsetValueInput, 10) || 0);
                      setOffsetValueInput(String(mag));
                      setFormData((prev) => ({ ...prev, offsetMinutes: computeOffsetMinutes(offsetUnit, offsetType, String(mag)) }));
                    }}
                    data-testid="input-offset-value"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Typ</Label>
                <div className="flex flex-col gap-2">
                  {(
                    [
                      { value: "before", label: "Före huvudjobb (negativ)" },
                      { value: "same", label: "Samtidigt (0)" },
                      { value: "after", label: "Efter huvudjobb (positiv)" },
                    ] as const
                  ).map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="offsetType"
                        value={opt.value}
                        checked={offsetType === opt.value}
                        onChange={() => {
                          setOffsetType(opt.value);
                          if (opt.value === "same") setOffsetValueInput("0");
                          setFormData((prev) => ({ ...prev, offsetMinutes: computeOffsetMinutes(offsetUnit, opt.value, opt.value === "same" ? "0" : offsetValueInput) }));
                        }}
                        data-testid={`radio-offset-type-${opt.value}`}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Styr <strong>när</strong> uppgiften utförs relativt huvudjobbet. Sparas som {formData.offsetMinutes} min.
              </p>
            </div>

            {formData.articleType === "beroende" && (
              <div className="space-y-3 rounded-md border p-3" data-testid="section-dependency">
                <Label className="text-sm font-medium">Beroendeartikel</Label>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={formData.requiresAcknowledgment}
                    onChange={(e) => setFormData({ ...formData, requiresAcknowledgment: e.target.checked })}
                    data-testid="checkbox-requires-acknowledgment"
                  />
                  <span>Kräver kvittens — beroendets tillgänglighet måste bekräftas innan huvuduppgiften kan utföras.</span>
                </label>
                <div className="space-y-2">
                  <Label htmlFor="dependencyCriticality" className="text-sm text-muted-foreground">
                    Kritiskhet
                  </Label>
                  <Select
                    value={formData.dependencyCriticality || "critical"}
                    onValueChange={(v) => setFormData({ ...formData, dependencyCriticality: v })}
                  >
                    <SelectTrigger id="dependencyCriticality" data-testid="select-dependency-criticality">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">Kritisk (blockerar huvuduppgiften)</SelectItem>
                      <SelectItem value="skippable">Kan strykas (varning men blockerar ej)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </FormSection>

          {/* 6. Strukturartikel (BOM) */}
          <FormSection title="Strukturartikel" icon={<Layers className="h-4 w-4" />} testId="section-struktur" {...sectionProps("struktur")}>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={formData.isStructure}
                onChange={(e) => setFormData({ ...formData, isStructure: e.target.checked })}
                data-testid="checkbox-is-structure"
              />
              <span>
                <strong>Strukturartikel</strong> — artikeln består av flera underartiklar. Varje underartikel blir en
                delkomponent/deluppgift.
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={formData.isComponent}
                onChange={(e) => setFormData({ ...formData, isComponent: e.target.checked })}
                data-testid="checkbox-is-component"
              />
              <span>Kan användas som komponent i strukturartiklar.</span>
            </label>

            {formData.isStructure && (
              <div className="space-y-3 border-t pt-3" data-testid="structure-components-editor">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Komponenter (underartiklar)</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setComponentDraft((prev) => [
                        ...prev,
                        { childArticleId: "", quantityMode: "follows_parent", quantity: 1, isMandatory: true, notes: "" },
                      ])
                    }
                    data-testid="button-add-component"
                  >
                    <Plus className="mr-1 h-4 w-4" /> Lägg till komponent
                  </Button>
                </div>

                {(formData.quantityMode === "per_styck" || formData.quantityMode === "matches_field" || formData.quantityMode === "formula") && componentDraft.some((d) => d.quantityMode === "fixed") && (
                  <p className="text-xs text-warning" data-testid="warning-quantity-base">
                    Huvudartikeln skalar antal via metadata, men en eller flera komponenter har fast antal — dessa följer inte
                    huvudartikelns antal.
                  </p>
                )}

                {componentDraft.length === 0 && (
                  <p className="text-xs text-muted-foreground">Inga komponenter ännu. Lägg till minst en underartikel.</p>
                )}

                {componentDraft.map((row, idx) => {
                  const selectableArticles = articles.filter(
                    (a) =>
                      a.id !== id &&
                      !(a as any).isStructure &&
                      (a.id === row.childArticleId || !componentDraft.some((other, oi) => oi !== idx && other.childArticleId === a.id)),
                  );
                  const patch = (p: Partial<ComponentDraft>) =>
                    setComponentDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...p } : r)));
                  return (
                    <div key={idx} className="space-y-2 rounded-md border p-2" data-testid={`component-row-${idx}`}>
                      <div className="flex items-center gap-2">
                        <Select value={row.childArticleId || undefined} onValueChange={(v) => patch({ childArticleId: v })}>
                          <SelectTrigger className="flex-1" data-testid={`select-component-article-${idx}`}>
                            <SelectValue placeholder="Välj underartikel" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectableArticles.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.articleNumber} – {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => setComponentDraft((prev) => prev.filter((_, i) => i !== idx))}
                          data-testid={`button-remove-component-${idx}`}
                          aria-label="Ta bort komponent"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Select value={row.quantityMode} onValueChange={(v) => patch({ quantityMode: v as ComponentDraft["quantityMode"] })}>
                          <SelectTrigger className="w-56" data-testid={`select-component-qtymode-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="follows_parent">Följer huvudartikel</SelectItem>
                            <SelectItem value="fixed">Eget antal</SelectItem>
                          </SelectContent>
                        </Select>
                        {row.quantityMode === "fixed" && (
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            className="w-28"
                            value={row.quantity}
                            onChange={(e) => patch({ quantity: parseFloat(e.target.value) || 0 })}
                            data-testid={`input-component-qty-${idx}`}
                          />
                        )}
                        <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={row.isMandatory}
                            onChange={(e) => patch({ isMandatory: e.target.checked })}
                            data-testid={`checkbox-component-mandatory-${idx}`}
                          />
                          Obligatorisk
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </FormSection>

          {/* 7. Fasthakningslogik */}
          <FormSection
            title="Fasthakningslogik"
            icon={<LinkIcon className="h-4 w-4" />}
            description="Haka fast artikeln på objekt vars metadata uppfyller ALLA villkor (OCH-logik)"
            testId="section-fasthakning"
            {...sectionProps("fasthakning")}
          >
            <div className="space-y-3">
              {metadataConditions.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="text-no-association-rules">
                  Inga villkor. Artikeln hakar inte fast automatiskt via metadata.
                </p>
              )}

              {metadataConditions.map((cond, idx) => {
                const needsValue = cond.operator !== "has_value";
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-1 items-end gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                    data-testid={`row-association-rule-${idx}`}
                  >
                    <div className="space-y-1">
                      <Label className="text-xs">Metadatafält</Label>
                      <Select
                        value={cond.label || "_none"}
                        onValueChange={(v) => updateMetadataCondition(idx, { label: v === "_none" ? "" : v })}
                      >
                        <SelectTrigger data-testid={`select-association-label-${idx}`}>
                          <SelectValue placeholder="Välj fält" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Välj fält</SelectItem>
                          {metadataLabels.map((ml) => (
                            <SelectItem key={ml.id} value={ml.beteckning || ml.namn}>
                              {metadataDisplayName(ml)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Operator</Label>
                      <Select
                        value={cond.operator || "equals"}
                        onValueChange={(v) => updateMetadataCondition(idx, { operator: v as MetadataCondition["operator"] })}
                      >
                        <SelectTrigger data-testid={`select-association-operator-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">Lika med</SelectItem>
                          <SelectItem value="contains">Innehåller</SelectItem>
                          <SelectItem value="greater">Större än</SelectItem>
                          <SelectItem value="less">Mindre än</SelectItem>
                          <SelectItem value="has_value">Fältet har ett värde</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Värde</Label>
                      <Input
                        value={cond.value ?? ""}
                        disabled={!needsValue}
                        onChange={(e) => updateMetadataCondition(idx, { value: e.target.value })}
                        placeholder={needsValue ? "t.ex. Matavfall, 240" : "—"}
                        data-testid={`input-association-value-${idx}`}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMetadataCondition(idx)}
                      data-testid={`btn-remove-association-rule-${idx}`}
                      aria-label="Ta bort villkor"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}

              <Button type="button" variant="outline" size="sm" onClick={addMetadataCondition} data-testid="btn-add-association-rule">
                <Plus className="mr-1 h-4 w-4" /> Lägg till villkor
              </Button>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <Label className="text-sm font-medium">Testa association</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                <Select
                  value={formData.associationLabel || "_none"}
                  onValueChange={(v) => setFormData({ ...formData, associationLabel: v === "_none" ? "" : v })}
                >
                  <SelectTrigger data-testid="select-test-association-label">
                    <SelectValue placeholder="Metadatafält" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Välj fält</SelectItem>
                    {metadataLabels.map((ml) => (
                      <SelectItem key={ml.id} value={ml.beteckning || ml.namn}>
                        {metadataDisplayName(ml)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={formData.associationOperator || "equals"}
                  onValueChange={(v) => setFormData({ ...formData, associationOperator: v })}
                >
                  <SelectTrigger data-testid="select-test-association-operator">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equals">Lika med</SelectItem>
                    <SelectItem value="contains">Innehåller</SelectItem>
                    <SelectItem value="greater">Större än</SelectItem>
                    <SelectItem value="less">Mindre än</SelectItem>
                    <SelectItem value="has_value">Fältet har ett värde</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={formData.associationValue}
                  disabled={formData.associationOperator === "has_value"}
                  onChange={(e) => setFormData({ ...formData, associationValue: e.target.value })}
                  placeholder={formData.associationOperator === "has_value" ? "—" : "Värde"}
                  data-testid="input-test-association-value"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestAssociation}
                disabled={!formData.associationLabel || (formData.associationOperator !== "has_value" && !formData.associationValue) || assocTestLoading}
                data-testid="button-test-association"
              >
                {assocTestLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Beaker className="mr-1 h-4 w-4" />}
                Testa association
              </Button>
              {assocTestResult && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="text-association-test-result">
                  {assocTestResult.labelFound ? (
                    <p className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-chart-2" />
                      {assocTestResult.matchCount} objekt matchar villkoret.
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 text-warning">
                      <AlertTriangle className="h-4 w-4" />
                      Metadatafältet hittades inte.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-3" data-testid="section-geo-dependent">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!formData.isGeoDependent}
                  onChange={(e) => setFormData({ ...formData, isGeoDependent: !e.target.checked })}
                  data-testid="checkbox-not-geo-dependent"
                />
                <span>Ej beroende av objektets geografiska position</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Kryssa i för artiklar som inte behöver geopositionering (t.ex. administrativa eller centralt utförda poster).
              </p>
            </div>
          </FormSection>

          {/* 8. Antalslogik */}
          <FormSection title="Antalslogik" icon={<ListChecks className="h-4 w-4" />} testId="section-antalslogik" {...sectionProps("antalslogik")}>
            <div className="space-y-3">
              <Label>Antalskälla</Label>
              <div className="space-y-2" role="radiogroup" aria-label="Antalskälla">
                {/* Fast antal -> quantityMode 'group' (antalet = groupSize) */}
                <label className="flex cursor-pointer items-start gap-2" data-testid="radio-antalskalla-fast">
                  <input
                    type="radio"
                    name="antalskalla"
                    className="mt-1"
                    checked={antalskalla === "fast"}
                    onChange={() => setAntalskalla("fast")}
                    data-testid="input-antalskalla-fast"
                  />
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Fast antal</span>
                    <p className="text-xs text-muted-foreground">Ett fast antal per uppdrag.</p>
                  </div>
                </label>
                {antalskalla === "fast" && (
                  <div className="ml-6 grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="field-fast-quantity">
                    <div className="space-y-2">
                      <Label htmlFor="groupSize" className="text-sm">
                        Antal
                      </Label>
                      <Input
                        id="groupSize"
                        type="number"
                        min="1"
                        value={formData.groupSize}
                        onChange={(e) => setFormData({ ...formData, groupSize: Math.max(1, parseInt(e.target.value) || 1) })}
                        data-testid="input-group-size"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quantityUnit" className="text-sm">
                        Enhet
                      </Label>
                      <Input
                        id="quantityUnit"
                        value={formData.quantityUnit}
                        onChange={(e) => setFormData({ ...formData, quantityUnit: e.target.value })}
                        placeholder="t.ex. st, m², kg"
                        data-testid="input-quantity-unit"
                      />
                    </div>
                  </div>
                )}

                {/* Metadatafält -> quantityMode 'per_styck' (objektets metadatavärde) */}
                <label className="flex cursor-pointer items-start gap-2" data-testid="radio-antalskalla-metadata">
                  <input
                    type="radio"
                    name="antalskalla"
                    className="mt-1"
                    checked={antalskalla === "metadata"}
                    onChange={() => setAntalskalla("metadata")}
                    data-testid="input-antalskalla-metadata"
                  />
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Metadatafält</span>
                    <p className="text-xs text-muted-foreground">Hämta antalet från ett av objektets metadatafält.</p>
                  </div>
                </label>
                {antalskalla === "metadata" && (
                  <div className="ml-6 space-y-2" data-testid="field-quantity-metadata">
                    <Label htmlFor="quantityMetadataField" className="text-sm">
                      Välj metadatafält
                    </Label>
                    <Select
                      value={formData.quantityMetadataField || "_none"}
                      onValueChange={(v) => setFormData({ ...formData, quantityMetadataField: v === "_none" ? "" : v })}
                    >
                      <SelectTrigger id="quantityMetadataField" data-testid="select-quantity-metadata-field">
                        <SelectValue placeholder="Välj metadatafält" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Välj metadatafält</SelectItem>
                        {metadataTypes.map((t) => (
                          <SelectItem key={t.id} value={t.namn}>
                            {metadataDisplayName(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!formData.quantityMetadataField && (
                      <p className="flex items-start gap-1 text-xs text-muted-foreground" data-testid="hint-quantity-metadata-optional">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>Lämna tomt för att använda objektets standardantal.</span>
                      </p>
                    )}
                  </div>
                )}

                {/* Formel -> quantityMode 'formula' (beräknat från metadatafält) */}
                <label className="flex cursor-pointer items-start gap-2" data-testid="radio-antalskalla-formel">
                  <input
                    type="radio"
                    name="antalskalla"
                    className="mt-1"
                    checked={antalskalla === "formel"}
                    onChange={() => setAntalskalla("formel")}
                    data-testid="input-antalskalla-formel"
                  />
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Formel</span>
                    <p className="text-xs text-muted-foreground">Räkna ut antalet från metadatafält, t.ex. [Antal kärl] * 2.</p>
                  </div>
                </label>
                {antalskalla === "formel" && (
                  <div className="ml-6 space-y-2" data-testid="field-quantity-formula">
                    <Label htmlFor="quantityFormula" className="text-sm">
                      Formel
                    </Label>
                    <Input
                      id="quantityFormula"
                      value={formData.quantityFormula}
                      onChange={(e) => setFormData({ ...formData, quantityFormula: e.target.value })}
                      placeholder="[Antal kärl] * 2"
                      data-testid="input-quantity-formula"
                    />
                    <p className="flex items-start gap-1 text-xs text-muted-foreground" data-testid="hint-quantity-formula">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Skriv metadatafält inom hakparenteser och kombinera med + - * / och parenteser. Tillgängliga fält:{" "}
                        {metadataTypes.length > 0 ? metadataTypes.map((t) => t.namn).join(", ") : "inga metadatafält ännu"}.
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3 border-t pt-3">
              <p className="text-sm font-medium">Antal-behörighet i fält</p>
              <label className={`flex items-center gap-2 ${formData.hideQuantityInApp ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={formData.operatorCanUpdateQuantity}
                  disabled={formData.hideQuantityInApp}
                  onChange={(e) => setFormData({ ...formData, operatorCanUpdateQuantity: e.target.checked })}
                  data-testid="checkbox-operator-can-update-quantity"
                />
                <span className="text-sm">Fältarbetare får ändra antal vid utförande</span>
              </label>
              {formData.operatorCanUpdateQuantity && (
                <>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.freeMetadataUpdate}
                      onChange={(e) => setFormData({ ...formData, freeMetadataUpdate: e.target.checked })}
                      data-testid="checkbox-free-metadata-update"
                    />
                    <span className="text-sm">Skriv tillbaka nytt antal till objektets metadata</span>
                  </label>
                  {formData.freeMetadataUpdate && !formData.quantityMetadataField && (
                    <p className="flex items-start gap-1 text-xs text-warning" data-testid="warning-free-metadata-no-field">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>Inget metadatafält valt — välj Antalskällan "Metadatafält" och ett fält för att kunna skriva tillbaka antalet.</span>
                    </p>
                  )}
                </>
              )}
              {/* GAP-106: dölj antalsfältet i fältappen för artiklar med fast/härlett antal.
                  Ömsesidigt uteslutande med "får ändra antal" — ett dolt fält kan inte redigeras. */}
              <label className={`flex items-center gap-2 ${formData.operatorCanUpdateQuantity ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={formData.hideQuantityInApp}
                  disabled={formData.operatorCanUpdateQuantity}
                  onChange={(e) => setFormData({ ...formData, hideQuantityInApp: e.target.checked, operatorCanUpdateQuantity: e.target.checked ? false : formData.operatorCanUpdateQuantity })}
                  data-testid="checkbox-hide-quantity-in-app"
                />
                <span className="text-sm">Dölj antalsfältet i appen (fast/härlett antal)</span>
              </label>
              <p className="text-xs text-muted-foreground">
                För artiklar med fast eller härlett antal (t.ex. besiktning/kontroll). Fältarbetaren ser inget redigerbart antalsfält — det fasta antalet används automatiskt vid rapportering.
              </p>
            </div>

            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="limitationType">Begränsningstyp</Label>
              <Select value={formData.limitationType || "unlimited"} onValueChange={(v) => setFormData({ ...formData, limitationType: v })}>
                <SelectTrigger id="limitationType" data-testid="select-limitation-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unlimited">Obegränsad</SelectItem>
                  <SelectItem value="one_per_address">En gång per adress</SelectItem>
                  <SelectItem value="one_per_object">En gång per objekt</SelectItem>
                  <SelectItem value="one_per_customer">En gång per kund</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxPerAddress">Max antal per adress</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="maxPerAddress"
                  type="number"
                  min={1}
                  placeholder="Obegränsat"
                  value={formData.maxPerAddress ?? ""}
                  onChange={(e) => setFormData({ ...formData, maxPerAddress: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-32"
                  data-testid="input-max-per-address"
                />
                <span className="text-xs text-muted-foreground">
                  {formData.maxPerAddress ? `Max ${formData.maxPerAddress} per adress` : "Ingen begränsning"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Hur många gånger artikeln får beställas på samma adress. Lämna tomt för obegränsat.
              </p>
            </div>
          </FormSection>

          {/* 9. Visa och uppdatera metadata */}
          <FormSection
            title="Visa och uppdatera metadata"
            icon={<Database className="h-4 w-4" />}
            description="Välj vilka metadatafält som visas för utföraren och vilka som ska lämnas/rapporteras vid utförande"
            testId="section-metadata"
            {...sectionProps("metadata")}
          >
            {/* Visa metadata */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Visa metadata</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      showMetadataFields: [...prev.showMetadataFields, { metadataField: "", clarification: "", canUpdate: false }],
                    }))
                  }
                  data-testid="button-add-show-metadata"
                >
                  <Plus className="mr-1 h-4 w-4" /> Lägg till fält
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Metadatafält som visas för utföraren vid utförande. Kryssa "Får uppdatera" för att låta fältarbetaren ändra det befintliga värdet.
              </p>
              {formData.showMetadataFields.length === 0 && (
                <p className="text-xs text-muted-foreground" data-testid="text-show-metadata-empty">Inga fält att visa.</p>
              )}
              {formData.showMetadataFields.map((row, idx) => {
                const patch = (p: Partial<ShowMetadataRow>) =>
                  setFormData((prev) => ({
                    ...prev,
                    showMetadataFields: prev.showMetadataFields.map((r, i) => (i === idx ? { ...r, ...p } : r)),
                  }));
                return (
                  <div key={idx} className="space-y-2 rounded-md border p-3" data-testid={`row-show-metadata-${idx}`}>
                    <div className="flex items-center gap-2">
                      <Select value={row.metadataField || "_none"} onValueChange={(v) => patch({ metadataField: v === "_none" ? "" : v })}>
                        <SelectTrigger className="flex-1" data-testid={`select-show-metadata-field-${idx}`}>
                          <SelectValue placeholder="Välj metadatafält" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Välj metadatafält</SelectItem>
                          {groupParentTypes.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Grupper (alla underfält)</SelectLabel>
                              {groupParentTypes.map((t) => (
                                <SelectItem key={`group-${t.id}`} value={t.namn}>{metadataDisplayName(t)} – alla fält</SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          <SelectGroup>
                            <SelectLabel>Enskilda fält</SelectLabel>
                            {individualMetadataTypes.map((t) => (
                              <SelectItem key={t.id} value={t.namn}>{metadataDisplayName(t)}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            showMetadataFields: prev.showMetadataFields.filter((_, i) => i !== idx),
                          }))
                        }
                        data-testid={`button-remove-show-metadata-${idx}`}
                        aria-label="Ta bort fält"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {groupParentNames.has(row.metadataField) && (
                      <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground" data-testid={`preview-show-group-children-${idx}`}>
                        <span className="font-medium text-foreground">Grupp:</span> inkluderar {(metadataChildrenByParentName.get(row.metadataField) ?? []).join(", ") || "inga underfält ännu"} (uppdateras automatiskt när underfält läggs till).
                      </div>
                    )}
                    <Input
                      value={row.clarification}
                      onChange={(e) => patch({ clarification: e.target.value })}
                      placeholder="Förklaring för utföraren (valfritt)"
                      maxLength={120}
                      data-testid={`input-show-metadata-clarification-${idx}`}
                    />
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={row.canUpdate}
                        onChange={(e) => patch({ canUpdate: e.target.checked })}
                        data-testid={`checkbox-show-metadata-can-update-${idx}`}
                      />
                      Fältarbetaren får uppdatera/ersätta befintligt värde
                    </label>
                  </div>
                );
              })}
            </div>

            {/* Lämna metadata */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Lämna metadata</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      leaveMetadataFields: [...prev.leaveMetadataFields, { metadataField: "", instruction: "", required: false }],
                    }))
                  }
                  data-testid="button-add-leave-metadata"
                >
                  <Plus className="mr-1 h-4 w-4" /> Lägg till fält
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Metadatafält som utföraren ska fylla i/rapportera. Kryssa "Obligatorisk" för att kräva ett värde innan uppgiften kan slutföras.
              </p>
              {formData.leaveMetadataFields.length === 0 && (
                <p className="text-xs text-muted-foreground" data-testid="text-leave-metadata-empty">Inga fält att lämna.</p>
              )}
              {formData.leaveMetadataFields.map((row, idx) => {
                const patch = (p: Partial<LeaveMetadataRow>) =>
                  setFormData((prev) => ({
                    ...prev,
                    leaveMetadataFields: prev.leaveMetadataFields.map((r, i) => (i === idx ? { ...r, ...p } : r)),
                  }));
                return (
                  <div key={idx} className="space-y-2 rounded-md border p-3" data-testid={`row-leave-metadata-${idx}`}>
                    <div className="flex items-center gap-2">
                      <Select value={row.metadataField || "_none"} onValueChange={(v) => patch({ metadataField: v === "_none" ? "" : v })}>
                        <SelectTrigger className="flex-1" data-testid={`select-leave-metadata-field-${idx}`}>
                          <SelectValue placeholder="Välj metadatafält" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Välj metadatafält</SelectItem>
                          {groupParentTypes.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Grupper (alla underfält)</SelectLabel>
                              {groupParentTypes.map((t) => (
                                <SelectItem key={`group-${t.id}`} value={t.namn}>{metadataDisplayName(t)} – alla fält</SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          <SelectGroup>
                            <SelectLabel>Enskilda fält</SelectLabel>
                            {individualMetadataTypes.map((t) => (
                              <SelectItem key={t.id} value={t.namn}>{metadataDisplayName(t)}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            leaveMetadataFields: prev.leaveMetadataFields.filter((_, i) => i !== idx),
                          }))
                        }
                        data-testid={`button-remove-leave-metadata-${idx}`}
                        aria-label="Ta bort fält"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {groupParentNames.has(row.metadataField) && (
                      <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground" data-testid={`preview-leave-group-children-${idx}`}>
                        <span className="font-medium text-foreground">Grupp:</span> inkluderar {(metadataChildrenByParentName.get(row.metadataField) ?? []).join(", ") || "inga underfält ännu"} (uppdateras automatiskt när underfält läggs till).
                      </div>
                    )}
                    <Input
                      value={row.instruction}
                      onChange={(e) => patch({ instruction: e.target.value })}
                      placeholder="Instruktion till utföraren (valfritt)"
                      maxLength={240}
                      data-testid={`input-leave-metadata-instruction-${idx}`}
                    />
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(e) => patch({ required: e.target.checked })}
                        data-testid={`checkbox-leave-metadata-required-${idx}`}
                      />
                      Obligatorisk — kräv värde innan uppgiften kan slutföras
                    </label>
                  </div>
                );
              })}
            </div>
          </FormSection>

          {/* 10. Utförarkategori */}
          <FormSection title="Utförarkategori" icon={<Users className="h-4 w-4" />} testId="section-utforarkategori" {...sectionProps("utforarkategori")}>
            <div className="space-y-2">
              <Label htmlFor="performerCategory">Utförarkategori</Label>
              <Input
                id="performerCategory"
                value={formData.performerCategory}
                onChange={(e) => setFormData({ ...formData, performerCategory: e.target.value })}
                placeholder="t.ex. Chaufför, Tekniker, Besiktningsman"
                data-testid="input-performer-category"
              />
              <p className="text-xs text-muted-foreground">Vilken kategori av utförare som normalt utför artikeln.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="competencyInput">Kompetenskrav</Label>
              <div className="flex gap-2">
                <Input
                  id="competencyInput"
                  value={competencyInput}
                  onChange={(e) => setCompetencyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = competencyInput.trim();
                      if (v && !formData.competencyRequirements.includes(v)) {
                        setFormData({ ...formData, competencyRequirements: [...formData.competencyRequirements, v] });
                      }
                      setCompetencyInput("");
                    }
                  }}
                  placeholder="Lägg till kompetenskrav och tryck Enter"
                  data-testid="input-competency-requirement"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const v = competencyInput.trim();
                    if (v && !formData.competencyRequirements.includes(v)) {
                      setFormData({ ...formData, competencyRequirements: [...formData.competencyRequirements, v] });
                    }
                    setCompetencyInput("");
                  }}
                  data-testid="button-add-competency-requirement"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {formData.competencyRequirements.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {formData.competencyRequirements.map((c, i) => (
                    <Badge key={`${c}-${i}`} variant="secondary" className="gap-1" data-testid={`badge-competency-${i}`}>
                      <span className="text-xs">{c}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setFormData({
                            ...formData,
                            competencyRequirements: formData.competencyRequirements.filter((_, idx) => idx !== i),
                          })
                        }
                        className="ml-0.5 hover:text-destructive"
                        data-testid={`button-remove-competency-${i}`}
                        aria-label="Ta bort kompetenskrav"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </FormSection>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
