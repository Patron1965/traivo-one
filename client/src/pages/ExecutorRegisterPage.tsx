import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  UserPlus,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  ExecutorRegister,
  ExecutorRegisterTeam,
  ExecutorRegisterPerson,
  ExecutorRegisterAsset,
  Resource,
  Vehicle,
  Equipment,
} from "@shared/schema";

const REGISTER_KEY = ["/api/executor-register"];

const ROLE_OPTIONS = [
  { value: "medlem", label: "Medlem" },
  { value: "ledare", label: "Ledare" },
  { value: "vikarie", label: "Vikarie" },
];

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

/**
 * Fordon/utrustning kopplad till en person. När `allowUnlink` är satt och raden har en
 * `linkId` (resource_vehicles/resource_equipment) går det att koppla loss kopplingen.
 */
function AssetRow({ asset, allowUnlink }: { asset: ExecutorRegisterAsset; allowUnlink?: boolean }) {
  const { toast } = useToast();
  const Icon = asset.kind === "vehicle" ? Car : Boxes;

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const endpoint = asset.kind === "vehicle" ? "resource-vehicles" : "resource-equipment";
      await apiRequest("DELETE", `/api/${endpoint}/${asset.linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
      toast({ title: "Koppling borttagen" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte koppla loss", description: err.message, variant: "destructive" });
    },
  });

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
      <div className="flex items-center gap-2 shrink-0">
        <CodeEditor
          kind={asset.kind}
          id={asset.id}
          field="costCenter"
          value={asset.costCenter}
          label="Kostnadsställe"
        />
        {allowUnlink && asset.linkId && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            disabled={unlinkMutation.isPending}
            onClick={() => unlinkMutation.mutate()}
            title="Koppla loss"
            data-testid={`button-unlink-asset-${asset.linkId}`}
          >
            {unlinkMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Dialog för att koppla ett fordon eller en utrustning till en person. Skriver till
 * resource_vehicles / resource_equipment via befintliga endpoints.
 */
function LinkAssetDialog({
  person,
  open,
  onOpenChange,
}: {
  person: ExecutorRegisterPerson;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [assetType, setAssetType] = useState<"vehicle" | "equipment">("vehicle");
  const [pendingAssetId, setPendingAssetId] = useState<string>("");

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
    enabled: open,
  });
  const { data: equipment = [] } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
    enabled: open,
  });

  const linkedVehicleIds = useMemo(
    () => new Set(person.vehicles.map(v => v.id)),
    [person.vehicles],
  );
  const linkedEquipmentIds = useMemo(
    () => new Set(person.equipment.map(e => e.id)),
    [person.equipment],
  );

  const reset = () => {
    setAssetType("vehicle");
    setPendingAssetId("");
  };

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (assetType === "vehicle") {
        await apiRequest("POST", `/api/resources/${person.id}/vehicles`, {
          vehicleId: pendingAssetId,
        });
      } else {
        await apiRequest("POST", `/api/resources/${person.id}/equipment`, {
          equipmentId: pendingAssetId,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
      toast({ title: assetType === "vehicle" ? "Fordon kopplat" : "Utrustning kopplad" });
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte koppla", description: err.message, variant: "destructive" });
    },
  });

  const options = assetType === "vehicle" ? vehicles : equipment;
  const linkedIds = assetType === "vehicle" ? linkedVehicleIds : linkedEquipmentIds;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent data-testid="dialog-link-asset">
        <DialogHeader>
          <DialogTitle>Koppla till {person.name}</DialogTitle>
          <DialogDescription>
            Välj ett fordon eller en utrustning som ska kopplas till personen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Typ</label>
            <Select
              value={assetType}
              onValueChange={v => {
                setAssetType(v as "vehicle" | "equipment");
                setPendingAssetId("");
              }}
            >
              <SelectTrigger data-testid="select-asset-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vehicle">Fordon</SelectItem>
                <SelectItem value="equipment">Utrustning</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">
              {assetType === "vehicle" ? "Fordon" : "Utrustning"}
            </label>
            <Select value={pendingAssetId} onValueChange={setPendingAssetId}>
              <SelectTrigger data-testid="select-asset-to-link">
                <SelectValue placeholder={`Välj ${assetType === "vehicle" ? "fordon" : "utrustning"}...`} />
              </SelectTrigger>
              <SelectContent>
                {options.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Inga tillgängliga</div>
                ) : (
                  options.map(o => {
                    const already = linkedIds.has(o.id);
                    return (
                      <SelectItem key={o.id} value={o.id} disabled={already}>
                        <span className="flex items-center gap-2">
                          {o.name}
                          {already && (
                            <span className="text-xs text-muted-foreground">- redan kopplad</span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            data-testid="button-cancel-link"
          >
            Avbryt
          </Button>
          <Button
            onClick={() => {
              if (!pendingAssetId) return;
              linkMutation.mutate();
            }}
            disabled={!pendingAssetId || linkMutation.isPending}
            data-testid="button-confirm-link"
          >
            {linkMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Koppla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonRow({ person, teamId }: { person: ExecutorRegisterPerson; teamId?: string }) {
  const { toast } = useToast();
  const [linkOpen, setLinkOpen] = useState(false);

  const removeFromTeamMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/team-member/${person.membershipId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
      toast({ title: "Person borttagen från team" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte ta bort", description: err.message, variant: "destructive" });
    },
  });

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
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setLinkOpen(true)}
              data-testid={`button-link-asset-${person.id}`}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Koppla
            </Button>
            {teamId && person.membershipId && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground"
                disabled={removeFromTeamMutation.isPending}
                onClick={() => removeFromTeamMutation.mutate()}
                title="Ta bort ur team"
                data-testid={`button-remove-member-${person.membershipId}`}
              >
                {removeFromTeamMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
      {(person.vehicles.length > 0 || person.equipment.length > 0) && (
        <div className="mt-2 grid gap-1.5 pl-9">
          {person.vehicles.map(v => (
            <AssetRow key={v.linkId ?? v.id} asset={v} allowUnlink />
          ))}
          {person.equipment.map(e => (
            <AssetRow key={e.linkId ?? e.id} asset={e} allowUnlink />
          ))}
        </div>
      )}
      <LinkAssetDialog person={person} open={linkOpen} onOpenChange={setLinkOpen} />
    </div>
  );
}

/**
 * Dialog för att lägga till en befintlig resurs som medlem i ett team. Skriver till
 * team_members via befintlig endpoint. Resurser som redan är med i teamet är inaktiva.
 */
function AddMemberDialog({
  team,
  open,
  onOpenChange,
}: {
  team: ExecutorRegisterTeam;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [pendingResourceId, setPendingResourceId] = useState<string>("");
  const [pendingRole, setPendingRole] = useState<string>("medlem");

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
    enabled: open,
  });

  const memberResourceIds = useMemo(
    () => new Set(team.members.map(m => m.id)),
    [team.members],
  );
  const activeResources = useMemo(
    () => resources.filter(r => r.status === "active"),
    [resources],
  );

  const reset = () => {
    setPendingResourceId("");
    setPendingRole("medlem");
  };

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/team-members/${team.id}`, {
        resourceId: pendingResourceId,
        role: pendingRole,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
      toast({ title: "Person tillagd i team" });
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte lägga till", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent data-testid="dialog-add-member">
        <DialogHeader>
          <DialogTitle>Lägg till person i {team.name}</DialogTitle>
          <DialogDescription>
            Välj vilken person som ska tillhöra teamet. En person kan tillhöra flera team.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Person</label>
            <Select value={pendingResourceId} onValueChange={setPendingResourceId}>
              <SelectTrigger data-testid="select-resource-to-add">
                <SelectValue placeholder="Välj person..." />
              </SelectTrigger>
              <SelectContent>
                {activeResources.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Inga personer</div>
                ) : (
                  activeResources.map(r => {
                    const inThisTeam = memberResourceIds.has(r.id);
                    return (
                      <SelectItem key={r.id} value={r.id} disabled={inThisTeam}>
                        <span className="flex items-center gap-2">
                          {r.name}
                          {inThisTeam && (
                            <span className="text-xs text-muted-foreground">- redan med</span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Roll</label>
            <Select value={pendingRole} onValueChange={setPendingRole}>
              <SelectTrigger data-testid="select-role-to-add">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            data-testid="button-cancel-add"
          >
            Avbryt
          </Button>
          <Button
            onClick={() => {
              if (!pendingResourceId) return;
              addMemberMutation.mutate();
            }}
            disabled={!pendingResourceId || addMemberMutation.isPending}
            data-testid="button-confirm-add"
          >
            {addMemberMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Lägg till
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamCard({ team }: { team: ExecutorRegisterTeam }) {
  const [addOpen, setAddOpen] = useState(false);
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
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setAddOpen(true)}
              data-testid={`button-add-member-${team.id}`}
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Lägg till medlem
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {team.members.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Inga medlemmar än</p>
        ) : (
          team.members.map(m => <PersonRow key={m.membershipId ?? m.id} person={m} teamId={team.id} />)
        )}
      </CardContent>
      <AddMemberDialog team={team} open={addOpen} onOpenChange={setAddOpen} />
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
            En samlad vy: personer, fordon/utrustning och team som en enhet. Lägg till eller ta bort
            medlemmar och koppla fordon/utrustning direkt här — kostnadsställe och projekt följer med
            till genererade uppgifter.
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
