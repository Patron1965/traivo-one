import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, Key, Car, Info, ChevronRight } from "lucide-react";

interface ObjectCardProps {
  id: string;
  name: string;
  objectNumber: string;
  objectType: string;
  customerName: string;
  address: string;
  avgSetupTime: number;
  lastServiceDate?: string;
  status: "active" | "inactive";
  onClick?: () => void;
}

const typeLabels: Record<string, string> = {
  well: "Brunn",
  station: "Station",
  property: "Fastighet",
  facility: "Anläggning",
};

export function ObjectCard({
  name,
  objectNumber,
  objectType,
  customerName,
  address,
  avgSetupTime,
  lastServiceDate,
  status,
  onClick,
}: ObjectCardProps) {
  const setupTimeColor = avgSetupTime < 10 ? "text-green-600" : avgSetupTime < 20 ? "text-orange-500" : "text-red-500";

  return (
    <Card 
      className="hover-elevate active-elevate-2 cursor-pointer"
      onClick={() => { onClick?.(); console.log("Object card clicked:", name); }}
      data-testid={`object-card-${objectNumber}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-sm font-semibold truncate">{name}</h3>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {typeLabels[objectType] || objectType}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono">{objectNumber}</p>
          </div>
          <Badge variant={status === "active" ? "secondary" : "outline"} className="shrink-0">
            {status === "active" ? "Aktiv" : "Inaktiv"}
          </Badge>
        </div>

        <div className="space-y-2 text-xs text-muted-foreground mb-3">
          <div className="flex items-center gap-2">
            <Info className="h-3 w-3 shrink-0" />
            <span className="truncate">{customerName}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{address}</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <Clock className={`h-3 w-3 ${setupTimeColor}`} />
              <span className={setupTimeColor}>{avgSetupTime} min ställtid</span>
            </div>
            {lastServiceDate && (
              <span className="text-muted-foreground">
                Senast: {lastServiceDate}
              </span>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

interface ObjectDetailProps {
  name: string;
  objectNumber: string;
  customerName: string;
  address: string;
  accessInfo: {
    gateCode?: string;
    keyLocation?: string;
    parking?: string;
    specialInstructions?: string;
  };
  setupTimeBreakdown: {
    gateAccess: number;
    parking: number;
    walkToObject: number;
  };
  avgSetupTime: number;
}

export function ObjectDetail({
  name,
  objectNumber,
  customerName,
  address,
  accessInfo,
  setupTimeBreakdown,
  avgSetupTime,
}: ObjectDetailProps) {
  const [showGateCode, setShowGateCode] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{name}</h2>
        <p className="text-sm text-muted-foreground font-mono">{objectNumber}</p>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-2">Kundinformation</h3>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{customerName}</p>
            <p>{address}</p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Key className="h-4 w-4" />
            Åtkomstinformation
          </h3>
          <div className="space-y-2">
            {accessInfo.gateCode && (
              <div className="flex items-center justify-between p-2 bg-muted rounded-md">
                <span className="text-sm">Grinddkod</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowGateCode(!showGateCode)}
                  data-testid="button-toggle-gate-code"
                >
                  {showGateCode ? accessInfo.gateCode : "Visa kod"}
                </Button>
              </div>
            )}
            {accessInfo.keyLocation && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm">
                <Key className="h-4 w-4 text-muted-foreground" />
                <span>{accessInfo.keyLocation}</span>
              </div>
            )}
            {accessInfo.parking && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm">
                <Car className="h-4 w-4 text-muted-foreground" />
                <span>{accessInfo.parking}</span>
              </div>
            )}
            {accessInfo.specialInstructions && (
              <div className="p-2 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-md text-sm">
                <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                  <Info className="h-4 w-4" />
                  <span>{accessInfo.specialInstructions}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Ställtidsanalys (snitt: {avgSetupTime} min)
          </h3>
          <div className="space-y-2">
            <SetupTimeBar label="Grindåtkomst" value={setupTimeBreakdown.gateAccess} max={avgSetupTime} />
            <SetupTimeBar label="Parkering" value={setupTimeBreakdown.parking} max={avgSetupTime} />
            <SetupTimeBar label="Gångväg" value={setupTimeBreakdown.walkToObject} max={avgSetupTime} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupTimeBar({ label, value, max }: { label: string; value: number; max: number }) {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value} min</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

import { useState } from "react";
