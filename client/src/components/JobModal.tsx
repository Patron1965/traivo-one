import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarIcon, Loader2, ChevronsUpDown, Check, Package, Anchor, Users, X, MessageSquare, Receipt, Sparkles, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Customer, ServiceObject, Resource, Article, Team, TeamMember, PriceList } from "@shared/schema";
import { ARTICLE_HOOK_LEVEL_LABELS } from "@shared/schema";

interface JobModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (data: JobFormData) => void;
}

interface JobFormData {
  title: string;
  description: string;
  plannedNotes: string;
  customerId: string;
  objectId: string;
  orderType: string;
  priority: string;
  estimatedDuration: string;
  resourceId: string;
  scheduledDate: Date | undefined;
  teamResourceIds: string[];
  priceListId: string;
}

export function JobModal({ open, onClose, onSubmit }: JobModalProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<JobFormData>({
    title: "",
    description: "",
    plannedNotes: "",
    customerId: "",
    objectId: "",
    orderType: "service",
    priority: "normal",
    estimatedDuration: "60",
    resourceId: "",
    scheduledDate: undefined,
    teamResourceIds: [],
    priceListId: "",
  });
  const [objectSearch, setObjectSearch] = useState("");
  const [objectPopoverOpen, setObjectPopoverOpen] = useState(false);
  const [selectedObjectName, setSelectedObjectName] = useState("");
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [teamPopoverOpen, setTeamPopoverOpen] = useState(false);
  const [competencyWarning, setCompetencyWarning] = useState<{ hasWarning: boolean; message?: string; missingArticles?: Array<{ id: string; name: string }> } | null>(null);
  const [checkingCompetency, setCheckingCompetency] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Array<{ resourceId: string; resourceName: string; date: string; startTime: string; score: number; reasons: string[] }>>([]);
  const [loadingAiSuggestions, setLoadingAiSuggestions] = useState(false);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const debouncedSearch = useMemo(() => {
    let timeoutId: NodeJS.Timeout;
    return (value: string) => {
      clearTimeout(timeoutId);
      return new Promise<string>((resolve) => {
        timeoutId = setTimeout(() => resolve(value), 300);
      });
    };
  }, []);

  const objectSearchParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "20");
    if (objectSearch.length >= 2) {
      params.set("search", objectSearch);
    }
    if (formData.customerId) {
      params.set("customerId", formData.customerId);
    }
    return params.toString();
  }, [objectSearch, formData.customerId]);

  const { data: objectsResponse, isLoading: objectsLoading } = useQuery<{ objects: ServiceObject[], total: number }>({
    queryKey: ["/api/objects", objectSearchParams],
    queryFn: async () => {
      const res = await fetch(`/api/objects?${objectSearchParams}`);
      if (!res.ok) throw new Error("Failed to fetch objects");
      return res.json();
    },
    enabled: objectPopoverOpen && objectSearch.length >= 2,
  });

  const objects = objectsResponse?.objects || [];

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const { data: allTeamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/team-members"],
  });

  const { data: priceLists = [] } = useQuery<PriceList[]>({
    queryKey: ["/api/price-lists"],
  });

  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  const selectTeam = (teamId: string) => {
    if (!teamId || teamId === "none") {
      setSelectedTeamId("");
      setFormData(prev => ({ ...prev, teamResourceIds: [], resourceId: "" }));
      return;
    }
    setSelectedTeamId(teamId);
    const members = allTeamMembers.filter(m => m.teamId === teamId);
    const resourceIds = members.map(m => m.resourceId);
    const primaryId = resourceIds.length > 0 ? resourceIds[0] : "";
    setFormData(prev => ({ ...prev, teamResourceIds: resourceIds, resourceId: primaryId }));
  };

  const { data: applicableArticles = [], isLoading: articlesLoading } = useQuery<Article[]>({
    queryKey: ["/api/objects", formData.objectId, "applicable-articles"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${formData.objectId}/applicable-articles`);
      if (!res.ok) throw new Error("Failed to fetch applicable articles");
      return res.json();
    },
    enabled: !!formData.objectId,
  });

  const toggleArticle = (articleId: string) => {
    setSelectedArticleIds(prev => {
      const next = new Set(prev);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
      }
      return next;
    });
  };

  const createWorkOrderMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description: string;
      plannedNotes: string;
      customerId: string;
      objectId: string;
      orderType: string;
      priority: string;
      estimatedDuration: number;
      resourceId: string | null;
      scheduledDate: Date | null;
      status: string;
      articlesToAdd: Array<{ id: string; name: string; price: number | null }>;
      priceListId: string;
      metadata?: Record<string, any>;
    }) => {
      const { articlesToAdd, priceListId, ...orderData } = data;
      const response = await apiRequest("POST", "/api/work-orders", {
        ...orderData,
        plannedNotes: orderData.plannedNotes || null,
      });
      const workOrder = response as unknown as { id: string };
      
      if (articlesToAdd.length > 0 && workOrder.id) {
        for (const article of articlesToAdd) {
          const linePayload: Record<string, unknown> = {
            articleId: article.id,
            quantity: 1,
          };
          if (priceListId) {
            linePayload.priceListId = priceListId;
          }
          await apiRequest("POST", `/api/work-orders/${workOrder.id}/lines`, linePayload);
        }
      }
      
      return { workOrder, articleCount: articlesToAdd.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-order-lines"] });
      const message = result.articleCount > 0 
        ? `Arbetsordern har skapats med ${result.articleCount} fasthakade artiklar.`
        : "Arbetsordern har skapats.";
      toast({ title: "Jobb skapat", description: message });
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const toggleTeamMember = (resourceId: string) => {
    setFormData(prev => {
      const ids = prev.teamResourceIds.includes(resourceId)
        ? prev.teamResourceIds.filter(id => id !== resourceId)
        : [...prev.teamResourceIds, resourceId];
      const primaryId = ids.length > 0 ? ids[0] : "";
      return { ...prev, teamResourceIds: ids, resourceId: primaryId };
    });
  };

  const removeTeamMember = (resourceId: string) => {
    setFormData(prev => {
      const ids = prev.teamResourceIds.filter(id => id !== resourceId);
      const primaryId = ids.length > 0 ? ids[0] : "";
      return { ...prev, teamResourceIds: ids, resourceId: primaryId };
    });
  };

  const checkCompetency = async (resourceId: string, articleIds: string[]) => {
    if (!resourceId || articleIds.length === 0) {
      setCompetencyWarning(null);
      return;
    }
    setCheckingCompetency(true);
    try {
      const res = await apiRequest("POST", "/api/ai/resource-competency-check", { resourceId, articleIds });
      const data = res as unknown as { hasWarning: boolean; message?: string; missingArticles?: Array<{ id: string; name: string }> };
      setCompetencyWarning(data);
    } catch {
      setCompetencyWarning(null);
    } finally {
      setCheckingCompetency(false);
    }
  };

  const primaryResourceId = formData.teamResourceIds[0] || formData.resourceId;
  const selectedArticleArray = Array.from(selectedArticleIds);

  useEffect(() => {
    if (primaryResourceId && selectedArticleArray.length > 0) {
      checkCompetency(primaryResourceId, selectedArticleArray);
    } else {
      setCompetencyWarning(null);
    }
  }, [primaryResourceId, selectedArticleArray.join(",")]);

  const handleClose = () => {
    setFormData({
      title: "",
      description: "",
      plannedNotes: "",
      customerId: "",
      objectId: "",
      orderType: "service",
      priority: "normal",
      estimatedDuration: "60",
      resourceId: "",
      scheduledDate: undefined,
      teamResourceIds: [],
      priceListId: "",
    });
    setObjectSearch("");
    setSelectedObjectName("");
    setSelectedArticleIds(new Set());
    setTeamPopoverOpen(false);
    setSelectedTeamId("");
    setCompetencyWarning(null);
    setAiSuggestions([]);
    onClose();
  };

  const handleSubmit = () => {
    if (!formData.title || !formData.customerId || !formData.objectId) {
      toast({ title: "Fel", description: "Fyll i titel, kund och objekt.", variant: "destructive" });
      return;
    }

    const articlesToAdd = applicableArticles
      .filter(a => selectedArticleIds.has(a.id))
      .map(a => ({ id: a.id, name: a.name, price: a.listPrice }));

    const teamResourceNames = formData.teamResourceIds
      .map(id => resources.find(r => r.id === id)?.name || id);

    createWorkOrderMutation.mutate({
      title: formData.title,
      description: formData.description,
      plannedNotes: formData.plannedNotes,
      customerId: formData.customerId,
      objectId: formData.objectId,
      orderType: formData.orderType,
      priority: formData.priority,
      estimatedDuration: parseInt(formData.estimatedDuration) || 60,
      resourceId: formData.resourceId || null,
      scheduledDate: formData.scheduledDate || null,
      status: formData.resourceId && formData.scheduledDate ? "scheduled" : "draft",
      articlesToAdd,
      priceListId: formData.priceListId,
      metadata: (selectedTeamId || formData.teamResourceIds.length > 1) ? {
        teamId: selectedTeamId || undefined,
        teamName: selectedTeamId ? teams.find(t => t.id === selectedTeamId)?.name : undefined,
        teamMembers: formData.teamResourceIds.map((id, i) => ({
          resourceId: id,
          name: teamResourceNames[i],
          role: i === 0 ? "ansvarig" : "medlem",
        })),
      } : undefined,
    });

    onSubmit?.(formData);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nytt jobb</DialogTitle>
          <DialogDescription>Fyll i jobbdetaljer för att skapa ett nytt arbetsorder.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              placeholder="T.ex. Årlig service"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              data-testid="input-job-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kund</Label>
              <Select 
                value={formData.customerId} 
                onValueChange={(v) => {
                  setFormData({...formData, customerId: v, objectId: ""});
                  setSelectedObjectName("");
                  setObjectSearch("");
                }}
              >
                <SelectTrigger data-testid="select-customer">
                  <SelectValue placeholder="Välj kund" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Objekt</Label>
              <Popover open={objectPopoverOpen} onOpenChange={setObjectPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={objectPopoverOpen}
                    className="w-full justify-between font-normal"
                    data-testid="select-object"
                  >
                    {selectedObjectName || "Sök objekt..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput 
                      placeholder="Skriv för att söka..." 
                      value={objectSearch}
                      onValueChange={setObjectSearch}
                    />
                    <CommandList>
                      {objectsLoading && (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      )}
                      {!objectsLoading && objects.length === 0 && objectSearch.length >= 2 && (
                        <CommandEmpty>Inga objekt hittades</CommandEmpty>
                      )}
                      {!objectsLoading && objects.length === 0 && objectSearch.length < 2 && (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                          Skriv minst 2 tecken för att söka
                        </div>
                      )}
                      {objects.length > 0 && (
                        <CommandGroup>
                          {objects.map((obj) => (
                            <CommandItem
                              key={obj.id}
                              value={obj.id}
                              onSelect={() => {
                                setFormData({...formData, objectId: obj.id});
                                setSelectedObjectName(obj.name);
                                setObjectPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  formData.objectId === obj.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span>{obj.name}</span>
                                {obj.address && (
                                  <span className="text-xs text-muted-foreground">{obj.address}</span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Jobbtyp</Label>
              <Select 
                value={formData.orderType} 
                onValueChange={(v) => setFormData({...formData, orderType: v})}
              >
                <SelectTrigger data-testid="select-order-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">Service</SelectItem>
                  <SelectItem value="repair">Reparation</SelectItem>
                  <SelectItem value="installation">Installation</SelectItem>
                  <SelectItem value="emergency">Akut</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Prioritet</Label>
              <Select 
                value={formData.priority} 
                onValueChange={(v) => setFormData({...formData, priority: v})}
              >
                <SelectTrigger data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Låg</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Hög</SelectItem>
                  <SelectItem value="urgent">Akut</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Beräknad tid (min)</Label>
              <Input
                type="number"
                value={formData.estimatedDuration}
                onChange={(e) => setFormData({...formData, estimatedDuration: e.target.value})}
                data-testid="input-duration"
              />
            </div>

            {teams.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  Välj team
                </Label>
                <Select value={selectedTeamId || "none"} onValueChange={(v) => selectTeam(v === "none" ? "" : v)}>
                  <SelectTrigger data-testid="select-team">
                    <SelectValue placeholder="Inget team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Inget team (välj manuellt)</SelectItem>
                    {teams.filter(t => t.status === "active").map(t => {
                      const memberCount = allTeamMembers.filter(m => m.teamId === t.id).length;
                      return (
                        <SelectItem key={t.id} value={t.id}>
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color || "#3B82F6" }} />
                            {t.name} ({memberCount} pers)
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Tekniker {formData.teamResourceIds.length > 1 && <Badge variant="secondary" className="text-xs px-1.5 py-0">{formData.teamResourceIds.length} st</Badge>}
              </Label>
              <Popover open={teamPopoverOpen} onOpenChange={setTeamPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal h-auto min-h-[36px]"
                    data-testid="select-resource"
                  >
                    {formData.teamResourceIds.length === 0 ? (
                      <span className="text-muted-foreground">Välj tekniker...</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 py-0.5">
                        {formData.teamResourceIds.map((id, i) => {
                          const r = resources.find(res => res.id === id);
                          return (
                            <Badge
                              key={id}
                              variant={i === 0 ? "default" : "secondary"}
                              className="text-xs gap-1 pr-1"
                            >
                              {r?.name || id}
                              <span
                                role="button"
                                className="hover:bg-background/20 rounded-full p-0.5 cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); removeTeamMember(id); }}
                                data-testid={`button-remove-resource-${id}`}
                              >
                                <X className="h-3 w-3" />
                              </span>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[250px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Sök tekniker..." />
                    <CommandList>
                      <CommandEmpty>Inga tekniker hittades</CommandEmpty>
                      <CommandGroup>
                        {resources.map(r => (
                          <CommandItem
                            key={r.id}
                            value={r.name}
                            onSelect={() => toggleTeamMember(r.id)}
                            data-testid={`option-resource-${r.id}`}
                          >
                            <Check className={cn("mr-2 h-4 w-4", formData.teamResourceIds.includes(r.id) ? "opacity-100" : "opacity-0")} />
                            <span>{r.name}</span>
                            {formData.teamResourceIds[0] === r.id && (
                              <Badge variant="outline" className="ml-auto text-xs">Ansvarig</Badge>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {resources.length > 0 && formData.objectId && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setLoadingAiSuggestions(true);
                    setAiSuggestions([]);
                    try {
                      const today = new Date();
                      const dayOfWeek = today.getDay();
                      const monday = new Date(today);
                      monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
                      const weekStart = monday.toISOString().split("T")[0];

                      const res = await apiRequest("POST", "/api/ai/suggest-resource-for-new-order", {
                        objectId: formData.objectId,
                        articleIds: selectedArticleArray,
                        estimatedDuration: parseInt(formData.estimatedDuration) || 60,
                        priority: formData.priority,
                        weekStart,
                      });
                      const data = res as unknown as { suggestions: Array<{ resourceId: string; resourceName: string; date: string; startTime: string; score: number; reasons: string[] }> };
                      setAiSuggestions(data.suggestions || []);
                      if (!data.suggestions || data.suggestions.length === 0) {
                        toast({ title: "AI-förslag", description: "Inga lämpliga resurser hittades.", variant: "destructive" });
                      }
                    } catch {
                      toast({ title: "Fel", description: "Kunde inte hämta AI-förslag.", variant: "destructive" });
                    } finally {
                      setLoadingAiSuggestions(false);
                    }
                  }}
                  disabled={loadingAiSuggestions}
                  data-testid="button-ai-suggest"
                >
                  {loadingAiSuggestions ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  AI-förslag
                </Button>
                {aiSuggestions.length > 0 && (
                  <span className="text-xs text-muted-foreground">Top {aiSuggestions.length} förslag</span>
                )}
              </div>
              {aiSuggestions.length > 0 && (
                <div className="space-y-1.5">
                  {aiSuggestions.map((s, i) => (
                    <div
                      key={s.resourceId + s.date}
                      className={cn(
                        "flex items-center justify-between p-2 rounded-md border text-sm cursor-pointer transition-colors",
                        formData.teamResourceIds.includes(s.resourceId) ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      )}
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          resourceId: s.resourceId,
                          teamResourceIds: [s.resourceId],
                          scheduledDate: new Date(s.date),
                        }));
                        setAiSuggestions([]);
                        toast({ title: "Resurs vald", description: `${s.resourceName} tilldelad via AI-förslag.` });
                      }}
                      data-testid={`ai-suggestion-${i}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={i === 0 ? "default" : "secondary"} className="text-xs">
                            #{i + 1}
                          </Badge>
                          <span className="font-medium">{s.resourceName}</span>
                          <span className="text-muted-foreground text-xs">Poäng: {s.score}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {s.reasons.join(" · ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {competencyWarning?.hasWarning && (
            <Alert variant="destructive" data-testid="alert-competency-warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {competencyWarning.message}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Planerat datum</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start" data-testid="button-select-date">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formData.scheduledDate ? format(formData.scheduledDate, "PPP", { locale: sv }) : "Välj datum"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={formData.scheduledDate}
                  onSelect={(d) => setFormData({...formData, scheduledDate: d})}
                  locale={sv}
                />
              </PopoverContent>
            </Popover>
          </div>

          {formData.objectId && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Anchor className="h-4 w-4" />
                Fasthakade artiklar
              </Label>
              {articlesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : applicableArticles.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">
                  Inga fasthakade artiklar för detta objekt
                </div>
              ) : (
                <ScrollArea className="h-[120px] border rounded-md p-2">
                  <div className="space-y-2">
                    {applicableArticles.map((article) => (
                      <div 
                        key={article.id}
                        className="flex items-center gap-2 p-2 rounded-md hover-elevate"
                      >
                        <Checkbox
                          id={`article-${article.id}`}
                          checked={selectedArticleIds.has(article.id)}
                          onCheckedChange={() => toggleArticle(article.id)}
                          data-testid={`checkbox-article-${article.id}`}
                        />
                        <label 
                          htmlFor={`article-${article.id}`}
                          className="flex-1 flex items-center gap-2 cursor-pointer"
                        >
                          <Package className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{article.name}</span>
                          {article.hookLevel && (
                            <Badge variant="outline" className="text-xs">
                              {ARTICLE_HOOK_LEVEL_LABELS[article.hookLevel as keyof typeof ARTICLE_HOOK_LEVEL_LABELS] || article.hookLevel}
                            </Badge>
                          )}
                        </label>
                        <span className="text-sm text-muted-foreground">
                          {article.listPrice ? `${article.listPrice} kr` : "-"}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              {selectedArticleIds.size > 0 && (
                <div className="text-xs text-muted-foreground">
                  {selectedArticleIds.size} artikel(ar) valda - läggs till vid skapande
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5" />
              Prislista
            </Label>
            <Select
              value={formData.priceListId || "auto"}
              onValueChange={(v) => setFormData({...formData, priceListId: v === "auto" ? "" : v})}
            >
              <SelectTrigger data-testid="select-price-list">
                <SelectValue placeholder="Automatisk (standard)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatisk (standard)</SelectItem>
                {priceLists
                  .filter(pl => pl.status === "active" && !pl.deletedAt)
                  .map(pl => (
                    <SelectItem key={pl.id} value={pl.id}>
                      <span className="flex items-center gap-2">
                        {pl.name}
                        <Badge variant="outline" className="text-[10px] ml-1">
                          {pl.priceListType === "generell" ? "Generell" : pl.priceListType === "kundunik" ? "Kundunik" : "Rabattbrev"}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {!formData.priceListId && (
              <p className="text-xs text-muted-foreground">Pris löses automatiskt via prislisthierarkin (rabattbrev → kundunik → generell → listpris)</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="planned-notes" className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Meddelande till utförare
            </Label>
            <Textarea
              id="planned-notes"
              placeholder="Info som visas för chauffören i Traivo Go..."
              value={formData.plannedNotes}
              onChange={(e) => setFormData({...formData, plannedNotes: e.target.value})}
              rows={2}
              data-testid="input-planned-notes"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Beskrivning</Label>
            <Textarea
              id="description"
              placeholder="Beskrivning av jobbet..."
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              data-testid="input-description"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel">
            Avbryt
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={createWorkOrderMutation.isPending}
            data-testid="button-save-job"
          >
            {createWorkOrderMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Spara jobb
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
