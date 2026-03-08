import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, FileText, Users, DollarSign, Clock } from "lucide-react";
import type { OrderConcept } from "@shared/schema";

interface WizardSidebarProps {
  concept: OrderConcept | null;
  objectCount: number;
  articleCount: number;
  totalValue: number;
  totalCost: number;
  estimatedHours: number;
  customerName?: string;
}

export default function WizardSidebar({
  concept,
  objectCount,
  articleCount,
  totalValue,
  totalCost,
  estimatedHours,
  customerName,
}: WizardSidebarProps) {
  return (
    <div className="w-72 shrink-0 space-y-4" data-testid="wizard-sidebar">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Sammanfattning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {customerName && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm" data-testid="sidebar-customer">{customerName}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Objekt</span>
            </div>
            <Badge variant="secondary" data-testid="sidebar-object-count">{objectCount}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Artiklar</span>
            </div>
            <Badge variant="secondary" data-testid="sidebar-article-count">{articleCount}</Badge>
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Värde</span>
              </div>
              <span className="text-sm font-medium" data-testid="sidebar-total-value">
                {totalValue.toLocaleString("sv-SE")} kr
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground ml-6">Kostnad</span>
              <span className="text-sm" data-testid="sidebar-total-cost">
                {totalCost.toLocaleString("sv-SE")} kr
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Tid</span>
              </div>
              <span className="text-sm" data-testid="sidebar-hours">
                {estimatedHours.toFixed(1)} h
              </span>
            </div>
          </div>
          {concept?.status && (
            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={concept.status === "active" ? "default" : "secondary"} data-testid="sidebar-status">
                  {concept.status === "draft" ? "Utkast" : concept.status === "active" ? "Aktiv" : concept.status}
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
