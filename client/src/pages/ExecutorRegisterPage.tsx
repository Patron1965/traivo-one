import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Users,
  Truck,
  Wrench,
  Loader2,
  Search,
  UserCheck,
  Car,
  Boxes,
  ExternalLink,
  Check,
  X,
} from "lucide-react";
import type {
  ExecutorRegister,
  ExecutorRegisterTeam,
  ExecutorRegisterPerson,
  ExecutorRegisterAsset,
} from "@shared/schema";

const REGISTER_KEY = ["/api/executor-register"];

type CodeField = "costCenter" | "projectCode";
type EntityKind = "team" | "resource" | "vehicle" | "equipment";

const ENDPOINTS: Record<EntityKind, string> = {
  team: "/api/teams",
  resource: "/api/resources",
  vehicle: "/api/vehicles",
  equipment: "/api/equipment",
};

interface CodeEditorProps {
  kind: EntityKind;
  id: string;
  field: CodeField;
  value: string | null;
  label: string;
  disabled?: boolean;
}

/**
 * Enhetlig inline-redigering av kostnadsställe/projekt. Sparar via befintlig PATCH
 * för respektive register och invaliderar samlad läsmodell. Fordon/utrustning saknar
 * projekt — då renderas fältet som ej tillämpligt.
 */
function CodeEditor({ kind, id, field, value, label, disabled }: CodeEditorProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      const res = await apiRequest("PATCH", `${ENDPOINTS[kind]}/${id}`, {
        [field]: next.trim() === "" ? null : next.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
      setEditing(false);
      toast({ title: `${label} uppdaterat` });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  const testId = `${field === "costCenter" ? "costcenter" : "project"}-${kind}-${id}`;

  if (disabled) {
    return (
      <div className="flex flex-col gap-0.5 min-w-[7rem]">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground italic" data-testid={`text-${testId}`}>
          ej tillämpligt
        </span>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-0.5 min-w-[7rem]">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(true);
          }}
          className="text-left text-xs font-medium hover-elevate rounded px-1 -mx-1 py-0.5"
          data-testid={`button-edit-${testId}`}
        >
          {value ? value : <span className="text-muted-foreground italic">— sätt</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-[7rem]">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") mutation.mutate(draft);
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 w-24 text-xs"
          data-testid={`input-${testId}`}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(draft)}
          data-testid={`button-save-${testId}`}
        >
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setEditing(false)}
          data-testid={`button-cancel-${testId}`}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function AssetRow({ asset }: { asset: ExecutorRegisterAsset }) {
  const Icon = asset.kind === "vehicle" ? Car : Boxes;
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2"
      data-testid={`row-asset-${asset.id}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 text-chart-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" data-testid={`text-asset-name-${asset.id}`}>
            {asset.name}
          </p>
          {asset.identifier && (
            <p className="text-xs text-muted-foreground truncate">{asset.identifier}</p>
          )}
        </div>
      </div>
      <CodeEditor
        kind={asset.kind}
        id={asset.id}
        field="costCenter"
        value={asset.costCenter}
        label="Kostnadsställe"
      />
    </div>
  );
}

function PersonRow({ person }: { person: ExecutorRegisterPerson }) {
  return (
    <div className="rounded-md border p-3" data-testid={`row-person-${person.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-7 w-7 rounded-full bg-chart-1/15 flex items-center justify-center">
            <Users className="h-4 w-4 text-chart-1" />
          </span>
          <div>
            <p className="text-sm font-medium" data-testid={`text-person-name-${person.id}`}>
              {person.name}
            </p>
            <div className="flex items-center gap-1.5">
              {person.teamRole && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {person.teamRole}
                </Badge>
              )}
              {person.status && person.status !== "active" && (
                <span className="text-[10px] text-muted-foreground">{person.status}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <CodeEditor kind="resource" id={person.id} field="costCenter" value={person.costCenter} label="Kostnadsställe" />
          <CodeEditor kind="resource" id={person.id} field="projectCode" value={person.projectCode} label="Projekt" />
        </div>
      </div>
      {(person.vehicles.length > 0 || person.equipment.length > 0) && (
        <div className="mt-2 grid gap-1.5 pl-9">
          {person.vehicles.map(v => (
            <AssetRow key={v.id} asset={v} />
          ))}
          {person.equipment.map(e => (
            <AssetRow key={e.id} asset={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCard({ team }: { team: ExecutorRegisterTeam }) {
  const assetCount = team.vehicles.length + team.equipment.length;
  return (
    <Card data-testid={`card-team-${team.id}`}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="h-9 w-9 rounded-lg flex items-center justify-center text-xs font-semibold text-white"
              style={{ backgroundColor: team.color || "#1B4B6B" }}
              data-testid={`avatar-team-${team.id}`}
            >
              {team.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(w => w[0]?.toUpperCase() || "")
                .join("") || team.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <CardTitle className="text-base" data-testid={`text-team-name-${team.id}`}>
                {team.name}
              </CardTitle>
              <CardDescription>
                {team.members.length} medlem{team.members.length === 1 ? "" : "mar"} · {assetCount} fordon/utrustning
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <CodeEditor kind="team" id={team.id} field="costCenter" value={team.costCenter} label="Kostnadsställe" />
            <CodeEditor kind="team" id={team.id} field="projectCode" value={team.projectCode} label="Projekt" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {team.members.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Inga medlemmar än</p>
        ) : (
          team.members.map(m => <PersonRow key={m.id} person={m} />)
        )}
      </CardContent>
    </Card>
  );
}

export default function ExecutorRegisterPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading, isError } = useQuery<ExecutorRegister>({
    queryKey: REGISTER_KEY,
  });

  const q = search.trim().toLowerCase();
  const matchPerson = (p: ExecutorRegisterPerson) =>
    !q ||
    p.name.toLowerCase().includes(q) ||
    p.vehicles.some(v => v.name.toLowerCase().includes(q)) ||
    p.equipment.some(e => e.name.toLowerCase().includes(q));

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!q) return data;
    return {
      teams: data.teams.filter(
        t => t.name.toLowerCase().includes(q) || t.members.some(matchPerson),
      ),
      standalonePersons: data.standalonePersons.filter(matchPerson),
      unassignedVehicles: data.unassignedVehicles.filter(v => v.name.toLowerCase().includes(q)),
      unassignedEquipment: data.unassignedEquipment.filter(e => e.name.toLowerCase().includes(q)),
    } as ExecutorRegister;
  }, [data, q]);

  const totals = useMemo(() => {
    if (!data) return { teams: 0, persons: 0, vehicles: 0, equipment: 0 };
    const persons =
      data.standalonePersons.length +
      data.teams.reduce((acc, t) => acc + t.members.length, 0);
    const vehicleIds = new Set<string>();
    const equipmentIds = new Set<string>();
    data.teams.forEach(t => {
      t.vehicles.forEach(v => vehicleIds.add(v.id));
      t.equipment.forEach(e => equipmentIds.add(e.id));
    });
    data.standalonePersons.forEach(p => {
      p.vehicles.forEach(v => vehicleIds.add(v.id));
      p.equipment.forEach(e => equipmentIds.add(e.id));
    });
    data.unassignedVehicles.forEach(v => vehicleIds.add(v.id));
    data.unassignedEquipment.forEach(e => equipmentIds.add(e.id));
    return {
      teams: data.teams.length,
      persons,
      vehicles: vehicleIds.size,
      equipment: equipmentIds.size,
    };
  }, [data]);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <UserCheck className="h-6 w-6 text-chart-1" />
            Utförarregister
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            En samlad vy: personer, fordon/utrustning och team som en enhet. Team är
            grupperande förälder — kostnadsställe och projekt följer med till genererade uppgifter.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild data-testid="link-resources">
            <Link href="/resources">
              <Users className="h-4 w-4 mr-1.5" />
              Personer
              <ExternalLink className="h-3 w-3 ml-1.5" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild data-testid="link-fleet">
            <Link href="/fleet">
              <Truck className="h-4 w-4 mr-1.5" />
              Fordon
              <ExternalLink className="h-3 w-3 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={UserCheck} iconWrap="bg-chart-1/15" iconColor="text-chart-1" value={totals.teams} label="Team" testId="stat-teams" />
        <StatCard icon={Users} iconWrap="bg-chart-2/15" iconColor="text-chart-2" value={totals.persons} label="Personer" testId="stat-persons" />
        <StatCard icon={Car} iconWrap="bg-chart-4/15" iconColor="text-chart-4" value={totals.vehicles} label="Fordon" testId="stat-vehicles" />
        <StatCard icon={Wrench} iconWrap="bg-chart-5/15" iconColor="text-chart-5" value={totals.equipment} label="Utrustning" testId="stat-equipment" />
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Sök person, team, fordon eller utrustning..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8"
          data-testid="input-search"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-error">
            Kunde inte hämta utförarregistret.
          </CardContent>
        </Card>
      ) : !filtered ? null : (
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <UserCheck className="h-4 w-4" />
              Team
            </h2>
            {filtered.teams.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Inga team matchar.</p>
            ) : (
              <div className="space-y-4">
                {filtered.teams.map(t => (
                  <TeamCard key={t.id} team={t} />
                ))}
              </div>
            )}
          </section>

          {filtered.standalonePersons.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4" />
                Personer utan team
              </h2>
              <Card>
                <CardContent className="pt-6 space-y-2">
                  {filtered.standalonePersons.map(p => (
                    <PersonRow key={p.id} person={p} />
                  ))}
                </CardContent>
              </Card>
            </section>
          )}

          {(filtered.unassignedVehicles.length > 0 || filtered.unassignedEquipment.length > 0) && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Fordon &amp; utrustning utan utförare
              </h2>
              <Card>
                <CardContent className="pt-6 grid gap-1.5">
                  {filtered.unassignedVehicles.map(v => (
                    <AssetRow key={v.id} asset={v} />
                  ))}
                  {filtered.unassignedEquipment.map(e => (
                    <AssetRow key={e.id} asset={e} />
                  ))}
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  iconWrap,
  iconColor,
  value,
  label,
  testId,
}: {
  icon: typeof Users;
  iconWrap: string;
  iconColor: string;
  value: number;
  label: string;
  testId: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${iconWrap}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div>
            <p className="text-2xl font-bold" data-testid={`text-${testId}`}>
              {value}
            </p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
