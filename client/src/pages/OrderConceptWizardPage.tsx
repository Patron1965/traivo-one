import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Save, Check, Loader2, AlertTriangle, PlayCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  OrderConcept, Customer, Article, ServiceObject,
  InvoiceLevel, InvoiceModel, InvoicePeriod,
  DeliveryModel, DeliverySeason, DistributionChannel, DocumentType
} from "@shared/schema";

import Step1ObjectSelection from "@/components/orderkoncept/Step1ObjectSelection";
import Step2ObjectConfirmation from "@/components/orderkoncept/Step2ObjectConfirmation";
import Step3InvoiceModel from "@/components/orderkoncept/Step3InvoiceModel";
import Step4InvoiceTemplates from "@/components/orderkoncept/Step4InvoiceTemplates";
import Step5DocumentConfig from "@/components/orderkoncept/Step5DocumentConfig";
import Step6Articles from "@/components/orderkoncept/Step6Articles";
import Step7ArticleMapping from "@/components/orderkoncept/Step7ArticleMapping";
import Step8Review from "@/components/orderkoncept/Step8Review";
import Step9DeliveryModel from "@/components/orderkoncept/Step9DeliveryModel";
import WizardSidebar from "@/components/orderkoncept/WizardSidebar";

const STEPS = [
  { num: 1, label: "Objekt" },
  { num: 2, label: "Bekräfta" },
  { num: 3, label: "Faktura" },
  { num: 4, label: "Mall" },
  { num: 5, label: "Dokument" },
  { num: 6, label: "Artiklar" },
  { num: 7, label: "Koppling" },
  { num: 8, label: "Kontroll" },
  { num: 9, label: "Leverans" },
];

interface DocConfig {
  documentType: DocumentType;
  enabled: boolean;
  showPrice: boolean;
  distributionChannels: DistributionChannel[];
  recipients: string[];
}

interface ScheduleEntry {
  season: DeliverySeason;
  enabled: boolean;
  startDate?: string;
  endDate?: string;
}

export default function OrderConceptWizardPage() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const isEditing = !!params.id;
  const [currentStep, setCurrentStep] = useState(1);
  const [resumeStep, setResumeStep] = useState<number | null>(null);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [conceptId, setConceptId] = useState<string | null>(params.id || null);
  const [conceptName, setConceptName] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(new Set());
  const [invoiceLevel, setInvoiceLevel] = useState<InvoiceLevel | null>(null);
  const [invoiceModel, setInvoiceModel] = useState<InvoiceModel | null>(null);
  const [invoicePeriod, setInvoicePeriod] = useState<InvoicePeriod | null>(null);
  const [invoiceLock, setInvoiceLock] = useState(false);
  const [headerMetadata, setHeaderMetadata] = useState<string[]>([]);
  const [lineMetadata, setLineMetadata] = useState<string[]>([]);
  const [showPrices, setShowPrices] = useState(true);
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [fortnoxExportEnabled, setFortnoxExportEnabled] = useState(true);
  const [documents, setDocuments] = useState<DocConfig[]>([
    { documentType: "order_confirmation", enabled: true, showPrice: true, distributionChannels: ["email"], recipients: [] },
    { documentType: "delivery_note", enabled: true, showPrice: false, distributionChannels: ["email"], recipients: [] },
    { documentType: "invoice", enabled: true, showPrice: true, distributionChannels: ["email", "portal"], recipients: [] },
  ]);
  const [conceptArticles, setConceptArticles] = useState<any[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [deliveryModel, setDeliveryModel] = useState<DeliveryModel | null>(null);
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [minDaysBetween, setMinDaysBetween] = useState(60);
  const [rollingExtension, setRollingExtension] = useState(true);
  const [rollingMonths, setRollingMonths] = useState(12);
  const [contractLengthMonths, setContractLengthMonths] = useState(12);

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: articles = [] } = useQuery<Article[]>({ queryKey: ["/api/articles"] });
  const { data: allObjects = [] } = useQuery<ServiceObject[]>({ queryKey: ["/api/objects"] });

  const { data: wizardData } = useQuery({
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
    if (wizardData && isEditing) {
      setConceptName(wizardData.name || "");
      setSelectedCustomerId(wizardData.customerId || null);
      const savedStep = wizardData.currentStep || 1;
      setCurrentStep(savedStep);
      if (savedStep > 1) {
        setResumeStep(savedStep);
        setShowResumeBanner(true);
      }
      setInvoiceLevel(wizardData.invoiceLevel || null);
      setInvoiceModel(wizardData.invoiceModel || null);
      setInvoicePeriod(wizardData.invoicePeriod || null);
      setInvoiceLock(wizardData.invoiceLock || false);
      setDeliveryModel(wizardData.deliveryModel || null);
      if (wizardData.conceptObjects) {
        setSelectedObjectIds(new Set(wizardData.conceptObjects.map((o: any) => o.objectId)));
      }
      if (wizardData.conceptArticles) setConceptArticles(wizardData.conceptArticles);
      if (wizardData.mappings) setMappings(wizardData.mappings);
      if (wizardData.invoiceConfig) {
        setHeaderMetadata(wizardData.invoiceConfig.headerMetadata || []);
        setLineMetadata(wizardData.invoiceConfig.lineMetadata || []);
        setShowPrices(wizardData.invoiceConfig.showPrices ?? true);
        setPaymentTermsDays(wizardData.invoiceConfig.paymentTermsDays || 30);
        setFortnoxExportEnabled(wizardData.invoiceConfig.fortnoxExportEnabled ?? true);
      }
      if (wizardData.documentConfigs && wizardData.documentConfigs.length > 0) {
        setDocuments(wizardData.documentConfigs.map((d: any) => ({
          documentType: d.documentType,
          enabled: d.enabled,
          showPrice: d.showPrice,
          distributionChannels: d.distributionChannels || [],
          recipients: d.recipients || [],
        })));
      }
      if (wizardData.schedules) {
        setSchedules(wizardData.schedules.map((s: any) => ({
          season: s.season,
          enabled: s.active,
          startDate: s.startDate ? new Date(s.startDate).toISOString().split("T")[0] : undefined,
          endDate: s.endDate ? new Date(s.endDate).toISOString().split("T")[0] : undefined,
        })));
        if (wizardData.schedules[0]) {
          setMinDaysBetween(wizardData.schedules[0].minDaysBetween || 60);
          setRollingExtension(wizardData.schedules[0].rollingExtension ?? true);
          setRollingMonths(wizardData.schedules[0].rollingMonths || 12);
        }
      }
      setContractLengthMonths(wizardData.contractLengthMonths || 12);
    }
  }, [wizardData, isEditing]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  const totalValue = useMemo(() => {
    return conceptArticles.reduce((sum, ca) => {
      const art = articles.find(a => a.id === ca.articleId);
      const price = ca.unitPrice ?? art?.listPrice ?? 0;
      return sum + price * (ca.quantity || 1);
    }, 0);
  }, [conceptArticles, articles]);

  const totalCost = useMemo(() => {
    return conceptArticles.reduce((sum, ca) => {
      const art = articles.find(a => a.id === ca.articleId);
      return sum + (art?.cost || 0) * (ca.quantity || 1);
    }, 0);
  }, [conceptArticles, articles]);

  const estimatedHours = useMemo(() => {
    return conceptArticles.reduce((sum, ca) => {
      const art = articles.find(a => a.id === ca.articleId);
      return sum + ((art?.productionTime || 0) * (ca.quantity || 1)) / 60;
    }, 0);
  }, [conceptArticles, articles]);

  const getStepStatus = useCallback((stepNum: number): "complete" | "warning" | "future" => {
    if (stepNum >= currentStep) return "future";
    switch (stepNum) {
      case 1:
        if (!conceptName || selectedObjectIds.size === 0) return "warning";
        return "complete";
      case 2:
        if (selectedObjectIds.size === 0) return "warning";
        return "complete";
      case 3:
        if (!invoiceLevel || !invoiceModel) return "warning";
        return "complete";
      case 4:
        return "complete";
      case 5:
        return "complete";
      case 6:
        if (conceptArticles.length === 0) return "warning";
        return "complete";
      case 7: {
        if (conceptArticles.length > 0 && mappings.length === 0) return "warning";
        if (mappings.length > 0 && selectedObjectIds.size > 0) {
          const mappedObjectIds = new Set(mappings.map((m: any) => m.objectId));
          const hasUnmapped = Array.from(selectedObjectIds).some(id => !mappedObjectIds.has(id));
          if (hasUnmapped) return "warning";
        }
        return "complete";
      }
      case 8:
        return "complete";
      case 9:
        if (!deliveryModel) return "warning";
        return "complete";
      default:
        return "future";
    }
  }, [currentStep, conceptName, selectedObjectIds, invoiceLevel, invoiceModel, conceptArticles, mappings, deliveryModel]);

  const validateCurrentStep = useCallback((): string | null => {
    switch (currentStep) {
      case 1:
        if (!conceptName) return "Ange ett namn för orderkonceptet.";
        if (selectedObjectIds.size === 0) return "Välj minst ett objekt.";
        return null;
      case 2:
        if (selectedObjectIds.size === 0) return "Inga objekt valda. Gå tillbaka och välj objekt.";
        return null;
      case 3:
        if (!invoiceLevel) return "Välj en faktureringsnivå.";
        if (!invoiceModel) return "Välj en faktureringsmodell.";
        return null;
      case 6:
        if (conceptArticles.length === 0) return "Lägg till minst en artikel.";
        return null;
      case 7: {
        if (conceptArticles.length > 0 && mappings.length === 0) return "Koppla artiklar till objekt innan du fortsätter.";
        if (mappings.length > 0 && selectedObjectIds.size > 0) {
          const mappedObjectIds = new Set(mappings.map((m: any) => m.objectId));
          const unmappedCount = Array.from(selectedObjectIds).filter(id => !mappedObjectIds.has(id)).length;
          if (unmappedCount > 0) return `${unmappedCount} objekt saknar artikelkoppling. Alla valda objekt måste ha minst en artikel.`;
        }
        return null;
      }
      case 9:
        if (!deliveryModel) return "Välj en leveransmodell.";
        return null;
      default:
        return null;
    }
  }, [currentStep, conceptName, selectedObjectIds, invoiceLevel, invoiceModel, conceptArticles, mappings, deliveryModel]);

  const createConceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts", {
        name: conceptName || "Nytt orderkoncept",
        status: "draft",
        scenario: "avrop",
        scheduleType: "once",
        customerId: selectedCustomerId,
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
    mutationFn: async (step: number) => {
      if (!conceptId) return;
      await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, {
        currentStep: step,
        name: conceptName,
        customerId: selectedCustomerId,
        invoiceLevel,
        invoiceModel,
        invoicePeriod,
        invoiceLock,
        deliveryModel,
        contractLengthMonths: deliveryModel === "subscription" ? contractLengthMonths : undefined,
        totalObjects: selectedObjectIds.size,
        totalArticles: conceptArticles.length,
        totalValue,
        totalCost,
        estimatedHours,
      });

      if (step >= 1 && selectedObjectIds.size > 0) {
        await apiRequest("POST", `/api/order-concepts/${conceptId}/objects`, {
          objectIds: Array.from(selectedObjectIds),
        });
      }

      if (step >= 4) {
        await apiRequest("PUT", `/api/order-concepts/${conceptId}/invoice-config`, {
          headerMetadata,
          lineMetadata,
          showPrices,
          paymentTermsDays,
          fortnoxExportEnabled,
        });
      }

      if (step >= 5) {
        await apiRequest("PUT", `/api/order-concepts/${conceptId}/documents`, {
          documents: documents.map(d => ({
            documentType: d.documentType,
            enabled: d.enabled,
            showPrice: d.showPrice,
            distributionChannels: d.distributionChannels,
            recipients: d.recipients,
          })),
        });
      }

      if (step >= 9) {
        const enabledSchedules = schedules.filter(s => s.enabled).map(s => ({
          season: s.season,
          startDate: s.startDate ? new Date(s.startDate).toISOString() : undefined,
          endDate: s.endDate ? new Date(s.endDate).toISOString() : undefined,
          minDaysBetween,
          rollingExtension,
          rollingMonths,
          active: true,
        }));
        await apiRequest("PUT", `/api/order-concepts/${conceptId}/delivery`, {
          deliveryModel,
          schedules: enabledSchedules,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
    },
  });

  const handleNext = useCallback(async () => {
    const validationError = validateCurrentStep();
    if (validationError) {
      toast({ title: "Ofullständigt steg", description: validationError, variant: "destructive" });
      return;
    }

    if (!conceptId && currentStep === 1) {
      await createConceptMutation.mutateAsync();
    }

    if (conceptId) {
      await saveStepMutation.mutateAsync(currentStep);
    }

    if (currentStep < 9) {
      setShowResumeBanner(false);
      setCurrentStep(currentStep + 1);
    }
  }, [conceptId, currentStep, conceptName, createConceptMutation, saveStepMutation, validateCurrentStep]);

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
    if (!conceptId && conceptName) {
      await createConceptMutation.mutateAsync();
    }
    if (conceptId) {
      await saveStepMutation.mutateAsync(currentStep);
      toast({ title: "Utkast sparat" });
    }
  }, [conceptId, currentStep, conceptName]);

  const handleActivate = useCallback(async () => {
    if (!conceptId) return;
    await saveStepMutation.mutateAsync(9);
    await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { status: "active" });
    queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
    toast({ title: "Orderkoncept aktiverat!" });
    navigate("/order-concepts");
  }, [conceptId, navigate]);

  const toggleObject = useCallback((id: string) => {
    setSelectedObjectIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllObjects = useCallback((ids: string[], selected: boolean) => {
    setSelectedObjectIds(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const selectAllObjects = useCallback(() => {
    const allIds = allObjects.filter(o => selectedObjectIds.has(o.id)).map(o => o.id);
    setSelectedObjectIds(new Set(allIds));
  }, [allObjects, selectedObjectIds]);

  const deselectAllObjects = useCallback(() => {
    setSelectedObjectIds(new Set());
  }, []);

  const handleAddArticle = useCallback(async (articleId: string, quantity: number, unitPrice: number | null) => {
    if (!conceptId) return;
    try {
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/articles`, {
        articleId,
        quantity,
        unitPrice,
      });
      const newArticle = await res.json();
      setConceptArticles(prev => [...prev, newArticle]);
    } catch {
      toast({ title: "Kunde inte lägga till artikel", variant: "destructive" });
    }
  }, [conceptId]);

  const handleRemoveArticle = useCallback(async (id: string) => {
    if (!conceptId) return;
    try {
      await apiRequest("DELETE", `/api/order-concepts/${conceptId}/articles/${id}`);
      setConceptArticles(prev => prev.filter(a => a.id !== id));
    } catch {
      toast({ title: "Kunde inte ta bort artikel", variant: "destructive" });
    }
  }, [conceptId]);

  const handleUpdateQuantity = useCallback((id: string, quantity: number) => {
    setConceptArticles(prev => prev.map(a => a.id === id ? { ...a, quantity } : a));
  }, []);

  const refreshMappings = useCallback(async () => {
    if (!conceptId) return;
    try {
      const res = await fetch(`/api/order-concepts/${conceptId}/article-mappings`);
      if (res.ok) {
        const data = await res.json();
        setMappings(data);
      }
    } catch {}
  }, [conceptId]);

  const conceptObjectsForMapping = useMemo(() => {
    return Array.from(selectedObjectIds).map(objectId => ({
      id: objectId,
      objectId,
    }));
  }, [selectedObjectIds]);

  const isSaving = createConceptMutation.isPending || saveStepMutation.isPending;

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
              className={cn("w-64", !conceptName && currentStep === 1 && "border-orange-400 ring-1 ring-orange-400")}
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
                    if (conceptId && step.num <= (currentStep + 1)) {
                      setCurrentStep(step.num);
                      setShowResumeBanner(false);
                      try { await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { currentStep: step.num }); } catch {}
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                    currentStep === step.num
                      ? "bg-primary text-primary-foreground font-medium"
                      : status === "complete"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 cursor-pointer"
                        : status === "warning"
                          ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50 cursor-pointer"
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
                          ? <AlertTriangle className="h-2.5 w-2.5" />
                          : step.num}
                  </span>
                  <span className="hidden md:inline">{step.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={cn(
                    "w-4 h-px mx-0.5",
                    step.num < currentStep
                      ? status === "warning" ? "bg-orange-400" : "bg-green-500"
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
              <Alert className="mb-4 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30" data-testid="resume-banner">
                <PlayCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <AlertDescription className="flex items-center justify-between">
                  <span className="text-blue-800 dark:text-blue-300">
                    Du fortsätter från steg {resumeStep} — <strong>{STEPS[resumeStep - 1]?.label}</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-blue-600 hover:text-blue-800 h-7"
                      onClick={() => setShowResumeBanner(false)}
                      data-testid="button-continue-wizard"
                    >
                      Fortsätt här
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-blue-600 hover:text-blue-800 h-7"
                      onClick={async () => {
                        setCurrentStep(1);
                        setShowResumeBanner(false);
                        if (conceptId) {
                          try {
                            await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { currentStep: 1 });
                          } catch {}
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
              Steg {currentStep} av 9 — {STEPS[currentStep - 1].label}
            </h2>

            {currentStep === 1 && (
              <Step1ObjectSelection
                selectedObjectIds={selectedObjectIds}
                onToggleObject={toggleObject}
                onToggleAll={toggleAllObjects}
                selectedCustomerId={selectedCustomerId}
                onSelectCustomer={setSelectedCustomerId}
              />
            )}

            {currentStep === 2 && (
              <Step2ObjectConfirmation
                selectedObjectIds={selectedObjectIds}
                onToggleObject={toggleObject}
                onSelectAll={selectAllObjects}
                onDeselectAll={deselectAllObjects}
              />
            )}

            {currentStep === 3 && (
              <Step3InvoiceModel
                invoiceLevel={invoiceLevel}
                invoiceModel={invoiceModel}
                invoicePeriod={invoicePeriod}
                invoiceLock={invoiceLock}
                objectCount={selectedObjectIds.size}
                onUpdate={(data) => {
                  if (data.invoiceLevel !== undefined) setInvoiceLevel(data.invoiceLevel);
                  if (data.invoiceModel !== undefined) setInvoiceModel(data.invoiceModel);
                  if (data.invoicePeriod !== undefined) setInvoicePeriod(data.invoicePeriod);
                  if (data.invoiceLock !== undefined) setInvoiceLock(data.invoiceLock);
                }}
              />
            )}

            {currentStep === 4 && (
              <Step4InvoiceTemplates
                headerMetadata={headerMetadata}
                lineMetadata={lineMetadata}
                showPrices={showPrices}
                paymentTermsDays={paymentTermsDays}
                fortnoxExportEnabled={fortnoxExportEnabled}
                onUpdate={(data) => {
                  if (data.headerMetadata !== undefined) setHeaderMetadata(data.headerMetadata);
                  if (data.lineMetadata !== undefined) setLineMetadata(data.lineMetadata);
                  if (data.showPrices !== undefined) setShowPrices(data.showPrices);
                  if (data.paymentTermsDays !== undefined) setPaymentTermsDays(data.paymentTermsDays);
                  if (data.fortnoxExportEnabled !== undefined) setFortnoxExportEnabled(data.fortnoxExportEnabled);
                }}
              />
            )}

            {currentStep === 5 && (
              <Step5DocumentConfig
                documents={documents}
                onUpdate={setDocuments}
              />
            )}

            {currentStep === 6 && (
              <Step6Articles
                conceptArticles={conceptArticles}
                onAddArticle={handleAddArticle}
                onRemoveArticle={handleRemoveArticle}
                onUpdateQuantity={handleUpdateQuantity}
              />
            )}

            {currentStep === 7 && conceptId && (
              <Step7ArticleMapping
                conceptId={conceptId}
                conceptArticles={conceptArticles}
                conceptObjects={conceptObjectsForMapping}
                mappings={mappings}
                onMappingsUpdated={refreshMappings}
              />
            )}

            {currentStep === 8 && conceptId && (
              <Step8Review
                conceptId={conceptId}
                conceptName={conceptName}
                customerName={selectedCustomer?.name}
                objectCount={selectedObjectIds.size}
                articleCount={conceptArticles.length}
                totalValue={totalValue}
                totalCost={totalCost}
                estimatedHours={estimatedHours}
                invoiceLevel={invoiceLevel}
                invoiceModel={invoiceModel}
                invoicePeriod={invoicePeriod}
                deliveryModel={deliveryModel}
                mappingCount={mappings.length}
              />
            )}

            {currentStep === 9 && (
              <Step9DeliveryModel
                deliveryModel={deliveryModel}
                schedules={schedules}
                minDaysBetween={minDaysBetween}
                rollingExtension={rollingExtension}
                rollingMonths={rollingMonths}
                contractLengthMonths={contractLengthMonths}
                onUpdate={(data) => {
                  if (data.deliveryModel !== undefined) setDeliveryModel(data.deliveryModel);
                  if (data.schedules !== undefined) setSchedules(data.schedules);
                  if (data.minDaysBetween !== undefined) setMinDaysBetween(data.minDaysBetween);
                  if (data.rollingExtension !== undefined) setRollingExtension(data.rollingExtension);
                  if (data.rollingMonths !== undefined) setRollingMonths(data.rollingMonths);
                  if (data.contractLengthMonths !== undefined) setContractLengthMonths(data.contractLengthMonths);
                }}
              />
            )}
          </div>
        </div>

        <div className="hidden xl:block border-l p-4 overflow-y-auto">
          <WizardSidebar
            concept={null}
            objectCount={selectedObjectIds.size}
            articleCount={conceptArticles.length}
            totalValue={totalValue}
            totalCost={totalCost}
            estimatedHours={estimatedHours}
            customerName={selectedCustomer?.name}
          />
        </div>
      </div>

      <div className="border-t bg-background p-4 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 1 || isSaving}
          data-testid="button-wizard-back"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Tillbaka
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isSaving || (!conceptId && !conceptName)}
            data-testid="button-save-draft"
          >
            {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Spara utkast
          </Button>

          {currentStep === 9 ? (
            <Button
              onClick={handleActivate}
              disabled={isSaving}
              data-testid="button-activate"
            >
              {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              Skapa Orderkoncept
            </Button>
          ) : (
            <Button
              onClick={handleNext}
              disabled={isSaving || (currentStep === 1 && !conceptName)}
              data-testid="button-wizard-next"
            >
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
