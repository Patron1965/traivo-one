import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { ArrowLeft, ArrowRight, Save, Check, Loader2, AlertTriangle, PlayCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  Customer, Article,
  InvoiceLevel, InvoiceModel, InvoicePeriod,
  CustomerMode, TaskCategory,
} from "@shared/schema";
import Step1NameCustomer from "@/components/orderkoncept/Step1NameCustomer";
import Step2PriceReference from "@/components/orderkoncept/Step2PriceReference";
import Step3Invoicing from "@/components/orderkoncept/Step3Invoicing";
import Step4Inspection, { type ConditionFilter } from "@/components/orderkoncept/Step4Inspection";
import Step5DeliveryTime, { type TimeWindow, type DeliveryRestriction } from "@/components/orderkoncept/Step5DeliveryTime";
import Step6Tasks, { type ConceptArticleRow } from "@/components/orderkoncept/Step6Tasks";
import Step7ReviewSave from "@/components/orderkoncept/Step7ReviewSave";
import WizardSidebar from "@/components/orderkoncept/WizardSidebar";

function deriveTaskCategory(article: Article): TaskCategory {
  if (article.articleType === "vara") return "logistics";
  if (article.articleType === "felanmalan") return "admin";
  return "field";
}

function deriveIsPreTask(article: Article): boolean {
  return article.articleType === "beroende" || (article.offsetMinutes ?? 0) < 0;
}

function deriveOffsetMinutes(article: Article): number | null {
  if (article.articleType === "beroende" && article.dependencyMinutesBefore) {
    return -article.dependencyMinutesBefore;
  }
  if ((article.offsetMinutes ?? 0) !== 0) return article.offsetMinutes ?? null;
  return null;
}

const STEPS = [
  { num: 1, label: "Namn & Kund" },
  { num: 2, label: "Pris & Referens" },
  { num: 3, label: "Fakturering" },
  { num: 4, label: "Inpekning" },
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
  3: ["invoiceLevel", "invoiceModel"],
};

const toDateInput = (v: unknown): string =>
  v ? new Date(v as string).toISOString().split("T")[0] : "";
const toIsoOrNull = (v: string): string | null =>
  v ? new Date(v).toISOString() : null;

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
    defaultValues: { conceptName: "", invoiceLevel: "", invoiceModel: "" },
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
  const [customerReference, setCustomerReference] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  // Step 3
  const [invoicePeriod, setInvoicePeriod] = useState<InvoicePeriod | null>(null);
  const [invoiceLock, setInvoiceLock] = useState(false);
  const [invoiceBrake, setInvoiceBrake] = useState(false);
  const [invoiceMethod, setInvoiceMethod] = useState<string | null>(null);
  const [subscriptionAdjustmentDate, setSubscriptionAdjustmentDate] = useState("");
  const [invoiceConsolidation, setInvoiceConsolidation] = useState("per_job");
  const [departmentMetadataField, setDepartmentMetadataField] = useState<string | null>(null);
  // Step 4
  const [targetClusterIds, setTargetClusterIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ConditionFilter[]>([]);
  // Step 5
  const [deliveryTimeType, setDeliveryTimeType] = useState("");
  const [timeWindows, setTimeWindows] = useState<TimeWindow[]>([]);
  const [intervalStartDate, setIntervalStartDate] = useState("");
  const [intervalEndDate, setIntervalEndDate] = useState("");
  const [intervalFrequencyDays, setIntervalFrequencyDays] = useState("");
  const [intervalFlexDays, setIntervalFlexDays] = useState("");
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
    const savedStep = Math.min(wizardData.currentStep || 1, TOTAL_STEPS);
    setCurrentStep(savedStep);
    if (savedStep > 1) {
      setResumeStep(savedStep);
      setShowResumeBanner(true);
    }
    setPriceListId(wizardData.priceListId || null);
    setPriceModel(wizardData.priceModel || "running");
    setFixedPriceKronor(wizardData.fixedPriceAmount != null ? String(wizardData.fixedPriceAmount / 100) : "");
    setCustomerReference(wizardData.customerReference || "");
    setCustomerLabel(wizardData.customerLabel || "");
    form.setValue("invoiceLevel", wizardData.invoiceLevel || "");
    form.setValue("invoiceModel", wizardData.invoiceModel || "");
    setInvoicePeriod(wizardData.invoicePeriod || null);
    setInvoiceLock(wizardData.invoiceLock || false);
    setInvoiceBrake(wizardData.invoiceBrake || false);
    setInvoiceMethod(wizardData.invoiceMethod || null);
    setSubscriptionAdjustmentDate(toDateInput(wizardData.subscriptionAdjustmentDate));
    setInvoiceConsolidation(wizardData.invoiceConsolidation || "per_job");
    setDepartmentMetadataField(wizardData.departmentMetadataField || null);
    setTargetClusterIds(new Set(Array.isArray(wizardData.targetClusterIds) ? wizardData.targetClusterIds : []));
    setFilters((wizardData.filters || []).map((f: any) => ({
      metadataKey: f.metadataKey, operator: f.operator, filterValue: f.filterValue,
    })));
    setDeliveryTimeType(wizardData.deliveryTimeType || "");
    setTimeWindows(Array.isArray(wizardData.timeWindows) ? wizardData.timeWindows : []);
    setIntervalStartDate(toDateInput(wizardData.intervalStartDate));
    setIntervalEndDate(toDateInput(wizardData.intervalEndDate));
    setIntervalFrequencyDays(wizardData.intervalFrequencyDays != null ? String(wizardData.intervalFrequencyDays) : "");
    setIntervalFlexDays(wizardData.intervalFlexDays != null ? String(wizardData.intervalFlexDays) : "");
    setDeliveryRestrictions(Array.isArray(wizardData.deliveryRestrictions) ? wizardData.deliveryRestrictions : []);
    if (wizardData.conceptArticles) setConceptArticles(wizardData.conceptArticles);
  }, [wizardData, isEditing]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  const totalValue = useMemo(() => conceptArticles.reduce((sum, ca) => {
    const art = articles.find(a => a.id === ca.articleId);
    const price = ca.unitPrice ?? art?.listPrice ?? 0;
    return sum + price * (ca.quantity || 1);
  }, 0), [conceptArticles, articles]);

  const totalCost = useMemo(() => conceptArticles.reduce((sum, ca) => {
    const art = articles.find(a => a.id === ca.articleId);
    return sum + (art?.cost || 0) * (ca.quantity || 1);
  }, 0), [conceptArticles, articles]);

  const estimatedHours = useMemo(() => conceptArticles.reduce((sum, ca) => {
    const art = articles.find(a => a.id === ca.articleId);
    return sum + ((art?.productionTime || 0) * (ca.quantity || 1)) / 60;
  }, 0), [conceptArticles, articles]);

  const getStepStatus = useCallback((stepNum: number): "complete" | "warning" | "future" => {
    if (stepNum >= currentStep) return "future";
    switch (stepNum) {
      case 1:
        if (!conceptName || (customerMode === "HARDCODED" && !selectedCustomerId)) return "warning";
        return "complete";
      case 3:
        if (!invoiceLevel || !invoiceModel) return "warning";
        return "complete";
      case 4:
        if (targetClusterIds.size === 0) return "warning";
        return "complete";
      case 6:
        if (conceptArticles.length === 0) return "warning";
        return "complete";
      default:
        return "complete";
    }
  }, [currentStep, conceptName, customerMode, selectedCustomerId, invoiceLevel, invoiceModel, targetClusterIds, conceptArticles]);

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
        if (customerMode === "HARDCODED" && !selectedCustomerId) return "Välj en kund eller byt till metadata-läge.";
        break;
      case 4:
        if (targetClusterIds.size === 0) return "Välj minst ett kluster.";
        break;
      case 6:
        if (conceptArticles.length === 0) return "Lägg till minst en uppgift/artikel.";
        break;
    }
    return null;
  }, [currentStep, form, conceptName, customerMode, selectedCustomerId, targetClusterIds, conceptArticles]);

  const buildConceptPatch = useCallback((nextStep: number) => ({
    currentStep: nextStep,
    name: conceptName,
    customerMode,
    customerId: customerMode === "HARDCODED" ? selectedCustomerId : null,
    customerMetadataField: customerMode === "FROM_METADATA" ? (customerMetadataField || null) : null,
    priceListId: priceListId || null,
    priceModel,
    fixedPriceAmount: priceModel === "fixed" && fixedPriceKronor !== ""
      ? Math.round(parseFloat(fixedPriceKronor) * 100) : null,
    customerReference: customerReference || null,
    customerLabel: customerLabel || null,
    invoiceLevel: invoiceLevel || null,
    invoiceModel: invoiceModel || null,
    invoicePeriod,
    invoiceLock,
    invoiceBrake,
    invoiceMethod: invoiceMethod || null,
    subscriptionAdjustmentDate: toIsoOrNull(subscriptionAdjustmentDate),
    invoiceConsolidation,
    departmentMetadataField: invoiceConsolidation === "department" ? (departmentMetadataField || null) : null,
    targetClusterIds: Array.from(targetClusterIds),
    deliveryTimeType: deliveryTimeType || null,
    timeWindows: deliveryTimeType === "time_window" ? timeWindows : [],
    intervalStartDate: deliveryTimeType === "interval" ? toIsoOrNull(intervalStartDate) : null,
    intervalEndDate: deliveryTimeType === "interval" ? toIsoOrNull(intervalEndDate) : null,
    intervalFrequencyDays: deliveryTimeType === "interval" && intervalFrequencyDays !== ""
      ? parseInt(intervalFrequencyDays) : null,
    intervalFlexDays: deliveryTimeType === "interval" && intervalFlexDays !== ""
      ? parseInt(intervalFlexDays) : null,
    deliveryRestrictions,
    totalArticles: conceptArticles.length,
    totalValue,
    totalCost,
    estimatedHours,
  }), [conceptName, customerMode, selectedCustomerId, customerMetadataField, priceListId, priceModel, fixedPriceKronor, customerReference, customerLabel, invoiceLevel, invoiceModel, invoicePeriod, invoiceLock, invoiceBrake, invoiceMethod, subscriptionAdjustmentDate, invoiceConsolidation, departmentMetadataField, targetClusterIds, deliveryTimeType, timeWindows, intervalStartDate, intervalEndDate, intervalFrequencyDays, intervalFlexDays, deliveryRestrictions, conceptArticles, totalValue, totalCost, estimatedHours]);

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

      if (step === 4) {
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
        try { await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { currentStep: newStep }); } catch {}
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

  const toggleCluster = useCallback((id: string) => {
    setTargetClusterIds(prev => {
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
                    try { await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { currentStep: step.num }); } catch {}
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
                          try { await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { currentStep: 1 }); } catch {}
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
              <Step1NameCustomer
                conceptName={conceptName}
                onConceptNameChange={setConceptName}
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
              />
            )}

            {currentStep === 2 && (
              <Step2PriceReference
                customerId={customerMode === "HARDCODED" ? selectedCustomerId : null}
                priceListId={priceListId}
                onPriceListChange={(id) => { setPriceListId(id); setHasUnsavedWork(true); }}
                priceModel={priceModel}
                onPriceModelChange={(v) => { setPriceModel(v); setHasUnsavedWork(true); }}
                fixedPriceKronor={fixedPriceKronor}
                onFixedPriceChange={(v) => { setFixedPriceKronor(v); setHasUnsavedWork(true); }}
                customerReference={customerReference}
                onCustomerReferenceChange={(v) => { setCustomerReference(v); setHasUnsavedWork(true); }}
                customerLabel={customerLabel}
                onCustomerLabelChange={(v) => { setCustomerLabel(v); setHasUnsavedWork(true); }}
              />
            )}

            {currentStep === 3 && (
              <Step3Invoicing
                invoiceLevel={invoiceLevel || null}
                invoiceModel={invoiceModel || null}
                invoicePeriod={invoicePeriod}
                invoiceLock={invoiceLock}
                invoiceBrake={invoiceBrake}
                invoiceMethod={invoiceMethod}
                subscriptionAdjustmentDate={subscriptionAdjustmentDate}
                invoiceConsolidation={invoiceConsolidation}
                departmentMetadataField={departmentMetadataField}
                objectCount={targetClusterIds.size}
                onUpdate={(data) => {
                  if (data.invoiceLevel !== undefined) form.setValue("invoiceLevel", data.invoiceLevel || "", { shouldValidate: true });
                  if (data.invoiceModel !== undefined) form.setValue("invoiceModel", data.invoiceModel || "", { shouldValidate: true });
                  if (data.invoicePeriod !== undefined) setInvoicePeriod(data.invoicePeriod);
                  if (data.invoiceLock !== undefined) setInvoiceLock(data.invoiceLock);
                  if (data.invoiceBrake !== undefined) setInvoiceBrake(data.invoiceBrake);
                  if (data.invoiceMethod !== undefined) setInvoiceMethod(data.invoiceMethod);
                  if (data.subscriptionAdjustmentDate !== undefined) setSubscriptionAdjustmentDate(data.subscriptionAdjustmentDate);
                  if (data.invoiceConsolidation !== undefined) setInvoiceConsolidation(data.invoiceConsolidation);
                  if (data.departmentMetadataField !== undefined) setDepartmentMetadataField(data.departmentMetadataField);
                  setHasUnsavedWork(true);
                }}
              />
            )}

            {currentStep === 4 && (
              <Step4Inspection
                targetClusterIds={targetClusterIds}
                onToggleCluster={toggleCluster}
                filters={filters}
                onFiltersChange={(f) => { setFilters(f); setHasUnsavedWork(true); }}
              />
            )}

            {currentStep === 5 && (
              <Step5DeliveryTime
                conceptId={conceptId}
                deliveryTimeType={deliveryTimeType}
                timeWindows={timeWindows}
                intervalStartDate={intervalStartDate}
                intervalEndDate={intervalEndDate}
                intervalFrequencyDays={intervalFrequencyDays}
                intervalFlexDays={intervalFlexDays}
                deliveryRestrictions={deliveryRestrictions}
                onUpdate={(data) => {
                  if (data.deliveryTimeType !== undefined) setDeliveryTimeType(data.deliveryTimeType);
                  if (data.timeWindows !== undefined) setTimeWindows(data.timeWindows);
                  if (data.intervalStartDate !== undefined) setIntervalStartDate(data.intervalStartDate);
                  if (data.intervalEndDate !== undefined) setIntervalEndDate(data.intervalEndDate);
                  if (data.intervalFrequencyDays !== undefined) setIntervalFrequencyDays(data.intervalFrequencyDays);
                  if (data.intervalFlexDays !== undefined) setIntervalFlexDays(data.intervalFlexDays);
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
                deliveryTimeType={deliveryTimeType}
                onBeforeAction={persistCurrent}
              />
            )}
          </div>
        </div>

        <div className="hidden xl:block border-l p-4 overflow-y-auto">
          <WizardSidebar
            concept={null}
            objectCount={targetClusterIds.size}
            articleCount={conceptArticles.length}
            totalValue={totalValue}
            totalCost={totalCost}
            estimatedHours={estimatedHours}
            customerName={customerMode === "HARDCODED" ? selectedCustomer?.name : undefined}
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
