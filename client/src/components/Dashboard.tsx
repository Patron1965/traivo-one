import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Clock, TrendingUp, Users, Briefcase, AlertCircle, Lightbulb, 
  ArrowUpRight, ArrowDownRight, Loader2, MapPin, Building2, AlertTriangle,
  ChevronRight, Calendar, CircleDollarSign, Package, Target, FileText,
  Sparkles, Brain, Route, Zap, MessageSquare, BarChart3, Cpu, Shield, Download,
  TrendingDown, Equal, AreaChart as AreaChartIcon
} from "lucide-react";
import { AICard } from "@/components/AICard";
import { Link, useLocation } from "wouter";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Tooltip as RechartsTooltip, Legend, PieChart, Pie, Cell,
  Area, ComposedChart
} from "recharts";
import { format, subDays, startOfDay, isBefore, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { sv } from "date-fns/locale";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Resource, ServiceObject, SetupTimeLog, Customer, WorkOrderWithObject } from "@shared/schema";

export function Dashboard() {
  const [, navigate] = useLocation();

  const handlePieClick = useCallback((_data: unknown, _index: number) => {
    navigate("/order-stock");
  }, [navigate]);

  const handleBarClick = useCallback((_data: unknown) => {
    navigate("/order-stock");
  }, [navigate]);

  const handleCustomerClick = useCallback((_customerId: string) => {
    navigate("/order-stock");
  }, [navigate]);

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: setupLogs = [], isLoading: setupLogsLoading } = useQuery<SetupTimeLog[]>({
    queryKey: ["/api/setup-logs"],
  });

  // Endast hämta objekt som refereras i setupLogs och workOrders (för analys)
  const objectIdsNeeded = useMemo(() => {
    const ids = new Set<string>();
    setupLogs.forEach(log => { if (log.objectId) ids.add(log.objectId); });
    workOrders.forEach(wo => { if (wo.objectId) ids.add(wo.objectId); });
    return Array.from(ids);
  }, [setupLogs, workOrders]);

  const { data: objects = [] } = useObjectsByIds(objectIdsNeeded);
  
  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers]);

  const completedJobs = workOrders.filter(wo => wo.orderStatus === "utford" || wo.orderStatus === "fakturerad").length;
  const totalJobs = workOrders.length;
  const plannedHours = workOrders.reduce((sum, wo) => sum + (wo.estimatedDuration || 0), 0) / 60;
  const actualHours = workOrders.filter(wo => wo.actualDuration).reduce((sum, wo) => sum + (wo.actualDuration || 0), 0) / 60;
  
  const totalSetupTime = setupLogs.reduce((sum, log) => sum + (log.durationMinutes || 0), 0);
  const avgSetupTime = setupLogs.length > 0 ? Math.round(totalSetupTime / setupLogs.length) : 0;

  // Order value KPIs
  const totalOrderValue = workOrders.reduce((sum, wo) => sum + (wo.cachedValue || 0), 0);
  const totalOrderCost = workOrders.reduce((sum, wo) => sum + (wo.cachedCost || 0), 0);
  const totalMargin = totalOrderValue - totalOrderCost;
  const marginPercent = totalOrderValue > 0 ? Math.round((totalMargin / totalOrderValue) * 100) : 0;
  const avgOrderValue = totalJobs > 0 ? Math.round(totalOrderValue / totalJobs) : 0;

  // Order status distribution
  const orderStatusDistribution = useMemo(() => {
    const statusLabels: Record<string, string> = {
      skapad: "Skapad",
      planerad_pre: "Preliminär",
      planerad_resurs: "Resurs tilldelad",
      planerad_las: "Låst",
      utford: "Utförd",
      fakturerad: "Fakturerad",
      omojlig: "Omöjlig"
    };
    const statusCounts: Record<string, number> = {};
    workOrders.forEach(wo => {
      const status = wo.orderStatus || 'skapad';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    return Object.entries(statusCounts).map(([status, count]) => ({
      name: statusLabels[status] || status,
      value: count,
      status
    }));
  }, [workOrders]);

  // Top customers by order value
  const topCustomersByValue = useMemo(() => {
    const customerValues = new Map<string, { value: number; count: number }>();
    workOrders.forEach(wo => {
      if (!wo.customerId) return;
      const existing = customerValues.get(wo.customerId) || { value: 0, count: 0 };
      customerValues.set(wo.customerId, {
        value: existing.value + (wo.cachedValue || 0),
        count: existing.count + 1
      });
    });
    return Array.from(customerValues.entries())
      .map(([customerId, data]) => ({
        customerId,
        name: customerMap.get(customerId) || "Okänd kund",
        value: data.value,
        count: data.count
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [workOrders, customerMap]);

  const STATUS_COLORS_CHART = [
    "hsl(var(--muted-foreground))",
    "hsl(210 70% 50%)",
    "hsl(240 70% 50%)",
    "hsl(30 90% 50%)",
    "hsl(140 70% 45%)",
    "hsl(280 70% 50%)",
    "hsl(15 90% 50%)"  // Orange-röd för omöjliga ordrar
  ];

  // Ställtidstrend - senaste 14 dagarna
  const setupTimeTrend = useMemo(() => {
    const today = startOfDay(new Date());
    const days: { date: string; label: string; avgSetupTime: number; count: number }[] = [];
    
    for (let i = 13; i >= 0; i--) {
      const day = subDays(today, i);
      const dayStr = format(day, "yyyy-MM-dd");
      const dayLogs = setupLogs.filter(log => {
        if (!log.createdAt) return false;
        const logDate = format(new Date(log.createdAt), "yyyy-MM-dd");
        return logDate === dayStr;
      });
      
      const total = dayLogs.reduce((sum, log) => sum + (log.durationMinutes || 0), 0);
      const avg = dayLogs.length > 0 ? Math.round(total / dayLogs.length) : 0;
      
      days.push({
        date: dayStr,
        label: format(day, "d MMM", { locale: sv }),
        avgSetupTime: avg,
        count: dayLogs.length,
      });
    }
    
    return days;
  }, [setupLogs]);

  // Top 5 objekt med högst ställtid
  const topSetupTimeObjects = useMemo(() => {
    const objectSetupTimes = new Map<string, { total: number; count: number }>();
    
    setupLogs.forEach(log => {
      if (!log.objectId) return;
      const existing = objectSetupTimes.get(log.objectId) || { total: 0, count: 0 };
      objectSetupTimes.set(log.objectId, {
        total: existing.total + (log.durationMinutes || 0),
        count: existing.count + 1,
      });
    });
    
    return Array.from(objectSetupTimes.entries())
      .map(([objectId, data]) => {
        const obj = objectMap.get(objectId);
        return {
          objectId,
          name: obj?.name || "Okänt objekt",
          address: obj?.address || "",
          customerId: obj?.customerId,
          customerName: obj?.customerId ? customerMap.get(obj.customerId) : undefined,
          totalMinutes: data.total,
          avgMinutes: Math.round(data.total / data.count),
          count: data.count,
        };
      })
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .slice(0, 5);
  }, [setupLogs, objectMap, customerMap]);

  // Planerat vs faktiskt per dag (senaste 7 dagarna)
  const plannedVsActual = useMemo(() => {
    const today = startOfDay(new Date());
    const days: { date: string; label: string; planned: number; actual: number; setupTime: number }[] = [];
    
    for (let i = 6; i >= 0; i--) {
      const day = subDays(today, i);
      const dayStr = format(day, "yyyy-MM-dd");
      
      const dayJobs = workOrders.filter(wo => {
        if (!wo.scheduledDate) return false;
        const jobDate = format(new Date(wo.scheduledDate), "yyyy-MM-dd");
        return jobDate === dayStr;
      });
      
      const planned = dayJobs.reduce((sum, wo) => sum + (wo.estimatedDuration || 0), 0) / 60;
      const actual = dayJobs.reduce((sum, wo) => sum + (wo.actualDuration || 0), 0) / 60;
      
      const daySetupLogs = setupLogs.filter(log => {
        if (!log.createdAt) return false;
        const logDate = format(new Date(log.createdAt), "yyyy-MM-dd");
        return logDate === dayStr;
      });
      const setupTime = daySetupLogs.reduce((sum, log) => sum + (log.durationMinutes || 0), 0) / 60;
      
      days.push({
        date: dayStr,
        label: format(day, "EEE", { locale: sv }),
        planned: Math.round(planned * 10) / 10,
        actual: Math.round(actual * 10) / 10,
        setupTime: Math.round(setupTime * 10) / 10,
      });
    }
    
    return days;
  }, [workOrders, setupLogs]);

  // Ekonomitrend - senaste 30 dagarna
  const economicTrend = useMemo(() => {
    const today = startOfDay(new Date());
    const days: { date: string; label: string; value: number; cost: number; margin: number; orders: number }[] = [];
    
    for (let i = 29; i >= 0; i--) {
      const day = subDays(today, i);
      const dayStr = format(day, "yyyy-MM-dd");
      
      const dayOrders = workOrders.filter(wo => {
        if (!wo.scheduledDate) return false;
        const orderDate = format(new Date(wo.scheduledDate), "yyyy-MM-dd");
        return orderDate === dayStr;
      });
      
      const value = dayOrders.reduce((sum, wo) => sum + (wo.cachedValue || 0), 0);
      const cost = dayOrders.reduce((sum, wo) => sum + (wo.cachedCost || 0), 0);
      const margin = value - cost;
      
      days.push({
        date: dayStr,
        label: format(day, "d/M", { locale: sv }),
        value: Math.round(value / 1000),
        cost: Math.round(cost / 1000),
        margin: Math.round(margin / 1000),
        orders: dayOrders.length,
      });
    }
    
    return days;
  }, [workOrders]);

  // Veckojämförelse - denna vecka vs förra veckan
  const weekComparison = useMemo(() => {
    const today = new Date();
    const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const thisWeekEnd = endOfWeek(today, { weekStartsOn: 1 });
    const lastWeekStart = subWeeks(thisWeekStart, 1);
    const lastWeekEnd = subWeeks(thisWeekEnd, 1);
    
    const thisWeekOrders = workOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      const d = new Date(wo.scheduledDate);
      return d >= thisWeekStart && d <= thisWeekEnd;
    });
    
    const lastWeekOrders = workOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      const d = new Date(wo.scheduledDate);
      return d >= lastWeekStart && d <= lastWeekEnd;
    });
    
    const thisWeekSetupLogs = setupLogs.filter(log => {
      if (!log.createdAt) return false;
      const d = new Date(log.createdAt);
      return d >= thisWeekStart && d <= thisWeekEnd;
    });
    
    const lastWeekSetupLogs = setupLogs.filter(log => {
      if (!log.createdAt) return false;
      const d = new Date(log.createdAt);
      return d >= lastWeekStart && d <= lastWeekEnd;
    });
    
    const calcWeekStats = (orders: typeof workOrders, logs: typeof setupLogs) => ({
      orders: orders.length,
      completed: orders.filter(o => o.orderStatus === "utford" || o.orderStatus === "fakturerad").length,
      value: orders.reduce((sum, o) => sum + (o.cachedValue || 0), 0),
      cost: orders.reduce((sum, o) => sum + (o.cachedCost || 0), 0),
      setupTime: logs.reduce((sum, l) => sum + (l.durationMinutes || 0), 0),
      plannedHours: orders.reduce((sum, o) => sum + (o.estimatedDuration || 0), 0) / 60,
      actualHours: orders.reduce((sum, o) => sum + (o.actualDuration || 0), 0) / 60,
    });
    
    const thisWeek = calcWeekStats(thisWeekOrders, thisWeekSetupLogs);
    const lastWeek = calcWeekStats(lastWeekOrders, lastWeekSetupLogs);
    
    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };
    
    return {
      thisWeek,
      lastWeek,
      changes: {
        orders: calcChange(thisWeek.orders, lastWeek.orders),
        completed: calcChange(thisWeek.completed, lastWeek.completed),
        value: calcChange(thisWeek.value, lastWeek.value),
        setupTime: calcChange(thisWeek.setupTime, lastWeek.setupTime),
      },
    };
  }, [workOrders, setupLogs]);

  // SLA-risker - jobb med hög ställtid eller förseningar
  const slaRisks = useMemo(() => {
    const today = new Date();
    const risks: { 
      type: "overdue" | "high_setup" | "upcoming"; 
      workOrder: WorkOrderWithObject; 
      reason: string;
    }[] = [];
    
    workOrders.forEach(wo => {
      const obj = wo.objectId ? objectMap.get(wo.objectId) : undefined;
      
      // Försenade jobb (ej utförd, fakturerad eller omöjlig)
      const isCompleted = wo.orderStatus === "utford" || wo.orderStatus === "fakturerad" || wo.orderStatus === "omojlig";
      if (!isCompleted && wo.scheduledDate) {
        const scheduled = new Date(wo.scheduledDate);
        if (isBefore(scheduled, today)) {
          risks.push({
            type: "overdue",
            workOrder: wo,
            reason: `Försenad sedan ${format(scheduled, "d MMM", { locale: sv })}`,
          });
        }
      }
      
      // Jobb med objekt som har hög ställtid
      if (obj && (obj.avgSetupTime || 0) > 20 && !isCompleted) {
        risks.push({
          type: "high_setup",
          workOrder: wo,
          reason: `Hög ställtid (${obj.avgSetupTime} min)`,
        });
      }
    });
    
    return risks.slice(0, 5);
  }, [workOrders, objectMap]);

  const resourceUtilization = resources.map(r => {
    const resourceJobs = workOrders.filter(wo => wo.resourceId === r.id);
    const hoursPlanned = resourceJobs.reduce((sum, wo) => sum + (wo.estimatedDuration || 0), 0) / 60;
    return {
      id: r.id,
      name: r.name.split(" ").map(n => n[0] + ".").join(" ").slice(0, -1),
      fullName: r.name,
      planned: r.weeklyHours || 40,
      actual: hoursPlanned,
      utilization: (r.weeklyHours && r.weeklyHours > 0) ? Math.round((hoursPlanned / r.weeklyHours) * 100) : 0,
    };
  });

  const categoryLabels: Record<string, string> = {
    gate_access: "Grindåtkomst",
    parking: "Parkering",
    waiting_customer: "Väntan på kund",
    key_issue: "Nyckelhämtning",
    other: "Övrigt",
  };

  const categoryMinutes = setupLogs.reduce((acc, log) => {
    const cat = log.category || "other";
    acc[cat] = (acc[cat] || 0) + (log.durationMinutes || 0);
    return acc;
  }, {} as Record<string, number>);

  const setupTimeBreakdown = Object.entries(categoryMinutes)
    .map(([category, minutes]) => ({
      reason: categoryLabels[category] || category,
      minutes,
      percentage: totalSetupTime > 0 ? Math.round((minutes / totalSetupTime) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  if (setupTimeBreakdown.length === 0) {
    setupTimeBreakdown.push(
      { reason: "Grindåtkomst", minutes: 0, percentage: 0 },
      { reason: "Parkering", minutes: 0, percentage: 0 },
      { reason: "Väntan på kund", minutes: 0, percentage: 0 },
      { reason: "Nyckelhämtning", minutes: 0, percentage: 0 },
      { reason: "Övrigt", minutes: 0, percentage: 0 },
    );
  }

  const highSetupObjects = objects.filter(o => (o.avgSetupTime || 0) > 20);
  
  const insights = useMemo(() => {
    const result: { type: "suggestion" | "warning" | "success"; message: string; link?: string }[] = [];
    
    // Beräkna trenden
    const recentDays = setupTimeTrend.slice(-7);
    const olderDays = setupTimeTrend.slice(0, 7);
    const recentAvg = recentDays.reduce((sum, d) => sum + d.avgSetupTime, 0) / recentDays.filter(d => d.count > 0).length || 0;
    const olderAvg = olderDays.reduce((sum, d) => sum + d.avgSetupTime, 0) / olderDays.filter(d => d.count > 0).length || 0;
    
    if (recentAvg < olderAvg && olderAvg > 0) {
      const improvement = Math.round(((olderAvg - recentAvg) / olderAvg) * 100);
      result.push({
        type: "success",
        message: `Ställtiden har minskat med ${improvement}% senaste veckan.`,
      });
    } else if (recentAvg > olderAvg && recentAvg > 0) {
      result.push({
        type: "warning",
        message: `Ställtiden har ökat senaste veckan. Kontrollera objekten med högst ställtid.`,
        link: "/objects",
      });
    }
    
    if (highSetupObjects.length > 0) {
      result.push({
        type: "warning",
        message: `${highSetupObjects.length} objekt med hög ställtid (>20 min) - uppdatera åtkomstinfo.`,
        link: "/objects",
      });
    }
    
    if (slaRisks.filter(r => r.type === "overdue").length > 0) {
      result.push({
        type: "warning",
        message: `${slaRisks.filter(r => r.type === "overdue").length} försenade jobb kräver uppmärksamhet.`,
        link: "/week-planner",
      });
    }
    
    result.push({
      type: "suggestion",
      message: "Samla nordliga jobb på måndag för att spara körtid.",
    });
    
    return result.slice(0, 3);
  }, [setupTimeTrend, highSetupObjects, slaRisks]);

  const insightIcons = {
    suggestion: Lightbulb,
    warning: AlertCircle,
    success: TrendingUp,
  };

  const insightColors = {
    suggestion: "bg-blue-50 dark:bg-blue-950",
    warning: "bg-orange-50 dark:bg-orange-950",
    success: "bg-green-50 dark:bg-green-950",
  };

  const insightIconColors = {
    suggestion: "text-blue-500",
    warning: "text-orange-500",
    success: "text-green-500",
  };

  const { toast } = useToast();

  const handleExportPDF = useCallback(() => {
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      let yPos = margin;

      const addHeader = (title: string) => {
        doc.setFillColor(30, 64, 175);
        doc.rect(0, 0, pageWidth, 25, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, 16);
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`Genererad: ${format(new Date(), "yyyy-MM-dd HH:mm", { locale: sv })}`, pageWidth - margin, 16, { align: "right" });
        doc.setTextColor(0, 0, 0);
        return 35;
      };

      const addSectionTitle = (title: string, y: number) => {
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 64, 175);
        doc.text(title, margin, y);
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "normal");
        return y + 8;
      };

      const checkPageBreak = (neededSpace: number) => {
        if (yPos + neededSpace > pageHeight - margin) {
          doc.addPage();
          yPos = margin;
        }
      };

      // SIDA 1 - Sammanfattning
      yPos = addHeader("Nordfield - Månadsrapport");
      
      yPos = addSectionTitle("Nyckeltal", yPos);
      
      const kpiData = [
        ["Ordrar totalt", `${totalJobs.toLocaleString("sv-SE")}`, `${completedJobs} utförda`],
        ["Totalt ordervärde", `${(totalOrderValue / 1000).toFixed(0)}k kr`, `Snitt ${avgOrderValue.toLocaleString("sv-SE")} kr/order`],
        ["Marginal", `${marginPercent}%`, `${(totalMargin / 1000).toFixed(0)}k kr totalt`],
        ["Planerade timmar", `${plannedHours.toFixed(1)}h`, `${actualHours.toFixed(1)}h utfört`],
        ["Total ställtid", `${totalSetupTime} min`, `Snitt ${avgSetupTime} min/jobb`],
        ["Resurser", `${resources.length}`, `${resources.filter(r => r.status === "active").length} aktiva`],
      ];
      
      autoTable(doc, {
        startY: yPos,
        head: [["Mått", "Värde", "Detaljer"]],
        body: kpiData,
        theme: "striped",
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        styles: { fontSize: 10 },
        margin: { left: margin, right: margin },
      });
      
      yPos = (doc as any).lastAutoTable.finalY + 12;

      // Orderstatusfördelning
      checkPageBreak(50);
      yPos = addSectionTitle("Orderstatusfördelning", yPos);
      
      const statusData = orderStatusDistribution.map(item => [
        item.name,
        item.value.toString(),
        `${totalJobs > 0 ? ((item.value / totalJobs) * 100).toFixed(1) : 0}%`
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [["Status", "Antal", "Andel"]],
        body: statusData,
        theme: "striped",
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        styles: { fontSize: 10 },
        margin: { left: margin, right: margin },
      });

      yPos = (doc as any).lastAutoTable.finalY + 12;

      // Top kunder
      checkPageBreak(60);
      yPos = addSectionTitle("Top 5 kunder efter ordervärde", yPos);
      
      const customerData = topCustomersByValue.map((item, idx) => [
        (idx + 1).toString(),
        item.name,
        `${(item.value / 1000).toFixed(0)}k kr`,
        item.count.toString()
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [["#", "Kund", "Ordervärde", "Antal ordrar"]],
        body: customerData,
        theme: "striped",
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        styles: { fontSize: 10 },
        margin: { left: margin, right: margin },
      });

      // SIDA 2 - Ställtidsanalys
      doc.addPage();
      yPos = addHeader("Ställtidsanalys");

      yPos = addSectionTitle("Ställtid per kategori", yPos);
      
      const setupCategoryData = setupTimeBreakdown.map(item => [
        item.reason,
        `${item.minutes} min`,
        `${item.percentage}%`
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [["Kategori", "Tid", "Andel"]],
        body: setupCategoryData,
        theme: "striped",
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        styles: { fontSize: 10 },
        margin: { left: margin, right: margin },
      });

      yPos = (doc as any).lastAutoTable.finalY + 12;

      // Top objekt med hög ställtid
      checkPageBreak(60);
      yPos = addSectionTitle("Top 5 objekt med högst ställtid", yPos);
      
      const objectData = topSetupTimeObjects.map((item, idx) => [
        (idx + 1).toString(),
        item.name,
        item.customerName || "-",
        `${item.totalMinutes} min`,
        item.count.toString()
      ]);
      
      if (objectData.length > 0) {
        autoTable(doc, {
          startY: yPos,
          head: [["#", "Objekt", "Kund", "Total tid", "Besök"]],
          body: objectData,
          theme: "striped",
          headStyles: { fillColor: [30, 64, 175], textColor: 255 },
          styles: { fontSize: 10 },
          margin: { left: margin, right: margin },
        });
        yPos = (doc as any).lastAutoTable.finalY + 12;
      }

      // Ställtidstrend
      checkPageBreak(60);
      yPos = addSectionTitle("Ställtidstrend (senaste 14 dagarna)", yPos);
      
      const trendData = setupTimeTrend.map(item => [
        item.label,
        `${item.avgSetupTime} min`,
        item.count.toString()
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [["Datum", "Snitt ställtid", "Antal jobb"]],
        body: trendData,
        theme: "striped",
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        styles: { fontSize: 10 },
        margin: { left: margin, right: margin },
      });

      // SIDA 3 - Resursbeläggning
      doc.addPage();
      yPos = addHeader("Resursbeläggning");

      yPos = addSectionTitle("Beläggning per resurs", yPos);
      
      const resourceData = resourceUtilization.map(r => [
        r.fullName,
        `${r.actual.toFixed(1)}h`,
        `${r.planned}h`,
        `${r.utilization}%`,
        r.utilization > 100 ? "Överbokning" : r.utilization > 80 ? "Hög" : "Normal"
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [["Resurs", "Planerat", "Kapacitet", "Beläggning", "Status"]],
        body: resourceData,
        theme: "striped",
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        styles: { fontSize: 10 },
        margin: { left: margin, right: margin },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 4) {
            const status = data.cell.raw as string;
            if (status === "Överbokning") {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = "bold";
            } else if (status === "Hög") {
              data.cell.styles.textColor = [234, 88, 12];
            }
          }
        }
      });

      yPos = (doc as any).lastAutoTable.finalY + 12;

      // Planerat vs faktiskt
      checkPageBreak(60);
      yPos = addSectionTitle("Planerat vs Faktiskt (senaste 7 dagarna)", yPos);
      
      const pvfData = plannedVsActual.map(item => [
        item.label,
        `${item.planned}h`,
        `${item.actual}h`,
        `${item.setupTime}h`,
        item.planned > 0 ? `${((item.actual / item.planned) * 100).toFixed(0)}%` : "-"
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [["Dag", "Planerat", "Faktiskt", "Ställtid", "Effektivitet"]],
        body: pvfData,
        theme: "striped",
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        styles: { fontSize: 10 },
        margin: { left: margin, right: margin },
      });

      yPos = (doc as any).lastAutoTable.finalY + 12;

      // Insikter & rekommendationer
      checkPageBreak(40);
      yPos = addSectionTitle("Insikter och rekommendationer", yPos);
      
      const insightData = insights.map(i => [
        i.type === "success" ? "Positiv" : i.type === "warning" ? "Varning" : "Förslag",
        i.message
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [["Typ", "Beskrivning"]],
        body: insightData,
        theme: "striped",
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        styles: { fontSize: 10 },
        margin: { left: margin, right: margin },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 0) {
            const typ = data.cell.raw as string;
            if (typ === "Varning") {
              data.cell.styles.textColor = [234, 88, 12];
            } else if (typ === "Positiv") {
              data.cell.styles.textColor = [22, 163, 74];
            } else {
              data.cell.styles.textColor = [59, 130, 246];
            }
          }
        }
      });

      // Footer på alla sidor
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(`Nordfield - Sida ${i} av ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: "center" });
      }

      doc.save(`nordfield-rapport-${format(new Date(), "yyyy-MM-dd")}.pdf`);
      
      toast({
        title: "Rapport exporterad",
        description: `PDF-rapport med ${totalPages} sidor har laddats ner.`,
      });
    } catch (error) {
      console.error("PDF export error:", error);
      toast({
        title: "Exportfel",
        description: "Kunde inte skapa PDF-rapporten. Försök igen.",
        variant: "destructive",
      });
    }
  }, [
    totalJobs, completedJobs, totalOrderValue, avgOrderValue, marginPercent, totalMargin,
    plannedHours, actualHours, totalSetupTime, avgSetupTime, resources,
    orderStatusDistribution, topCustomersByValue, setupTimeBreakdown,
    topSetupTimeObjects, setupTimeTrend, resourceUtilization, plannedVsActual, insights, toast
  ]);

  const handleExportExcel = useCallback(() => {
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      let csv = "Nordfield Dashboard Export - " + today + "\n\n";
      
      csv += "NYCKELTAL\n";
      csv += "Mått;Värde;Detaljer\n";
      csv += `Ordrar totalt;${totalJobs};${completedJobs} utförda\n`;
      csv += `Totalt ordervärde;${totalOrderValue} kr;Snitt ${avgOrderValue} kr/order\n`;
      csv += `Marginal;${marginPercent}%;${totalMargin} kr totalt\n`;
      csv += `Planerade timmar;${plannedHours.toFixed(1)}h;${actualHours.toFixed(1)}h utfört\n`;
      csv += `Total ställtid;${totalSetupTime} min;Snitt ${avgSetupTime} min/jobb\n`;
      csv += `Resurser;${resources.length};${resources.filter(r => r.status === "active").length} aktiva\n`;
      
      csv += "\nEKONOMITREND (30 DAGAR)\n";
      csv += "Datum;Ordervärde (tkr);Kostnad (tkr);Marginal (tkr);Antal ordrar\n";
      economicTrend.forEach(d => {
        csv += `${d.date};${d.value};${d.cost};${d.margin};${d.orders}\n`;
      });
      
      csv += "\nVECKOJÄMFÖRELSE\n";
      csv += "Mått;Denna vecka;Förra veckan;Förändring\n";
      csv += `Ordrar;${weekComparison.thisWeek.orders};${weekComparison.lastWeek.orders};${weekComparison.changes.orders}%\n`;
      csv += `Utförda;${weekComparison.thisWeek.completed};${weekComparison.lastWeek.completed};${weekComparison.changes.completed}%\n`;
      csv += `Ordervärde;${weekComparison.thisWeek.value} kr;${weekComparison.lastWeek.value} kr;${weekComparison.changes.value}%\n`;
      csv += `Ställtid;${weekComparison.thisWeek.setupTime} min;${weekComparison.lastWeek.setupTime} min;${weekComparison.changes.setupTime}%\n`;
      
      csv += "\nORDERSTATUSFÖRDELNING\n";
      csv += "Status;Antal;Andel\n";
      orderStatusDistribution.forEach(item => {
        csv += `${item.name};${item.value};${totalJobs > 0 ? ((item.value / totalJobs) * 100).toFixed(1) : 0}%\n`;
      });
      
      csv += "\nTOP 5 KUNDER EFTER ORDERVÄRDE\n";
      csv += "Kund;Ordervärde;Antal ordrar\n";
      topCustomersByValue.forEach(item => {
        csv += `${item.name};${item.value} kr;${item.count}\n`;
      });
      
      csv += "\nTOP 5 OBJEKT MED HÖGST STÄLLTID\n";
      csv += "Objekt;Kund;Total tid;Antal besök\n";
      topSetupTimeObjects.forEach(item => {
        csv += `${item.name};${item.customerName || "-"};${item.totalMinutes} min;${item.count}\n`;
      });
      
      csv += "\nSTÄLLTIDSTREND (14 DAGAR)\n";
      csv += "Datum;Snitt ställtid;Antal jobb\n";
      setupTimeTrend.forEach(item => {
        csv += `${item.label};${item.avgSetupTime} min;${item.count}\n`;
      });
      
      csv += "\nRESURSBELÄGGNING\n";
      csv += "Resurs;Planerat;Kapacitet;Beläggning\n";
      resourceUtilization.forEach(r => {
        csv += `${r.fullName};${r.actual.toFixed(1)}h;${r.planned}h;${r.utilization}%\n`;
      });
      
      const BOM = "\uFEFF";
      const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `nordfield-export-${today}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      
      toast({
        title: "Data exporterad",
        description: "CSV-fil har laddats ner. Öppna i Excel för fullständig analys.",
      });
    } catch (error) {
      console.error("Excel export error:", error);
      toast({
        title: "Exportfel",
        description: "Kunde inte skapa CSV-filen. Försök igen.",
        variant: "destructive",
      });
    }
  }, [
    totalJobs, completedJobs, totalOrderValue, avgOrderValue, marginPercent, totalMargin,
    plannedHours, actualHours, totalSetupTime, avgSetupTime, resources,
    economicTrend, weekComparison, orderStatusDistribution, topCustomersByValue,
    topSetupTimeObjects, setupTimeTrend, resourceUtilization, toast
  ]);

  const isLoading = workOrdersLoading || resourcesLoading || setupLogsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Översikt - {format(new Date(), "MMMM yyyy", { locale: sv })}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleExportPDF} data-testid="button-export-pdf">
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
          <Button variant="outline" onClick={handleExportExcel} data-testid="button-export-excel">
            <Download className="h-4 w-4 mr-2" />
            Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard 
          title="Ordrar totalt" 
          value={`${totalJobs.toLocaleString("sv-SE")}`}
          subtitle={`${completedJobs} utförda`}
          icon={Package}
        />
        <StatCard 
          title="Totalt ordervärde" 
          value={`${(totalOrderValue / 1000).toFixed(0)}k kr`}
          subtitle={`Snitt ${avgOrderValue.toLocaleString("sv-SE")} kr/order`}
          icon={CircleDollarSign}
        />
        <StatCard 
          title="Marginal" 
          value={`${marginPercent}%`}
          subtitle={`${(totalMargin / 1000).toFixed(0)}k kr totalt`}
          icon={Target}
          trend={marginPercent > 20 ? "positive" : marginPercent < 10 ? "negative" : undefined}
        />
        <StatCard 
          title="Planerade timmar" 
          value={`${plannedHours.toFixed(1)}h`}
          subtitle={`${actualHours.toFixed(1)}h utfört`}
          icon={Clock}
          trend={actualHours < plannedHours ? "positive" : "negative"}
        />
        <StatCard 
          title="Ställtid" 
          value={`${totalSetupTime} min`}
          subtitle={`Snitt ${avgSetupTime} min/jobb`}
          icon={Clock}
        />
        <StatCard 
          title="Resurser" 
          value={`${resources.length}`}
          subtitle={`${resources.filter(r => r.status === "active").length} aktiva`}
          icon={Users}
        />
      </div>

      <AICard
        title="AI Insikter"
        variant="compact"
        defaultExpanded={false}
        insights={[
          { type: "info", title: "Trendanalys", description: "AI identifierar mönster i ställtider och produktivitet över tid" },
          { type: "optimization", title: "Effektivitetsförslag", description: "Få AI-drivna förslag för att förbättra marginaler och minska kostnader" },
          { type: "warning", title: "Anomalidetektion", description: "Automatisk upptäckt av avvikande värden och potentiella problem" },
        ]}
      />

      {/* Veckojämförelse */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <WeekCompareCard 
          title="Ordrar"
          thisWeek={weekComparison.thisWeek.orders}
          lastWeek={weekComparison.lastWeek.orders}
          change={weekComparison.changes.orders}
          unit=""
        />
        <WeekCompareCard 
          title="Utförda"
          thisWeek={weekComparison.thisWeek.completed}
          lastWeek={weekComparison.lastWeek.completed}
          change={weekComparison.changes.completed}
          unit=""
        />
        <WeekCompareCard 
          title="Ordervärde"
          thisWeek={Math.round(weekComparison.thisWeek.value / 1000)}
          lastWeek={Math.round(weekComparison.lastWeek.value / 1000)}
          change={weekComparison.changes.value}
          unit="k kr"
        />
        <WeekCompareCard 
          title="Ställtid"
          thisWeek={weekComparison.thisWeek.setupTime}
          lastWeek={weekComparison.lastWeek.setupTime}
          change={weekComparison.changes.setupTime}
          unit=" min"
          invertColors
        />
      </div>

      {/* Ekonomitrend - 30 dagar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AreaChartIcon className="h-4 w-4" />
            Ekonomitrend (senaste 30 dagarna)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={economicTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="label" 
                  tick={{ fontSize: 10 }}
                  interval={4}
                  className="text-muted-foreground"
                />
                <YAxis 
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                  label={{ value: 'tkr', angle: -90, position: 'insideLeft', fontSize: 12 }}
                />
                <RechartsTooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                  }}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = { value: 'Ordervärde', cost: 'Kostnad', margin: 'Marginal' };
                    return [`${value}k kr`, labels[name] || name];
                  }}
                />
                <Legend />
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  name="Ordervärde"
                  fill="hsl(var(--primary) / 0.2)"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                />
                <Line 
                  type="monotone" 
                  dataKey="margin" 
                  name="Marginal"
                  stroke="hsl(140 70% 45%)"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Ställtidstrend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Ställtidstrend (senaste 14 dagarna)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={setupTimeTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="label" 
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                />
                <YAxis 
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                  label={{ value: 'min', angle: -90, position: 'insideLeft', fontSize: 12 }}
                />
                <RechartsTooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                  }}
                  formatter={(value: number) => [`${value} min`, 'Snitt ställtid']}
                />
                <Line 
                  type="monotone" 
                  dataKey="avgSetupTime" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  dot={{ fill: 'hsl(var(--primary))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Planerat vs Faktiskt */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Planerat vs Faktiskt (senaste 7 dagarna)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={plannedVsActual}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="label" 
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    label={{ value: 'timmar', angle: -90, position: 'insideLeft', fontSize: 12 }}
                  />
                  <RechartsTooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="planned" name="Planerat" fill="hsl(var(--muted-foreground))" className="cursor-pointer" onClick={(data) => handleBarClick(data)} />
                  <Bar dataKey="actual" name="Faktiskt" fill="hsl(var(--primary))" className="cursor-pointer" onClick={(data) => handleBarClick(data)} />
                  <Bar dataKey="setupTime" name="Ställtid" fill="hsl(var(--destructive))" className="cursor-pointer" onClick={(data) => handleBarClick(data)} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top 5 Problemområden */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Top 5 objekt med högst ställtid
              </CardTitle>
              <Link href="/objects">
                <Button variant="ghost" size="sm">
                  Visa alla
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              {topSetupTimeObjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen ställtidsdata ännu</p>
              ) : (
                <div className="space-y-3">
                  {topSetupTimeObjects.map((item, index) => (
                    <div key={item.objectId} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.name}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {item.address && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {item.address}
                            </span>
                          )}
                          {item.customerName && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {item.customerName}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium">{item.totalMinutes} min</div>
                        <div className="text-xs text-muted-foreground">{item.count} besök</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Orderstatusfördelning */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Orderstatusfördelning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {orderStatusDistribution.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen orderdata</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={orderStatusDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                      className="cursor-pointer"
                      onClick={(data) => handlePieClick(data)}
                    >
                      {orderStatusDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={STATUS_COLORS_CHART[index % STATUS_COLORS_CHART.length]} className="cursor-pointer hover:opacity-80 transition-opacity" />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                      formatter={(value: number) => [`${value} ordrar`]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top kunder efter ordervärde */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Top 5 kunder efter ordervärde
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              {topCustomersByValue.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen orderdata</p>
              ) : (
                <div className="space-y-3">
                  {topCustomersByValue.map((item, index) => (
                    <div 
                      key={item.customerId} 
                      className="flex items-center gap-3 cursor-pointer rounded-md p-1 -m-1 hover:bg-muted/50 transition-colors"
                      onClick={() => handleCustomerClick(item.customerId)}
                      data-testid={`customer-row-${item.customerId}`}
                    >
                      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.count} ordrar</div>
                      </div>
                      <div className="text-right shrink-0 flex items-center gap-1">
                        <div className="text-sm font-medium">{(item.value / 1000).toFixed(0)}k kr</div>
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Resursbeläggning */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Resursbeläggning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {resourceUtilization.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga resurser registrerade</p>
            ) : (
              resourceUtilization.map((resource) => (
                <div key={resource.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="font-medium cursor-help">{resource.name}</span>
                      </TooltipTrigger>
                      <TooltipContent>{resource.fullName}</TooltipContent>
                    </Tooltip>
                    <span className="text-muted-foreground">
                      {resource.actual.toFixed(1)}h / {resource.planned}h
                      {resource.utilization > 100 && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">Överbokning</Badge>
                      )}
                    </span>
                  </div>
                  <Progress 
                    value={Math.min(resource.utilization, 100)} 
                    className={resource.utilization > 100 ? "[&>div]:bg-red-500" : ""}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Ställtidsanalys */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Ställtidsanalys per kategori
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {setupTimeBreakdown.map((item) => (
                <div key={item.reason} className="flex items-center gap-3">
                  <div className="w-28 text-sm text-muted-foreground truncate">{item.reason}</div>
                  <div className="flex-1">
                    <div className="h-4 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-16 text-right text-sm font-mono">{item.minutes} min</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SLA-risker */}
      {slaRisks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-500" />
                Risker och förseningar
              </CardTitle>
              <Link href="/">
                <Button variant="ghost" size="sm">
                  Till planeringen
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {slaRisks.map((risk, index) => (
                <div 
                  key={index} 
                  className={`flex items-center gap-3 p-3 rounded-md ${
                    risk.type === "overdue" 
                      ? "bg-red-50 dark:bg-red-950" 
                      : "bg-orange-50 dark:bg-orange-950"
                  }`}
                >
                  {risk.type === "overdue" ? (
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  ) : (
                    <Clock className="h-4 w-4 text-orange-500 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{risk.workOrder.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {risk.workOrder.objectName || "Okänt objekt"} - {risk.reason}
                    </div>
                  </div>
                  <Badge variant={risk.type === "overdue" ? "destructive" : "secondary"}>
                    {risk.type === "overdue" ? "Försenad" : "Hög ställtid"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI-insikter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            AI-insikter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {insights.map((insight, index) => {
              const Icon = insightIcons[insight.type];
              return (
                <div 
                  key={index}
                  className={`p-4 rounded-md border ${insightColors[insight.type]}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${insightIconColors[insight.type]}`} />
                    <div className="flex-1">
                      <p className="text-sm">{insight.message}</p>
                      {insight.link && (
                        <Link href={insight.link}>
                          <Button variant="ghost" size="sm" className="h-auto mt-1 p-0 text-primary">
                            Visa mer
                            <ChevronRight className="h-3 w-3 ml-1" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* AI-möjligheter för framtida utveckling */}
      <Card className="border border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-primary/5">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">AI-möjligheter</CardTitle>
              <p className="text-xs text-muted-foreground">Framtida utveckling</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Potentiella AI-funktioner som kan integreras för att ytterligare optimera er verksamhet
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <AICapabilityCard
              icon={Route}
              title="Smart ruttoptimering"
              description="AI analyserar trafikmönster, väder och historisk data för att skapa optimala rutter som sparar 15-25% körtid."
              impact="Besparingar: 2-4h per dag och resurs"
              status="planned"
            />
            <AICapabilityCard
              icon={Brain}
              title="Prediktiv schemaläggning"
              description="Förutse vilka objekt som behöver service baserat på historiska mönster och säsongsvariationer."
              impact="Minska akutjobb med 40%"
              status="planned"
            />
            <AICapabilityCard
              icon={Zap}
              title="Automatisk ställtidsreducering"
              description="AI identifierar mönster i ställtidsdata och föreslår åtgärder för att minska väntetider."
              impact="Reducera ställtid med 30%"
              status="planned"
            />
            <AICapabilityCard
              icon={MessageSquare}
              title="AI-assisterad kundkommunikation"
              description="Automatiska SMS/email med exakta ankomsttider och statusuppdateringar till kunder."
              impact="Förbättrad kundnöjdhet"
              status="planned"
            />
            <AICapabilityCard
              icon={BarChart3}
              title="Intelligent resursallokering"
              description="AI fördelar resurser baserat på kompetens, geografiskt läge och arbetsbelastning."
              impact="Jämnare beläggning"
              status="planned"
            />
            <AICapabilityCard
              icon={Cpu}
              title="Automatisk datarensning"
              description="AI validerar och korrigerar adresser, koordinater och kunddata automatiskt."
              impact="Färre fältfel"
              status="planned"
            />
            <AICapabilityCard
              icon={Shield}
              title="Anomalidetektering"
              description="Upptäck ovanliga mönster i tid, kostnader eller kundklagomål innan de blir problem."
              impact="Proaktiv problemlösning"
              status="planned"
            />
            <AICapabilityCard
              icon={TrendingUp}
              title="Prognos och budgetering"
              description="AI-baserade prognoser för arbetsbörda, intäkter och kostnader per månad/kvartal."
              impact="Bättre planering"
              status="planned"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface AICapabilityCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  impact: string;
  status: "active" | "planned" | "coming";
}

function AICapabilityCard({ icon: Icon, title, description, impact, status }: AICapabilityCardProps) {
  const statusLabels = {
    active: "Aktiv",
    planned: "Planerad",
    coming: "Kommer snart"
  };
  
  const statusColors = {
    active: "bg-green-500/15 text-green-500 border-green-500/30",
    planned: "bg-primary/15 text-primary border-primary/30",
    coming: "bg-orange-500/15 text-orange-500 border-orange-500/30"
  };

  return (
    <div className="group p-5 rounded-xl bg-card/60 border border-border/50 hover:border-primary/30 hover:bg-card/80 transition-all duration-200">
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <Badge variant="outline" className={`text-[10px] px-2 py-0.5 border ${statusColors[status]}`}>
            {statusLabels[status]}
          </Badge>
        </div>
        <h4 className="font-semibold text-sm mb-2 leading-tight">{title}</h4>
        <p className="text-xs text-muted-foreground leading-relaxed flex-1 mb-4">{description}</p>
        <div className="pt-3 border-t border-border/40">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="leading-tight">{impact}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  trend?: "positive" | "negative";
}

function StatCard({ title, value, subtitle, icon: Icon, trend }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs text-muted-foreground">{title}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{value}</span>
          {trend && (
            trend === "positive" ? 
              <ArrowDownRight className="h-4 w-4 text-green-500" /> :
              <ArrowUpRight className="h-4 w-4 text-red-500" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

interface WeekCompareCardProps {
  title: string;
  thisWeek: number;
  lastWeek: number;
  change: number;
  unit: string;
  invertColors?: boolean;
}

function WeekCompareCard({ title, thisWeek, lastWeek, change, unit, invertColors }: WeekCompareCardProps) {
  const isPositive = invertColors ? change < 0 : change > 0;
  const isNegative = invertColors ? change > 0 : change < 0;
  
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs text-muted-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">vs förra veckan</span>
        </div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl font-bold">{thisWeek.toLocaleString("sv-SE")}{unit}</span>
          {change !== 0 && (
            <span className={`flex items-center text-sm font-medium ${
              isPositive ? "text-green-600 dark:text-green-400" : 
              isNegative ? "text-red-600 dark:text-red-400" : 
              "text-muted-foreground"
            }`}>
              {isPositive ? <TrendingUp className="h-3 w-3 mr-0.5" /> : 
               isNegative ? <TrendingDown className="h-3 w-3 mr-0.5" /> :
               <Equal className="h-3 w-3 mr-0.5" />}
              {change > 0 ? "+" : ""}{change}%
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Förra veckan: {lastWeek.toLocaleString("sv-SE")}{unit}
        </p>
      </CardContent>
    </Card>
  );
}
