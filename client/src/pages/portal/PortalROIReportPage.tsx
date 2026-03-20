import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Clock,
  BarChart3,
  AlertCircle,
  TrendingUp,
  Truck,
  Leaf,
} from "lucide-react";

interface SharedROIData {
  customer: { name: string };
  summary: {
    totalOrders: number;
    completedOrders: number;
    completionRate: number;
    avgDurationMinutes: number;
    efficiencyGainPercent: number;
    totalDistanceKm: number;
    totalCo2Kg: number;
  };
}

export default function PortalROIReportPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";

  const { data, isLoading, error } = useQuery<SharedROIData>({
    queryKey: ["/api/portal/roi-shared", token],
    queryFn: async () => {
      const res = await fetch(`/api/portal/roi-shared?token=${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Kunde inte ladda rapport" }));
        throw new Error(err.error || "Kunde inte ladda rapport");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-lg font-semibold mb-2">Ogiltig l\u00e4nk</h2>
            <p className="text-muted-foreground text-sm">Denna delningsl\u00e4nk saknar en giltig token.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <Card className="max-w-lg w-full">
          <CardContent className="p-8 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-lg font-semibold mb-2">Kunde inte ladda rapport</h2>
            <p className="text-muted-foreground text-sm">{(error as Error).message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-6" data-testid="portal-roi-report">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#1B4B6B] text-white rounded-full text-xs font-medium">
            Traivo ROI-rapport
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-customer-name">{data.customer.name}</h1>
          <p className="text-muted-foreground text-sm">\u00d6versikt av serviceprestanda</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card data-testid="kpi-total-orders">
            <CardContent className="p-5 text-center">
              <BarChart3 className="h-6 w-6 mx-auto mb-2 text-[#4A9B9B]" />
              <p className="text-3xl font-bold">{data.summary.totalOrders}</p>
              <p className="text-xs text-muted-foreground">Totalt ordrar</p>
            </CardContent>
          </Card>

          <Card data-testid="kpi-completed-orders">
            <CardContent className="p-5 text-center">
              <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-green-600" />
              <p className="text-3xl font-bold">{data.summary.completedOrders}</p>
              <p className="text-xs text-muted-foreground">Utf\u00f6rda ordrar</p>
            </CardContent>
          </Card>

          <Card data-testid="kpi-completion-rate">
            <CardContent className="p-5 text-center">
              <p className="text-3xl font-bold" style={{ color: data.summary.completionRate >= 90 ? "#16a34a" : "#d97706" }}>
                {data.summary.completionRate}%
              </p>
              <p className="text-xs text-muted-foreground">Completion rate</p>
            </CardContent>
          </Card>

          <Card data-testid="kpi-efficiency">
            <CardContent className="p-5 text-center">
              <TrendingUp className="h-6 w-6 mx-auto mb-2 text-[#4A9B9B]" />
              <p className="text-3xl font-bold">{data.summary.efficiencyGainPercent}%</p>
              <p className="text-xs text-muted-foreground">Effektivitetsvinst</p>
            </CardContent>
          </Card>

          <Card data-testid="kpi-avg-duration">
            <CardContent className="p-5 text-center">
              <Clock className="h-6 w-6 mx-auto mb-2 text-[#6B7C8C]" />
              <p className="text-3xl font-bold">{data.summary.avgDurationMinutes}</p>
              <p className="text-xs text-muted-foreground">Snitt uppdragstid (min)</p>
            </CardContent>
          </Card>

          <Card data-testid="kpi-distance">
            <CardContent className="p-5 text-center">
              <Truck className="h-6 w-6 mx-auto mb-2 text-[#1B4B6B]" />
              <p className="text-3xl font-bold">{data.summary.totalDistanceKm}</p>
              <p className="text-xs text-muted-foreground">Total k\u00f6rstr\u00e4cka (km)</p>
            </CardContent>
          </Card>

          <Card data-testid="kpi-co2">
            <CardContent className="p-5 text-center">
              <Leaf className="h-6 w-6 mx-auto mb-2 text-green-600" />
              <p className="text-3xl font-bold">{data.summary.totalCo2Kg}</p>
              <p className="text-xs text-muted-foreground">CO2-utsl\u00e4pp (kg)</p>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Genererad av Traivo &mdash; {new Date().toLocaleDateString("sv-SE")}
        </p>
      </div>
    </div>
  );
}
