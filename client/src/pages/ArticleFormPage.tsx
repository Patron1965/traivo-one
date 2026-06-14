import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useUpload } from "@/hooks/use-upload";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatSekFromOre } from "@/lib/format";
import type {
  Article,
  MetadataDefinition,
  ArticleTypeDefinition,
  AssociationCondition,
  Supplier,
} from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HelpTooltip } from "@/components/ui/help-tooltip";
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
} from "lucide-react";

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
  quantityMetadataField: string;
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
  markupPercent: number | null;
  chargeModel: string;
  travelTime: number | null;
  informationRequirements: InformationRequirement[];
  performerCategory: string;
  competencyRequirements: string[];
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
  quantityMode: "per_styck",
  operatorCanUpdateQuantity: false,
  freeMetadataUpdate: false,
  quantityMetadataField: "",
  quantityUnit: "",
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
  markupPercent: null,
  chargeModel: "",
  travelTime: null,
  informationRequirements: [],
  performerCategory: "",
  competencyRequirements: [],
};

function FormSection({
  title,
  icon,
  description,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover-elevate rounded-md"
            data-testid={testId}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {icon}
              {title}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4 pt-1">
          {description && <p className="mb-3 text-xs text-muted-foreground">{description}</p>}
          <div className="space-y-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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

  const { data: metadataTypes = [] } = useQuery<{ id: string; namn: string; datatyp: string }[]>({
    queryKey: ["/api/metadata/types"],
  });

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

  const { data: metadataDefinitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  const { data: metadataLabels = [] } = useQuery<{ id: string; namn: string; beteckning: string | null; datatyp: string }[]>({
    queryKey: ["/api/metadata-labels"],
    select: (data: any[]) => data.map((d: any) => ({ id: d.id, namn: d.namn, beteckning: d.beteckning, datatyp: d.datatyp })),
  });

  // Standardleverantör (sektion 3) — GET /api/suppliers.
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  // Task #834: filuppladdning för extern info (säkerhetsdatablad m.m.).
  const { uploadFile: uploadExternFile, isUploading: externFileUploading } = useUpload({
    onSuccess: (res) => {
      setFormData((prev) => ({ ...prev, externInfoFileUrl: res.objectPath }));
      toast({ title: "Fil uppladdad", description: "Den externa filen har sparats." });
    },
    onError: (err) => {
      toast({ title: "Uppladdning misslyckades", description: err.message, variant: "destructive" });
    },
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

  // Task #682: varna när en metadatareferens redan är kopplad till en annan ordertyp/artikel.
  const [metadataLinkWarnings, setMetadataLinkWarnings] = useState<{ fetch: string | null; leave: string | null }>({
    fetch: null,
    leave: null,
  });

  const checkMetadataReferenceUsage = useCallback(
    async (namn: string, which: "fetch" | "leave") => {
      if (!namn) {
        setMetadataLinkWarnings((prev) => ({ ...prev, [which]: null }));
        return;
      }
      const katalog = metadataTypes.find((t) => t.namn === namn);
      if (!katalog) {
        setMetadataLinkWarnings((prev) => ({ ...prev, [which]: null }));
        return;
      }
      try {
        const res = await fetch(`/api/metadata-link-usage/${encodeURIComponent(katalog.id)}`, { credentials: "include" });
        if (!res.ok) return;
        const usage = await res.json();
        const articleUsage = (usage.articles || []).filter((a: any) => a.id !== id);
        const parts: string[] = [];
        if (usage.orderTypes?.length) parts.push(`ordertyp(er): ${usage.orderTypes.join(", ")}`);
        if (articleUsage.length) parts.push(`artikel(ar): ${articleUsage.map((a: any) => a.name).join(", ")}`);
        setMetadataLinkWarnings((prev) => ({
          ...prev,
          [which]: parts.length
            ? `Referensen "${namn}" används redan av ${parts.join("; ")}. Risk för generiska fältkollisioner — överväg en mer specifik referens.`
            : null,
        }));
      } catch {
        // best-effort
      }
    },
    [metadataTypes, id],
  );

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
        !article.quantityMode
          ? "per_styck"
          : article.quantityMode,
      operatorCanUpdateQuantity: (article as any).operatorCanUpdateQuantity ?? false,
      freeMetadataUpdate: (article as any).freeMetadataUpdate ?? false,
      quantityMetadataField: article.quantityMetadataField || "",
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
      markupPercent: (article as any).markupPercent ?? null,
      chargeModel: (article as any).chargeModel || "",
      travelTime: (article as any).travelTime ?? null,
      informationRequirements: Array.isArray((article as any).informationRequirements)
        ? ((article as any).informationRequirements as InformationRequirement[])
        : [],
      performerCategory: (article as any).performerCategory || "",
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
    if (externFileUploading || filesUploading) {
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
    payload.competencyRequirements = formData.competencyRequirements.filter((c) => (c || "").trim() !== "");
    if (fortnoxLinkTouched) {
      payload.fortnoxArticleNumber = fortnoxArticleNumber;
    }
    if (isEditMode && id) {
      updateMutation.mutate({ id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const marginOre = (formData.listPrice || 0) - ((formData.purchasePrice || 0) + (formData.materialCost || 0));
  const marginPositive = marginOre >= 0;

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

      <form id="article-form" onSubmit={handleSubmit} className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          {/* 1. Grunddata */}
          <FormSection title="Grunddata" icon={<Package className="h-4 w-4" />} defaultOpen testId="section-grunddata">
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
          <FormSection title="Fördjupad artikelinfo" icon={<FileText className="h-4 w-4" />} testId="section-fordjupad-info">
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
              <div className="pt-1 space-y-2">
                <Label htmlFor="input-extern-info-file" className="text-sm">
                  Eller ladda upp fil (PDF, bild)
                </Label>
                {formData.externInfoFileUrl ? (
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm" data-testid="row-extern-info-file">
                    <a
                      href={formData.externInfoFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 truncate text-primary hover:underline"
                      data-testid="link-extern-info-file"
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">Öppna uppladdad fil</span>
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
                ) : (
                  <Input
                    id="input-extern-info-file"
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={externFileUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadExternFile(file);
                      e.target.value = "";
                    }}
                    data-testid="input-extern-info-file"
                  />
                )}
                {externFileUploading && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Laddar upp...
                  </p>
                )}
              </div>
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
          <FormSection title="Lager & Inköp" icon={<Warehouse className="h-4 w-4" />} testId="section-lager-inkop">
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
          <FormSection title="Pris & Ekonomi" icon={<DollarSign className="h-4 w-4" />} testId="section-pris-ekonomi">
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
              <div className="space-y-2">
                <Label htmlFor="travelTime">Restid (min)</Label>
                <Input
                  id="travelTime"
                  type="number"
                  min="0"
                  value={formData.travelTime ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setFormData({ ...formData, travelTime: raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0) });
                  }}
                  data-testid="input-travel-time"
                />
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
            <p className="text-xs text-muted-foreground">Marginal per enhet = Listpris − (Inköpspris + Materialkostnad).</p>
          </FormSection>

          {/* 5. Planeringslogik */}
          <FormSection title="Planeringslogik" icon={<CalendarClock className="h-4 w-4" />} testId="section-planeringslogik">
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
                          setFormData((prev) => ({ ...prev, offsetMinutes: computeOffsetMinutes(offsetUnit, opt.value, offsetValueInput) }));
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
          <FormSection title="Strukturartikel (BOM)" icon={<Layers className="h-4 w-4" />} testId="section-struktur">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={formData.isStructure}
                onChange={(e) => setFormData({ ...formData, isStructure: e.target.checked })}
                data-testid="checkbox-is-structure"
              />
              <span>
                <strong>Strukturartikel</strong> — artikeln består av flera underartiklar (BOM). Varje underartikel blir en
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

                {formData.quantityMode !== "per_styck" && componentDraft.some((d) => d.quantityMode === "fixed") && (
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
                              {ml.beteckning ? `${ml.beteckning} — ${ml.namn}` : ml.namn}
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
                        {ml.beteckning ? `${ml.beteckning} — ${ml.namn}` : ml.namn}
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
          <FormSection title="Antalslogik" icon={<ListChecks className="h-4 w-4" />} testId="section-antalslogik">
            <div className="space-y-2">
              <Label htmlFor="quantityMode">Kvantitetsläge</Label>
              <Select value={formData.quantityMode} onValueChange={(value) => setFormData({ ...formData, quantityMode: value })}>
                <SelectTrigger id="quantityMode" data-testid="select-quantity-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_styck">Per styck — multipliceras med objektets antal</SelectItem>
                  <SelectItem value="single_per_task">En per uppdrag (alltid 1)</SelectItem>
                  <SelectItem value="group">Grupp — fast multipel (gruppstorlek)</SelectItem>
                  <SelectItem value="matches_field">Matchar metadatafält — antal från objektets metadata</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.quantityMode === "group" && (
              <div className="space-y-2" data-testid="field-group-size">
                <Label htmlFor="groupSize" className="text-sm">
                  Gruppstorlek
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
            )}

            {formData.quantityMode === "matches_field" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="field-matches-field">
                <div className="space-y-2">
                  <Label htmlFor="quantityMetadataField" className="text-sm">
                    Metadatafält (antal)
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
                          {t.namn} ({t.datatyp})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantityUnit" className="text-sm">
                    Enhet (valfritt)
                  </Label>
                  <Input
                    id="quantityUnit"
                    value={formData.quantityUnit}
                    onChange={(e) => setFormData({ ...formData, quantityUnit: e.target.value })}
                    placeholder="t.ex. m², kg, st"
                    data-testid="input-quantity-unit"
                  />
                </div>
              </div>
            )}
            {formData.quantityMode === "matches_field" && !formData.quantityMetadataField && (
              <p className="flex items-start gap-1 text-xs text-warning" data-testid="warning-matches-field-missing">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Välj ett metadatafält — annars faller antalet tillbaka på objektets standardantal.</span>
              </p>
            )}

            <div className="space-y-3 border-t pt-3">
              <p className="text-sm font-medium">Antal-behörighet i fält</p>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.operatorCanUpdateQuantity}
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
                      <span>Inget metadatafält valt — välj kvantitetsläget "Matchar metadatafält" och ett fält.</span>
                    </p>
                  )}
                </>
              )}
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

          {/* 9. Informationsinhämtning & Metadata */}
          <FormSection
            title="Informationsinhämtning & Metadata"
            icon={<Database className="h-4 w-4" />}
            description="Koppla artikeln till metadata som hämtas/lämnas vid utförande"
            testId="section-metadata"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Hämta metadata</Label>
                <Select
                  value={formData.fetchMetadataCode || "_none"}
                  onValueChange={(v) => {
                    const next = v === "_none" ? "" : v;
                    setFormData({ ...formData, fetchMetadataCode: next });
                    checkMetadataReferenceUsage(next, "fetch");
                  }}
                >
                  <SelectTrigger data-testid="select-fetch-metadata">
                    <SelectValue placeholder="Ingen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Ingen</SelectItem>
                    {metadataTypes.map((t) => (
                      <SelectItem key={t.id} value={t.namn}>
                        {t.namn} ({t.datatyp})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Metadata som visas för utföraren vid start</p>
                {metadataLinkWarnings.fetch && (
                  <p className="flex items-start gap-1 text-xs text-warning" data-testid="warning-fetch-metadata-link">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{metadataLinkWarnings.fetch}</span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Lämna metadata</Label>
                <Select
                  value={formData.leaveMetadataCode || "_none"}
                  onValueChange={(v) => {
                    const next = v === "_none" ? "" : v;
                    setFormData({ ...formData, leaveMetadataCode: next });
                    checkMetadataReferenceUsage(next, "leave");
                  }}
                >
                  <SelectTrigger data-testid="select-leave-metadata">
                    <SelectValue placeholder="Ingen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Ingen</SelectItem>
                    {metadataTypes.map((t) => (
                      <SelectItem key={t.id} value={t.namn}>
                        {t.namn} ({t.datatyp})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Metadata som skrivs tillbaka efter utförande</p>
                {metadataLinkWarnings.leave && (
                  <p className="flex items-start gap-1 text-xs text-warning" data-testid="warning-leave-metadata-link">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{metadataLinkWarnings.leave}</span>
                  </p>
                )}
              </div>
            </div>

            {formData.leaveMetadataCode && (
              <div className="space-y-2">
                <Label>Lämna-format</Label>
                <Select value={formData.leaveMetadataFormat || "value"} onValueChange={(v) => setFormData({ ...formData, leaveMetadataFormat: v })}>
                  <SelectTrigger data-testid="select-leave-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="value">Värde (direkt input)</SelectItem>
                    <SelectItem value="timestamp">Tidsstämpel (automatisk)</SelectItem>
                    <SelectItem value="boolean_true">Flagga: Ja</SelectItem>
                    <SelectItem value="counter_increment">Räknare: +1</SelectItem>
                  </SelectContent>
                </Select>
                {(formData.leaveMetadataFormat === "value" || formData.leaveMetadataFormat === "") && (
                  <label className="flex cursor-pointer items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      checked={formData.leaveMetadataRequired}
                      onChange={(e) => setFormData({ ...formData, leaveMetadataRequired: e.target.checked })}
                      data-testid="checkbox-leave-metadata-required"
                    />
                    <span className="text-sm">Obligatorisk — kräv värde innan uppgiften kan slutföras</span>
                  </label>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Hämta etikett (visa för fältarbetare)</Label>
                <Select
                  value={formData.fetchMetadataLabel || "_none"}
                  onValueChange={(v) => setFormData({ ...formData, fetchMetadataLabel: v === "_none" ? "" : v })}
                >
                  <SelectTrigger data-testid="select-fetch-metadata-label">
                    <SelectValue placeholder="Ingen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Ingen</SelectItem>
                    {metadataLabels.map((ml) => (
                      <SelectItem key={ml.id} value={ml.beteckning || ml.namn}>
                        {ml.beteckning ? `${ml.beteckning} — ${ml.namn}` : ml.namn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Visningsformat</Label>
                <Select
                  value={formData.fetchMetadataLabelFormat || "text"}
                  onValueChange={(v) => setFormData({ ...formData, fetchMetadataLabelFormat: v })}
                  disabled={!formData.fetchMetadataLabel}
                >
                  <SelectTrigger data-testid="select-fetch-label-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Fritext</SelectItem>
                    <SelectItem value="dropdown">Dropdown</SelectItem>
                    <SelectItem value="checkbox">Checkbox</SelectItem>
                    <SelectItem value="number">Nummer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={formData.canUpdateMetadata}
                onChange={(e) => setFormData({ ...formData, canUpdateMetadata: e.target.checked })}
                data-testid="checkbox-can-update-metadata"
              />
              <span className="text-sm">Fältarbetare kan uppdatera metadata</span>
            </label>

            {formData.canUpdateMetadata && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Uppdatera etikett</Label>
                  <Select
                    value={formData.updateMetadataLabel || "_none"}
                    onValueChange={(v) => setFormData({ ...formData, updateMetadataLabel: v === "_none" ? "" : v })}
                  >
                    <SelectTrigger data-testid="select-update-metadata-label">
                      <SelectValue placeholder="Ingen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Samma som hämta-etikett</SelectItem>
                      {metadataLabels.map((ml) => (
                        <SelectItem key={ml.id} value={ml.beteckning || ml.namn}>
                          {ml.beteckning ? `${ml.beteckning} — ${ml.namn}` : ml.namn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Uppdateringsformat</Label>
                  <Select value={formData.updateMetadataFormat || "value"} onValueChange={(v) => setFormData({ ...formData, updateMetadataFormat: v })}>
                    <SelectTrigger data-testid="select-update-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="value">Värde (direkt input)</SelectItem>
                      <SelectItem value="ok_ej_ok">OK / EJ OK</SelectItem>
                      <SelectItem value="timestamp">Tidsstämpel (automatisk)</SelectItem>
                      <SelectItem value="counter_increment">Räknare: +1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {formData.canUpdateMetadata && (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.showPreviousValue}
                  onChange={(e) => setFormData({ ...formData, showPreviousValue: e.target.checked })}
                  data-testid="checkbox-show-previous-value"
                />
                <span className="text-sm">Visa föregående värde för fältarbetare</span>
              </label>
            )}

            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isInfoCarrier}
                  onChange={(e) => setFormData({ ...formData, isInfoCarrier: e.target.checked })}
                  data-testid="checkbox-is-info-carrier"
                />
                <span className="text-sm">Blindartikel (informationsbärare)</span>
              </label>
              <HelpTooltip content="Blindartiklar visas som info-kort i fältappen utan utförande-steg" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="defaultMetadataAssociation">Förvalt metadatafält (Hakar fast på)</Label>
              <Select
                value={formData.defaultMetadataAssociation || "__none__"}
                onValueChange={(v) => setFormData({ ...formData, defaultMetadataAssociation: v === "__none__" ? "" : v })}
              >
                <SelectTrigger id="defaultMetadataAssociation" data-testid="select-default-metadata-assoc">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {metadataDefinitions.map((d) => (
                    <SelectItem key={d.id} value={d.fieldKey}>
                      {d.fieldLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Föreslås automatiskt som "Hakar fast på"-koppling när artikeln läggs till i ett orderkoncept.
              </p>
            </div>

            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Informationskrav</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      informationRequirements: [...formData.informationRequirements, { type: "", required: false, metadataField: null }],
                    })
                  }
                  data-testid="button-add-information-requirement"
                >
                  <Plus className="mr-1 h-4 w-4" /> Lägg till informationskrav
                </Button>
              </div>
              {formData.informationRequirements.length === 0 && (
                <p className="text-xs text-muted-foreground">Inga informationskrav angivna.</p>
              )}
              {formData.informationRequirements.map((req, idx) => {
                const patch = (p: Partial<InformationRequirement>) =>
                  setFormData((prev) => ({
                    ...prev,
                    informationRequirements: prev.informationRequirements.map((r, i) => (i === idx ? { ...r, ...p } : r)),
                  }));
                return (
                  <div key={idx} className="space-y-2 rounded-md border p-3" data-testid={`row-information-requirement-${idx}`}>
                    <div className="flex items-center gap-2">
                      <Input
                        value={req.type}
                        onChange={(e) => patch({ type: e.target.value })}
                        placeholder="Typ av information (t.ex. foto, mätvärde)"
                        className="flex-1"
                        data-testid={`input-information-requirement-type-${idx}`}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setFormData({
                            ...formData,
                            informationRequirements: formData.informationRequirements.filter((_, i) => i !== idx),
                          })
                        }
                        data-testid={`button-remove-information-requirement-${idx}`}
                        aria-label="Ta bort informationskrav"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Select
                        value={req.metadataField || "_none"}
                        onValueChange={(v) => patch({ metadataField: v === "_none" ? null : v })}
                      >
                        <SelectTrigger className="w-64" data-testid={`select-information-requirement-field-${idx}`}>
                          <SelectValue placeholder="Metadatafält (valfritt)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Inget metadatafält</SelectItem>
                          {metadataTypes.map((t) => (
                            <SelectItem key={t.id} value={t.namn}>
                              {t.namn} ({t.datatyp})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={req.required}
                          onChange={(e) => patch({ required: e.target.checked })}
                          data-testid={`checkbox-information-requirement-required-${idx}`}
                        />
                        Obligatorisk
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </FormSection>

          {/* 10. Utförarkategori */}
          <FormSection title="Utförarkategori" icon={<Users className="h-4 w-4" />} testId="section-utforarkategori">
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
      </form>
    </div>
  );
}
