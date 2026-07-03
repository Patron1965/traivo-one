import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Receipt, Building2, FolderKanban, Users } from "lucide-react";

type FortnoxCodeSource = {
  type: "vehicle" | "equipment" | "participant" | "resource" | "team";
  id: string;
  label: string;
} | null;

interface KonteringData {
  costCenter: string | null;
  project: string | null;
  costCenterSource: FortnoxCodeSource;
  projectSource: FortnoxCodeSource;
  team: { id: string; name: string } | null;
}

const SOURCE_TYPE_LABELS: Record<NonNullable<FortnoxCodeSource>["type"], string> = {
  vehicle: "bil",
  equipment: "utrustning",
  participant: "deltagare",
  resource: "resurs",
  team: "team",
};

function sourceLabel(source: NonNullable<FortnoxCodeSource>): string {
  return `från ${SOURCE_TYPE_LABELS[source.type]} ${source.label}`;
}

function Row({
  label,
  value,
  icon: Icon,
  testId,
}: {
  label: string;
  value: ReactNode;
  icon: typeof Building2;
  testId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="font-medium text-right break-words min-w-0" data-testid={testId}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </span>
    </div>
  );
}

/**
 * §5 J (Kontering): uppgiftens infopaket-block som visar tilldelat team +
 * kostnadsställe + projekt som uppgiften faktureras mot, med varifrån varje
 * värde härleds (bil/utrustning → deltagare → resurs → team). Read-only;
 * återanvänder /api/work-orders/:id/fortnox-codes så det som visas matchar det
 * som faktiskt exporteras till Fortnox.
 */
export function KonteringCard({
  workOrderId,
  variant = "card",
  className,
}: {
  workOrderId: string;
  variant?: "card" | "section";
  className?: string;
}) {
  const { data } = useQuery<KonteringData>({
    queryKey: ["/api/work-orders", workOrderId, "fortnox-codes"],
    enabled: !!workOrderId,
  });

  if (!data) return null;

  const body = (
    <>
      <Row
        label="Team"
        icon={Users}
        testId="text-kontering-team"
        value={data.team ? data.team.name : null}
      />
      <Row
        label="Kostnadsställe"
        icon={Building2}
        testId="text-kontering-cost-center"
        value={
          data.costCenter ? (
            <span>
              {data.costCenter}
              {data.costCenterSource && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {sourceLabel(data.costCenterSource)}
                </span>
              )}
            </span>
          ) : null
        }
      />
      <Row
        label="Projekt"
        icon={FolderKanban}
        testId="text-kontering-project"
        value={
          data.project ? (
            <span>
              {data.project}
              {data.projectSource && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {sourceLabel(data.projectSource)}
                </span>
              )}
            </span>
          ) : null
        }
      />
      {!data.costCenter && !data.project && (
        <p className="text-xs text-muted-foreground pt-1">
          Inget kostnadsställe eller projekt kunde härledas — uppgiften exporteras
          utan koder. Sätt kostnadsställe/projekt på bil, utrustning, resurs eller team.
        </p>
      )}
    </>
  );

  if (variant === "section") {
    return (
      <div className={`space-y-1 pt-3 border-t ${className ?? ""}`} data-testid="section-kontering">
        <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
          <Receipt className="h-3.5 w-3.5" />
          Kontering (Fortnox)
        </h4>
        {body}
      </div>
    );
  }

  return (
    <Card data-testid="card-kontering" className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" /> Kontering (Fortnox)
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{body}</CardContent>
    </Card>
  );
}
