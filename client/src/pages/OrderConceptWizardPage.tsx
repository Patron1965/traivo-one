import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { deriveIsPreTask } from "@/lib/article-pre-task";
import { ArrowLeft, ArrowRight, Save, Check, Loader2, AlertTriangle, PlayCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  Customer, Article,
  InvoiceLevel, InvoiceModel,
  CustomerMode, TaskCategory,
} from "@shared/schema";
import { INVOICE_MODEL_TO_SCENARIO, normalizeInvoiceFrequency } from "@shared/order-concept-method";
import { computeConceptOrderValue } from "@shared/order-concept-value";
import Step1NameCustomer from "@/components/orderkoncept/Step1NameCustomer";
import Step2PriceReference from "@/components/orderkoncept/Step2PriceReference";
import Step3Invoicing from "@/components/orderkoncept/Step3Invoicing";
import Step4Inspection, { type ConditionFilter } from "@/components/orderkoncept/Step4Inspection";
import Step5DeliveryTime from "@/components/orderkoncept/Step5DeliveryTime";
import { type MainDeliveryWindow, type DeliveryRestriction, normalizeDeliveryRestrictions } from "@shared/delivery-restrictions";
import Step6Tasks, { type ConceptArticleRow } from "@/components/orderkoncept/Step6Tasks";
import Step7ReviewSave from "@/components/orderkoncept/Step7ReviewSave";
import WizardSidebar from "@/components/orderkoncept/WizardSidebar";

function deriveTaskCategory(article: Article): TaskCategory {
  if (article.articleType === "vara") return "logistics";
  if (article.articleType === "felanmalan") return "admin";
  return "field";
}

function deriveOffsetMinutes(article: Article): number | null {
  if (article.articleType === "beroende" && article.dependencyMinutesBefore) {
    return -article.dependencyMinutesBefore;
  }
  if ((article.offsetMinutes ?? 0) !== 0) return article.offsetMinutes ?? null;
  return null;
}

// Task #995: ny stegordning enligt Mats — objekt/inpekning först, kund som eget
// steg direkt efter (vald eller härledd ur objektens metadata), sedan pris,
// fakturering, leveranstid, uppgifter och granska.
const STEPS = [
  { num: 1, label: "Inpekning" },
  { num: 2, label: "Kund" },
  { num: 3, label: "Pris & Referens" },
  { num: 4, label: "Fakturering" },
  { num: 5, label: "Leveranstid" },
  { num: 6, label: "Uppgifter" },
  { num: 7, label: "Granska" },
];
const TOTAL_STEPS = STEPS.length;

const wizardFormSchema = z.object({
  conceptName: z.string().min(1, "Ange ett namn för orderkonceptet."),
  invoiceLevel: z.string().min(1, "Välj en faktureringsnivå."),
  invoiceModel: z.string().min(1, "Välj en faktureringsmodell."),
});

type WizardFormValues = z.infer<typeof wizardFormSchema>;

const stepFieldsToValidate: Partial<Record<number, (keyof WizardFormValues)[]>> = {
  4: ["invoiceLevel", "invoiceModel"],
};

// Task #995: aktuell version av wizardens stegnumrering. Bumpas vid varje omordning.
// Nya/sparade koncept stämplas med detta värde (wizardStepVersion); utkast med lägre
// version remappas old→new vid laddning.
const WIZARD_STEP_VERSION = 2;

// Gammal ordning (version 1): 1=Namn&Kund, 2=Pris&Referens, 3=Fakturering,
// 4=Inpekning, 5=Leveranstid, 6=Uppgifter, 7=Granska.
// Ny ordning (version 2): 1=Inpekning, 2=Kund, 3=Pris&Referens, 4=Fakturering,
// 5=Leveranstid, 6=Uppgifter, 7=Granska.
const STEP_REMAP_V1_TO_V2: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 1, 5: 5, 6: 6, 7: 7 };

const remapSavedStep = (savedStep: number, savedVersion: number | null | undefined): number => {
  if ((savedVersion ?? 1) >= WIZARD_STEP_VERSION) return savedStep;
  return STEP_REMAP_V1_TO_V2[savedStep] ?? 1;
};

const toDateInput = (v: unknown): string =>
  v ? new Date(v as string).toISOString().split("T")[0] : "";
const toIsoOrNull = (v: string): string | null =>
  v ? new Date(v).toISOString() : null;

// Task #978: härled legacy interval-fält + persistera hela huvudtidsfönster-arrayen.
// Endast det PRIMÄRA (första) fönstret med giltigt startdatum + frekvens (>0) driver
// jobbgenereringen; övriga fönster sparas enbart som planeringsstöd.
function buildDeliveryWindowPatch(windows: MainDeliveryWindow[]) {
  const cleaned = windows.map((w) => ({
    startDate: w.startDate || null,
    startTime: w.startTime || null,
    endDate: w.endDate || null,
    endTime: w.endTime || null,
    intervalFrequencyDays: w.intervalFrequencyDays ?? null,
    intervalFlexDays: w.intervalFlexDays ?? null,
  }));
  const primary = cleaned[0];
  const hasPrimaryInterval =
    !!primary?.startDate && primary.intervalFrequencyDays != null && primary.intervalFrequencyDays > 0;
  return {
    mainDeliveryWindows: cleaned,
    deliveryTimeType: hasPrimaryInterval ? "interval" : null,
    timeWindows: [] as unknown[],
    intervalStartDate: primary?.startDate ? toIsoOrNull(primary.startDate) : null,
    intervalEndDate: primary?.endDate ? toIsoOrNull(primary.endDate) : null,
    intervalFrequencyDays: hasPrimaryInterval ? primary!.intervalFrequencyDays : null,
    intervalFlexDays: primary?.intervalFlexDays ?? null,
  };
}

export default function OrderConceptWizardPage() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const isEditing = !!params.id;
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false);
  useUnsavedChanges(hasUnsavedWork);
  const [currentStep, setCurrentStep] = useState(1);
  const processingNextRef = useRef(false);
  const [resumeStep, setResumeStep] = useState<number | null>(null);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [conceptId, setConceptId] = useState<string | null>(params.id || null);

  const form = useForm<WizardFormValues>({
    resolver: zodResolver(wizardFormSchema),
    defaultValues: { conceptName: "", invoiceLevel: "customer", invoiceModel: "" },
    mode: "onTouched",
  });

  const conceptName = form.watch("conceptName");
  const invoiceLevel = form.watch("invoiceLevel") as InvoiceLevel | "";
  const invoiceModel = form.watch("invoiceModel") as InvoiceModel | "";

  const setConceptName = useCallback((v: string) => {
    form.setValue("conceptName", v, { shouldValidate: true, shouldDirty: true });
    setHasUnsavedWork(true);
  }, [form]);

  // Step 1
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("HARDCODED");
  const [customerMetadataField, setCustomerMetadataField] = useState<string | null>(null);
  // Step 2
  const [priceListId, setPriceListId] = useState<string | null>(null);
  const [priceModel, setPriceModel] = useState<string>("running");
  const [fixedPriceKronor, setFixedPriceKronor] = useState<string>("");
  const [fixedPriceBasis, setFixedPriceBasis] = useState<string>("per_object");
  const [customerReference, setCustomerReference] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  // Step 3
  const [invoiceLock, setInvoiceLock] = useState(false);
  const [invoiceBrake, setInvoiceBrake] = useState(false);
  const [invoiceMethod, setInvoiceMethod] = useState<string | null>(null);
  const [subscriptionAdjustmentDate, setSubscriptionAdjustmentDate] = useState("");
  const [invoiceConsolidation, setInvoiceConsolidation] = useState("customer");
  const [departmentMetadataField, setDepartmentMetadataField] = useState<string | null>(null);
  // Step 3 — abonnemang (Task #934)
  const [monthlyFee, setMonthlyFee] = useState<number | null>(null);
  // Task #1056: EN faktureringsfrekvens för hela konceptet (unifierar tidigare
  // invoicePeriod + billingFrequency). Skrivs till båda DB-kolumnerna vid spar.
  const [billingFrequency, setBillingFrequency] = useState<string>("monthly");
  const [subscriptionStartDate, setSubscriptionStartDate] = useState("");
  // Step 4
  const [targetObjectIds, setTargetObjectIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ConditionFilter[]>([]);
  // Step 5 (Task #978): huvudtidsfönster + utökade tidsrestriktioner
  const [mainDeliveryWindows, setMainDeliveryWindows] = useState<MainDeliveryWindow[]>([]);
  const [deliveryRestrictions, setDeliveryRestrictions] = useState<DeliveryRestriction[]>([]);
  // Step 6
  const [conceptArticles, setConceptArticles] = useState<ConceptArticleRow[]>([]);

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: articles = [] } = useQuery<Article[]>({ queryKey: ["/api/articles"] });

  const { data: wizardData, isLoading: wizardLoading } = useQuery({
    queryKey: ["/api/order-concepts", conceptId, "wizard"],
    queryFn: async () => {
      if (!conceptId) return null;
      const res = await fetch(`/api/order-concepts/${conceptId}/wizard`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!conceptId && isEditing,
  });

  useEffect(() => {
    if (!wizardData || !isEditing) return;
    form.setValue("conceptName", wizardData.name || "");
    setCustomerMode(wizardData.customerMode || "HARDCODED");
    setSelectedCustomerId(wizardData.customerId || null);
    setCustomerMetadataField(wizardData.customerMetadataField || null);
    // Task #995: remappa utkast sparade med gamla stegnumreringen (wizardStepVersion < 2)
    // till den nya ordningen så att t.ex. ett utkast i gamla steg 4 (Inpekning) öppnas
    // i nya steg 1 (Inpekning) — inte nya steg 4 (Fakturering).
    const rawSavedStep = Math.min(wizardData.currentStep || 1, TOTAL_STEPS);
    const savedStep = remapSavedStep(rawSavedStep, wizardData.wizardStepVersion);
    setCurrentStep(savedStep);
    if (savedStep > 1) {
      setResumeStep(savedStep);
      setShowResumeBanner(true);
    }
    // Migrera raden i DB på plats (lazy): stämpla nya versionen + remappad step så
    // efterföljande laddningar inte remappar igen.
    if ((wizardData.wizardStepVersion ?? 1) < WIZARD_STEP_VERSION && conceptId) {
      apiRequest("PATCH", `/api/order-concepts/${conceptId}`, {
        currentStep: savedStep,
        wizardStepVersion: WIZARD_STEP_VERSION,
      }).catch(() => {});
    }
    setPriceListId(wizardData.priceListId || null);
    setPriceModel(wizardData.priceModel || "running");
    setFixedPriceKronor(wizardData.fixedPriceAmount != null ? String(wizardData.fixedPriceAmount / 100) : "");
    setFixedPriceBasis((wizardData as any).fixedPriceBasis || "per_object");
    setCustomerReference(wizardData.customerReference || "");
    setCustomerLabel(wizardData.customerLabel || "");
    form.setValue("invoiceLevel", wizardData.invoiceLevel || "customer");
    form.setValue("invoiceModel", wizardData.invoiceModel || "");
    setInvoiceLock(wizardData.invoiceLock || false);
    setInvoiceBrake(wizardData.invoiceBrake || false);
    setInvoiceMethod(wizardData.invoiceMethod || null);
    setSubscriptionAdjustmentDate(toDateInput(wizardData.subscriptionAdjustmentDate));
    setInvoiceConsolidation(wizardData.invoiceConsolidation || "customer");
    setDepartmentMetadataField(wizardData.departmentMetadataField || null);
    setMonthlyFee(wizardData.monthlyFee != null ? Number(wizardData.monthlyFee) : null);
    // Unifierad frekvens: föredra billingFrequency, fall tillbaka på legacy invoicePeriod;
    // klampa legacy-värden (daily/weekly) till {monthly,quarterly,yearly}.
    setBillingFrequency(normalizeInvoiceFrequency(wizardData.billingFrequency ?? wizardData.invoicePeriod));
    setSubscriptionStartDate(toDateInput(wizardData.deliveryStart));
    setTargetObjectIds(new Set(Array.isArray(wizardData.targetObjectIds) ? wizardData.targetObjectIds : []));
    setFilters((wizardData.filters || []).map((f: any) => ({
      metadataKey: f.metadataKey, operator: f.operator, filterValue: f.filterValue,
    })));
    // Task #978: ladda huvudtidsfönster — nya mainDeliveryWindows om de finns, annars
    // syntetisera ett primärt fönster från legacy interval-fälten (back-compat).
    const rawWindows = Array.isArray(wizardData.mainDeliveryWindows) ? wizardData.mainDeliveryWindows : [];
    if (rawWindows.length > 0) {
      setMainDeliveryWindows(rawWindows.map((w: any) => ({
        startDate: toDateInput(w.startDate),
        startTime: w.startTime ?? "",
        endDate: toDateInput(w.endDate),
        endTime: w.endTime ?? "",
        intervalFrequencyDays: w.intervalFrequencyDays != null ? Number(w.intervalFrequencyDays) : null,
        intervalFlexDays: w.intervalFlexDays != null ? Number(w.intervalFlexDays) : null,
      })));
    } else if (wizardData.intervalStartDate || wizardData.intervalFrequencyDays != null) {
      setMainDeliveryWindows([{
        startDate: toDateInput(wizardData.intervalStartDate),
        startTime: "08:00",
        endDate: toDateInput(wizardData.intervalEndDate),
        endTime: "16:00",
        intervalFrequencyDays: wizardData.intervalFrequencyDays != null ? Number(wizardData.intervalFrequencyDays) : null,
        intervalFlexDays: wizardData.intervalFlexDays != null ? Number(wizardData.intervalFlexDays) : null,
      }]);
    } else {
      setMainDeliveryWindows([]);
    }
    setDeliveryRestrictions(normalizeDeliveryRestrictions(wizardData.deliveryRestrictions));
    if (wizardData.conceptArticles) setConceptArticles(wizardData.conceptArticles);
  }, [wizardData, isEditing]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // Task #1052: EN motor för "antal matchande objekt" + "ordervärde". Live-
  // förhandsvisning av inpekning + villkorsfilter (samma server-resolver som
  // /execute och Granska) driver BÅDE sidofältet och trädets dimning i steg 1.
  const targetIdsKey = useMemo(
    () => Array.from(targetObjectIds).sort(),
    [targetObjectIds],
  );
  const activeFilters = useMemo(
    () => filters.filter((f) => f.metadataKey && f.metadataKey.trim() !== ""),
    [filters],
  );
  const conditionPreviewQuery = useQuery<{
    total: number;
    rootCount: number;
    descendants: number;
    matched: number;
    matchedIds: string[];
    sample: { id: string; name: string; objectNumber: string | null; address: string | null }[];
  }>({
    queryKey: ["/api/order-concepts/condition-preview", targetIdsKey, activeFilters],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts/condition-preview", {
        objectIds: targetIdsKey,
        filters: activeFilters,
      });
      return res.json();
    },
    enabled: targetObjectIds.size > 0,
    placeholderData: keepPreviousData,
  });

  const matchedCount = targetObjectIds.size === 0
    ? 0
    : conditionPreviewQuery.data?.matched ?? 0;

  // Endast dimma trädet när ett villkorsfilter faktiskt är aktivt (annars ingår allt).
  const conditionMatchedIds = useMemo<Set<string> | null>(() => {
    if (activeFilters.length === 0) return null;
    const ids = conditionPreviewQuery.data?.matchedIds;
    return ids ? new Set(ids) : null;
  }, [activeFilters.length, conditionPreviewQuery.data]);

  // Task #1054: härledda (matchade) kunder för sidofältet. Speglar samma server-
  // resolver som steg 2:s "Förhandsvisa" (customer-preview) men körs automatiskt så
  // att sammanfattningen kan visa kundantal analogt med objektantalet — endast i
  // metadata-läge med valt fält + valda objekt.
  const customerPreviewEnabled =
    customerMode === "FROM_METADATA" && !!customerMetadataField && targetObjectIds.size > 0;
  const derivedCustomersQuery = useQuery<{
    totalObjects: number;
    resolved: { customerId: string; customerName: string; count: number }[];
  }>({
    queryKey: ["/api/order-concepts/customer-preview", targetIdsKey, activeFilters, customerMetadataField],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts/customer-preview", {
        objectIds: targetIdsKey,
        filters: activeFilters,
        customerMetadataField,
      });
      return res.json();
    },
    enabled: customerPreviewEnabled,
    placeholderData: keepPreviousData,
  });

  const derivedCustomerCount = customerPreviewEnabled
    ? derivedCustomersQuery.data?.resolved.length ?? null
    : null;

  // Kanonisk enhet = öre; konvertera till kronor först vid visning (sidofältet
  // tolkar dessa som kronor). Fast pris i state är kronor → × 100 till öre.
  const fixedPriceOre = priceModel === "fixed" && fixedPriceKronor !== ""
    ? Math.round(parseFloat(fixedPriceKronor) * 100)
    : 0;

  const valueArticleInputs = useMemo(
    () => conceptArticles.map((ca) => {
      const art = articles.find((a) => a.id === ca.articleId);
      return {
        unitPriceOre: ca.unitPrice ?? art?.listPrice ?? 0,
        quantity: ca.quantity || 1,
        costOre: art?.cost ?? 0,
        productionTimeMinutes: art?.productionTime ?? 0,
      };
    }),
    [conceptArticles, articles],
  );

  const orderValue = useMemo(
    () => computeConceptOrderValue({
      matchedCount,
      articles: valueArticleInputs,
      priceModel,
      fixedPriceAmountOre: fixedPriceOre,
      fixedPriceBasis,
    }),
    [matchedCount, valueArticleInputs, priceModel, fixedPriceOre, fixedPriceBasis],
  );

  const totalValue = orderValue.totalValueOre / 100;
  const totalCost = orderValue.totalCostOre / 100;
  const estimatedHours = orderValue.productionMinutes / 60;

  const getStepStatus = useCallback((stepNum: number): "complete" | "warning" | "future" => {
    if (stepNum >= currentStep) return "future";
    switch (stepNum) {
      case 1:
        if (!conceptName || targetObjectIds.size === 0) return "warning";
        return "complete";
      case 2:
        if (customerMode === "HARDCODED" && !selectedCustomerId) return "warning";
        if (customerMode === "FROM_METADATA" && !customerMetadataField) return "warning";
        return "complete";
      case 4:
        if (!invoiceLevel || !invoiceModel) return "warning";
        return "complete";
      case 6:
        if (conceptArticles.length === 0) return "warning";
        return "complete";
      default:
        return "complete";
    }
  }, [currentStep, conceptName, customerMode, selectedCustomerId, customerMetadataField, invoiceLevel, invoiceModel, targetObjectIds, conceptArticles]);

  const validateCurrentStep = useCallback(async (): Promise<string | null> => {
    const fields = stepFieldsToValidate[currentStep];
    if (fields) {
      const valid = await form.trigger(fields);
      if (!valid) {
        const firstError = fields.map(f => form.formState.errors[f]?.message).filter(Boolean)[0];
        if (firstError) return String(firstError);
      }
    }
    switch (currentStep) {
      case 1:
        if (!conceptName) return "Ange ett namn för orderkonceptet.";
        if (targetObjectIds.size === 0) return "Välj minst ett objekt eller en gren.";
        break;
      case 2:
        if (customerMode === "HARDCODED" && !selectedCustomerId) return "Välj en kund eller byt till metadata-läge.";
        if (customerMode === "FROM_METADATA" && !customerMetadataField) return "Välj metadatafält för kund eller byt till fast kund.";
        break;
      case 6:
        if (conceptArticles.length === 0) return "Lägg till minst en uppgift/artikel.";
        break;
    }
    return null;
  }, [currentStep, form, conceptName, customerMode, selectedCustomerId, customerMetadataField, targetObjectIds, conceptArticles]);

  const buildConceptPatch = useCallback((nextStep: number) => {
    // Task #974/#1056: kanonisera fakturastopp vid persistering oavsett legacy-värden.
    // Kundnivå => invoiceConsolidation="customer" + departmentMetadataField=null.
    // Metadatabaserad referens (= fakturastopp) => konsolideringen följer den
    // unifierade frekvensen (en frekvens för hela konceptet).
    const freqValue = normalizeInvoiceFrequency(billingFrequency);
    const isFakturastopp = invoiceConsolidation !== "customer" && invoiceConsolidation !== "per_job";
    const normalizedConsolidation = isFakturastopp ? freqValue : "customer";
    return {
    currentStep: nextStep,
    wizardStepVersion: WIZARD_STEP_VERSION,
    name: conceptName,
    customerMode,
    customerId: customerMode === "HARDCODED" ? selectedCustomerId : null,
    customerMetadataField: customerMode === "FROM_METADATA" ? (customerMetadataField || null) : null,
    priceListId: priceListId || null,
    priceModel,
    fixedPriceAmount: priceModel === "fixed" && fixedPriceKronor !== ""
      ? Math.round(parseFloat(fixedPriceKronor) * 100) : null,
    fixedPriceBasis: priceModel === "fixed" ? (fixedPriceBasis || "per_object") : null,
    customerReference: customerReference || null,
    customerLabel: customerLabel || null,
    // Task #974: fakturanivå är alltid kundnivå (samma kund). Fakturastopp delar
    // bara upp fakturan organisatoriskt via invoiceConsolidation + departmentMetadataField.
    invoiceLevel: "customer",
    invoiceModel: invoiceModel || null,
    // Task #934: write-through så att legacy-`scenario` (NOT NULL) och
    // `deliveryModel` hålls i synk med vald faktureringsmetod. Båda blir
    // `undefined` (och utelämnas av JSON.stringify) när invoiceModel saknas, så
    // att den hårdkodade scenario:"avrop" från create-steget bevaras.
    scenario: invoiceModel ? INVOICE_MODEL_TO_SCENARIO[invoiceModel] : undefined,
    deliveryModel: invoiceModel || undefined,
    // Task #1056: EN frekvens för hela konceptet skrivs till BÅDA kolumnerna
    // (invoicePeriod + billingFrequency) så att både schema-/avrops-runtime och
    // abonnemangs-runtime fortsätter läsa rätt värde (expand-contract).
    invoicePeriod: freqValue,
    billingFrequency: freqValue,
    invoiceLock,
    invoiceBrake,
    invoiceMethod: invoiceMethod || null,
    subscriptionAdjustmentDate: toIsoOrNull(subscriptionAdjustmentDate),
    // Abonnemangs-fält skrivs bara när metoden är abonnemang; annars utelämnas de
    // (undefined) så befintliga värden inte nollställs vid metodbyte.
    monthlyFee: invoiceModel === "subscription" ? (monthlyFee ?? null) : undefined,
    deliveryStart: invoiceModel === "subscription" ? toIsoOrNull(subscriptionStartDate) : undefined,
    invoiceConsolidation: normalizedConsolidation,
    departmentMetadataField: isFakturastopp ? (departmentMetadataField || null) : null,
    targetObjectIds: Array.from(targetObjectIds),
    // Task #978: spegla det primära huvudtidsfönstret till legacy interval-kolumnerna
    // (så expansionsmotorn + simuleringen fungerar oförändrat) och spara hela arrayen.
    ...buildDeliveryWindowPatch(mainDeliveryWindows),
    deliveryRestrictions,
    totalArticles: conceptArticles.length,
    totalValue,
    totalCost,
    estimatedHours,
    };
  }, [conceptName, customerMode, selectedCustomerId, customerMetadataField, priceListId, priceModel, fixedPriceKronor, customerReference, customerLabel, invoiceLevel, invoiceModel, invoiceLock, invoiceBrake, invoiceMethod, subscriptionAdjustmentDate, monthlyFee, billingFrequency, subscriptionStartDate, invoiceConsolidation, departmentMetadataField, targetObjectIds, mainDeliveryWindows, deliveryRestrictions, conceptArticles, totalValue, totalCost, estimatedHours]);

  const createConceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts", {
        name: conceptName || "Nytt orderkoncept",
        status: "draft",
        scenario: "avrop",
        scheduleType: "once",
        customerMode,
        customerId: customerMode === "HARDCODED" ? selectedCustomerId : null,
        currentStep: 1,
        wizardStepVersion: WIZARD_STEP_VERSION,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setConceptId(data.id);
      toast({ title: "Orderkoncept skapat", description: "Utkast sparat." });
    },
  });

  const saveStepMutation = useMutation({
    mutationFn: async ({ step, nextStep, overrideConceptId }: { step: number; nextStep?: number; overrideConceptId?: string }) => {
      const cId = overrideConceptId || conceptId;
      if (!cId) return;
      await apiRequest("PATCH", `/api/order-concepts/${cId}`, buildConceptPatch(nextStep ?? step));

      if (step === 1) {
        // Task #995: inpekning är nu första steget — villkorsfilter sparas här.
        // Replace-all filter set
        const existingRes = await fetch(`/api/order-concepts/${cId}/filters`);
        if (existingRes.ok) {
          const existing = await existingRes.json();
          for (const f of existing) {
            await apiRequest("DELETE", `/api/order-concepts/${cId}/filters/${f.id}`);
          }
        }
        for (const f of filters.filter(f => f.metadataKey)) {
          await apiRequest("POST", `/api/order-concepts/${cId}/filters`, {
            metadataKey: f.metadataKey,
            operator: f.operator,
            filterValue: f.filterValue ?? null,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
    },
  });

  const handleNext = useCallback(async () => {
    if (processingNextRef.current) return;
    processingNextRef.current = true;
    const validationError = await validateCurrentStep();
    if (validationError) {
      toast({ title: "Ofullständigt steg", description: validationError, variant: "destructive" });
      processingNextRef.current = false;
      return;
    }
    try {
      let activeConceptId = conceptId;
      if (!activeConceptId && currentStep === 1) {
        const created = await createConceptMutation.mutateAsync();
        if (!created?.id) throw new Error("Kunde inte skapa orderkoncept — inget id returnerades.");
        activeConceptId = created.id;
      }
      const newStep = currentStep < TOTAL_STEPS ? currentStep + 1 : currentStep;
      if (activeConceptId) {
        await saveStepMutation.mutateAsync({ step: currentStep, nextStep: newStep, overrideConceptId: activeConceptId });
      }
      if (currentStep < TOTAL_STEPS) {
        setShowResumeBanner(false);
        setCurrentStep(newStep);
        setHasUnsavedWork(false);
      }
    } catch (err: unknown) {
      toast({ title: "Kunde inte spara steget", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    } finally {
      processingNextRef.current = false;
    }
  }, [conceptId, currentStep, createConceptMutation, saveStepMutation, validateCurrentStep, toast]);

  const handleBack = useCallback(async () => {
    if (currentStep > 1) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
      setShowResumeBanner(false);
      if (conceptId) {
        try { await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { currentStep: newStep, wizardStepVersion: WIZARD_STEP_VERSION }); } catch {}
      }
    }
  }, [currentStep, conceptId]);

  const handleSaveDraft = useCallback(async () => {
    try {
      let activeId = conceptId;
      if (!activeId && conceptName) {
        const created = await createConceptMutation.mutateAsync();
        activeId = created?.id;
      }
      if (activeId) {
        await saveStepMutation.mutateAsync({ step: currentStep, overrideConceptId: activeId });
        setHasUnsavedWork(false);
        toast({ title: "Utkast sparat" });
      }
    } catch (err: unknown) {
      toast({ title: "Kunde inte spara utkast", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    }
  }, [conceptId, currentStep, conceptName, createConceptMutation, saveStepMutation, toast]);

  const toggleObject = useCallback((id: string) => {
    setTargetObjectIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setHasUnsavedWork(true);
  }, []);

  const handleAddArticle = useCallback(async (articleId: string, quantity: number, unitPrice: number | null) => {
    if (!conceptId) {
      toast({ title: "Spara konceptet först", description: "Gå framåt till nästa steg för att skapa utkastet.", variant: "destructive" });
      return;
    }
    const article = articles.find(a => a.id === articleId);
    const taskCategory = article ? deriveTaskCategory(article) : "field";
    const isPreTask = article ? deriveIsPreTask(article) : false;
    const dependencyOffsetMinutes = article ? deriveOffsetMinutes(article) : null;
    const metadataAssociation = article?.defaultMetadataAssociation || null;
    try {
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/articles`, {
        articleId, quantity, unitPrice, taskCategory,
        ...(isPreTask ? { isPreTask: true } : {}),
        ...(dependencyOffsetMinutes !== null ? { dependencyOffsetMinutes } : {}),
        ...(metadataAssociation ? { metadataAssociation } : {}),
      });
      const newArticle = await res.json();
      setConceptArticles(prev => [...prev, newArticle]);
    } catch {
      toast({ title: "Kunde inte lägga till artikel", variant: "destructive" });
    }
  }, [conceptId, articles, toast]);

  const handleRemoveArticle = useCallback(async (id: string) => {
    if (!conceptId) return;
    try {
      await apiRequest("DELETE", `/api/order-concepts/${conceptId}/articles/${id}`);
      setConceptArticles(prev => prev.filter(a => a.id !== id));
    } catch {
      toast({ title: "Kunde inte ta bort artikel", variant: "destructive" });
    }
  }, [conceptId, toast]);

  const handleUpdateQuantity = useCallback((id: string, quantity: number) => {
    setConceptArticles(prev => prev.map(a => a.id === id ? { ...a, quantity } : a));
    if (conceptId) {
      apiRequest("PATCH", `/api/order-concepts/${conceptId}/articles/${id}`, { quantity }).catch(() => {});
    }
  }, [conceptId]);

  const handleUpdateArticleField = useCallback((id: string, patch: Partial<ConceptArticleRow>) => {
    setConceptArticles(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
    if (conceptId) {
      apiRequest("PATCH", `/api/order-concepts/${conceptId}/articles/${id}`, patch).catch(() => {
        toast({ title: "Kunde inte uppdatera uppgift", variant: "destructive" });
      });
    }
  }, [conceptId, toast]);

  const persistCurrent = useCallback(async () => {
    if (!conceptId) return;
    await saveStepMutation.mutateAsync({ step: currentStep, overrideConceptId: conceptId });
  }, [conceptId, currentStep, saveStepMutation]);

  const isSaving = createConceptMutation.isPending || saveStepMutation.isPending;

  if (isEditing && wizardLoading) {
    return (
      <div className="flex flex-col h-full" data-testid="order-concept-wizard-loading">
        <div className="border-b bg-background p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-6 w-48" />
            </div>
            <Skeleton className="h-9 w-64" />
          </div>
          <div className="flex items-center justify-center gap-1">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} className="flex items-center">
                <Skeleton className="h-7 w-16 rounded" />
                {i < TOTAL_STEPS - 1 && <div className="w-4 h-px mx-0.5 bg-muted-foreground/30" />}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden p-6">
          <div className="flex-1 max-w-4xl mx-auto space-y-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="order-concept-wizard">
      <div className="border-b bg-background p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/order-concepts")} data-testid="button-back-to-list">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Tillbaka
            </Button>
            <h1 className="text-lg font-semibold">
              {isEditing ? "Redigera Orderkoncept" : "Skapa Orderkoncept"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Namn:</Label>
            <Input
              placeholder="Namnge orderkonceptet..."
              value={conceptName}
              onChange={(e) => setConceptName(e.target.value)}
              className={cn("w-64", !conceptName && currentStep === 1 && "border-chart-4/40 ring-1 ring-chart-4/40")}
              data-testid="input-concept-name"
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-1">
          {STEPS.map((step, i) => {
            const status = getStepStatus(step.num);
            return (
              <div key={step.num} className="flex items-center">
                <button
                  onClick={async () => {
                    if (!conceptId || step.num > currentStep + 1) return;
                    if (step.num > currentStep) {
                      const validationError = await validateCurrentStep();
                      if (validationError) {
                        toast({ title: "Ofullständigt steg", description: validationError, variant: "destructive" });
                        return;
                      }
                    }
                    setCurrentStep(step.num);
                    setShowResumeBanner(false);
                    try { await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { currentStep: step.num, wizardStepVersion: WIZARD_STEP_VERSION }); } catch {}
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                    currentStep === step.num
                      ? "bg-primary text-primary-foreground font-medium"
                      : status === "complete"
                        ? "bg-chart-2/15 dark:bg-chart-2/15 text-chart-2 hover:bg-chart-2/20 dark:hover:bg-chart-2/15 cursor-pointer"
                        : status === "warning"
                          ? "bg-chart-4/15 dark:bg-chart-4/15 text-chart-4 hover:bg-chart-4/20 dark:hover:bg-chart-4/15 cursor-pointer"
                          : "bg-muted text-muted-foreground",
                    !conceptId && step.num > 1 && "opacity-50 cursor-not-allowed"
                  )}
                  data-testid={`step-button-${step.num}`}
                >
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] border border-current">
                    {currentStep === step.num
                      ? step.num
                      : status === "complete"
                        ? <Check className="h-2.5 w-2.5" />
                        : status === "warning"
                          ? <AlertTriangle className="h-2.5 w-2.5 text-chart-4" />
                          : step.num}
                  </span>
                  <span className="hidden md:inline">{step.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={cn(
                    "w-4 h-px mx-0.5",
                    step.num < currentStep
                      ? status === "warning" ? "bg-chart-4/40" : "bg-chart-2/15"
                      : "bg-muted-foreground/30"
                  )} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            {showResumeBanner && resumeStep && (
              <Alert className="mb-4 border-chart-1/20 dark:border-chart-1/80 bg-chart-1/10 dark:bg-chart-1/15" data-testid="resume-banner">
                <PlayCircle className="h-4 w-4 text-chart-1" />
                <AlertDescription className="flex items-center justify-between">
                  <span className="text-chart-1">
                    Du fortsätter från steg {resumeStep} — <strong>{STEPS[resumeStep - 1]?.label}</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="text-chart-1 hover:text-chart-1 h-7" onClick={() => setShowResumeBanner(false)} data-testid="button-continue-wizard">
                      Fortsätt här
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="text-chart-1 hover:text-chart-1 h-7"
                      onClick={async () => {
                        setCurrentStep(1);
                        setShowResumeBanner(false);
                        if (conceptId) {
                          try { await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { currentStep: 1, wizardStepVersion: WIZARD_STEP_VERSION }); } catch {}
                        }
                      }}
                      data-testid="button-restart-wizard"
                    >
                      Börja om
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <h2 className="text-base font-medium mb-4">
              Steg {currentStep} av {TOTAL_STEPS} — {STEPS[currentStep - 1].label}
            </h2>

            {currentStep === 1 && (
              <Step4Inspection
                targetObjectIds={targetObjectIds}
                onToggleObject={toggleObject}
                filters={filters}
                onFiltersChange={(f) => { setFilters(f); setHasUnsavedWork(true); }}
                conditionMatchedIds={conditionMatchedIds}
                preview={conditionPreviewQuery.data ?? null}
                previewLoading={conditionPreviewQuery.isFetching}
              />
            )}

            {currentStep === 2 && (
              <Step1NameCustomer
                customers={customers}
                customerMode={customerMode}
                onCustomerModeChange={(mode) => {
                  setCustomerMode(mode);
                  if (mode === "FROM_METADATA") setSelectedCustomerId(null);
                  if (mode === "HARDCODED") setCustomerMetadataField(null);
                  setHasUnsavedWork(true);
                }}
                selectedCustomerId={selectedCustomerId}
                onSelectCustomer={(id) => { setSelectedCustomerId(id); setPriceListId(null); setHasUnsavedWork(true); }}
                customerMetadataField={customerMetadataField}
                onCustomerMetadataFieldChange={(f) => { setCustomerMetadataField(f); setHasUnsavedWork(true); }}
                targetObjectIds={targetObjectIds}
                filters={filters}
              />
            )}

            {currentStep === 3 && (
              <Step2PriceReference
                customerId={customerMode === "HARDCODED" ? selectedCustomerId : null}
                priceListId={priceListId}
                onPriceListChange={(id) => { setPriceListId(id); setHasUnsavedWork(true); }}
                priceModel={priceModel}
                onPriceModelChange={(v) => { setPriceModel(v); setHasUnsavedWork(true); }}
                fixedPriceKronor={fixedPriceKronor}
                onFixedPriceChange={(v) => { setFixedPriceKronor(v); setHasUnsavedWork(true); }}
                fixedPriceBasis={fixedPriceBasis}
                onFixedPriceBasisChange={(v) => { setFixedPriceBasis(v); setHasUnsavedWork(true); }}
              />
            )}

            {currentStep === 4 && (
              <Step3Invoicing
                conceptId={conceptId}
                invoiceModel={invoiceModel || null}
                invoiceFrequency={billingFrequency}
                invoiceLock={invoiceLock}
                invoiceBrake={invoiceBrake}
                subscriptionAdjustmentDate={subscriptionAdjustmentDate}
                invoiceConsolidation={invoiceConsolidation}
                departmentMetadataField={departmentMetadataField}
                monthlyFee={monthlyFee}
                subscriptionStartDate={subscriptionStartDate}
                customerReference={customerReference}
                customerLabel={customerLabel}
                onUpdate={(data) => {
                  if (data.invoiceModel !== undefined) form.setValue("invoiceModel", data.invoiceModel || "", { shouldValidate: true });
                  if (data.invoiceFrequency !== undefined) setBillingFrequency(data.invoiceFrequency || "monthly");
                  if (data.invoiceLock !== undefined) setInvoiceLock(data.invoiceLock);
                  if (data.invoiceBrake !== undefined) setInvoiceBrake(data.invoiceBrake);
                  if (data.subscriptionAdjustmentDate !== undefined) setSubscriptionAdjustmentDate(data.subscriptionAdjustmentDate);
                  if (data.invoiceConsolidation !== undefined) setInvoiceConsolidation(data.invoiceConsolidation);
                  if (data.departmentMetadataField !== undefined) setDepartmentMetadataField(data.departmentMetadataField);
                  if (data.monthlyFee !== undefined) setMonthlyFee(data.monthlyFee);
                  if (data.subscriptionStartDate !== undefined) setSubscriptionStartDate(data.subscriptionStartDate);
                  if (data.customerReference !== undefined) setCustomerReference(data.customerReference);
                  if (data.customerLabel !== undefined) setCustomerLabel(data.customerLabel);
                  setHasUnsavedWork(true);
                }}
              />
            )}

            {currentStep === 5 && (
              <Step5DeliveryTime
                conceptId={conceptId}
                mainDeliveryWindows={mainDeliveryWindows}
                deliveryRestrictions={deliveryRestrictions}
                onUpdate={(data) => {
                  if (data.mainDeliveryWindows !== undefined) setMainDeliveryWindows(data.mainDeliveryWindows);
                  if (data.deliveryRestrictions !== undefined) setDeliveryRestrictions(data.deliveryRestrictions);
                  setHasUnsavedWork(true);
                }}
              />
            )}

            {currentStep === 6 && (
              <Step6Tasks
                conceptArticles={conceptArticles}
                articles={articles}
                onAddArticle={handleAddArticle}
                onRemoveArticle={handleRemoveArticle}
                onUpdateQuantity={handleUpdateQuantity}
                onUpdateArticleField={handleUpdateArticleField}
              />
            )}

            {currentStep === 7 && (
              <Step7ReviewSave
                conceptId={conceptId}
                conceptName={conceptName}
                customerName={customerMode === "HARDCODED" ? selectedCustomer?.name : undefined}
                deliveryTimeType={mainDeliveryWindows.some((w) => (w.intervalFrequencyDays ?? 0) > 0) ? "interval" : ""}
                onBeforeAction={persistCurrent}
              />
            )}
          </div>
        </div>

        <div className="hidden xl:block border-l p-4 overflow-y-auto">
          <WizardSidebar
            concept={null}
            objectCount={matchedCount}
            articleCount={conceptArticles.length}
            totalValue={totalValue}
            totalCost={totalCost}
            estimatedHours={estimatedHours}
            customerName={customerMode === "HARDCODED" ? selectedCustomer?.name : undefined}
            derivedCustomerCount={derivedCustomerCount}
            derivedCustomersLoading={customerPreviewEnabled && derivedCustomersQuery.isFetching}
          />
        </div>
      </div>

      <div className="border-t bg-background p-4 flex items-center justify-between">
        <Button variant="outline" onClick={handleBack} disabled={currentStep === 1 || isSaving} data-testid="button-wizard-back">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Tillbaka
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleSaveDraft} disabled={isSaving || (!conceptId && !conceptName)} data-testid="button-save-draft">
            {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Spara utkast
          </Button>

          {currentStep < TOTAL_STEPS && (
            <Button onClick={handleNext} disabled={isSaving || (currentStep === 1 && !conceptName)} data-testid="button-wizard-next">
              {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Nästa
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
