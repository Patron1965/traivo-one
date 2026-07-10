import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Cog, Boxes, Route as RouteIcon, CalendarClock, Clock, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface EngineConfigValues {
  groupingRadiusMeters: number | null;
  streetSideGrouping: boolean | null;
  workPacePercent: number | null;
  dailyCapacityMinutes: number | null;
  speedCapKmh: number | null;
  travelTimeFactor: number | null;
  productionTimeFactor: number | null;
  winterFactor: number | null;
  winterStart: string | null;
  winterEnd: string | null;
  costPerKmOre: number | null;
  co2KgPerKm: number | null;
  defaultSpeedKmh: number | null;
  nightRestMinMinutes: number | null;
  weekendRestMinMinutes: number | null;
  travelShareThreshold: number | null;
  defaultContractedHours: number | null;
}

interface EngineConfigResponse {
  id: string | null;
  values: EngineConfigValues;
  defaults: EngineConfigValues;
}

type FieldKey = keyof EngineConfigValues;

function toFormState(values: EngineConfigValues): Record<FieldKey, string | boolean | null> {
  const result = {} as Record<FieldKey, string | boolean | null>;
  (Object.keys(values) as FieldKey[]).forEach((key) => {
    const v = values[key];
    result[key] = typeof v === "boolean" ? v : v === null || v === undefined ? "" : String(v);
  });
  return result;
}

interface NumberFieldProps {
  fieldKey: FieldKey;
  label: string;
  description: string;
  unit?: string;
  step?: string;
  value: string | boolean | null;
  placeholder: number | null;
  onChange: (key: FieldKey, value: string) => void;
}

function NumberField({ fieldKey, label, description, unit, step, value, placeholder, onChange }: NumberFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`field-${fieldKey}`}>{label}{unit ? ` (${unit})` : ""}</Label>
      <Input
        id={`field-${fieldKey}`}
        data-testid={`input-${fieldKey}`}
        type="number"
        step={step ?? "1"}
        value={typeof value === "string" ? value : ""}
        placeholder={placeholder !== null ? `Motor-default: ${placeholder}` : "Ej satt"}
        onChange={(e) => onChange(fieldKey, e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

interface EngineSectionProps {
  icon: typeof Cog;
  title: string;
  description: string;
  children: React.ReactNode;
  linkTo?: { url: string; label: string };
}

function EngineSection({ icon: Icon, title, description, children, linkTo }: EngineSectionProps) {
  return (
    <Card data-testid={`card-section-${title}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-[#1B4B6B] dark:text-[#4A9B9B]" />
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
          {linkTo && (
            <Link href={linkTo.url}>
              <Button variant="outline" size="sm" data-testid={`link-${linkTo.url}`}>
                {linkTo.label}
                <ExternalLink className="h-3.5 w-3.5 ml-2" />
              </Button>
            </Link>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export default function EngineAdminPage() {
  const { toast } = useToast();
  const [form, setForm] = useState<Record<FieldKey, string | boolean | null> | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<EngineConfigResponse>({
    queryKey: ["/api/engine-config"],
  });

  useEffect(() => {
    if (data) setForm(toFormState(data.values));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("PUT", "/api/engine-config", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/engine-config"] });
      toast({ title: "Sparat", description: "Motorinställningarna har uppdaterats." });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  const handleChange = (key: FieldKey, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleToggle = (key: FieldKey, checked: boolean) => {
    setForm((prev) => (prev ? { ...prev, [key]: checked } : prev));
  };

  const handleSave = () => {
    if (!form) return;
    const payload: Record<string, unknown> = {};
    (Object.keys(form) as FieldKey[]).forEach((key) => {
      const v = form[key];
      if (typeof v === "boolean") {
        payload[key] = v;
      } else if (v === "" || v === null || v === undefined) {
        payload[key] = null;
      } else if (key === "winterStart" || key === "winterEnd") {
        payload[key] = v;
      } else {
        payload[key] = Number(v);
      }
    });
    saveMutation.mutate(payload);
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-engine-admin">
      <PageHeader
        icon={Cog}
        title="Motor- & regeladministration"
        description="Konfigurera parametrar för klumpmotorn, restidsmotorn, tidstypsregistret och planeringsmotorn — utan kodändring. Tomt fält = motorns inbyggda default (visas som platshållare)."
        testId="text-page-title"
      >
        <Button onClick={handleSave} disabled={!form || saveMutation.isPending} data-testid="button-save-engine-config">
          {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Spara ändringar
        </Button>
      </PageHeader>

      <QueryState
        isLoading={isLoading || !form}
        isError={isError}
        isEmpty={false}
        error={error}
        onRetry={() => refetch()}
      >
        {form && data && (
          <div className="space-y-6">
            <EngineSection
              icon={Boxes}
              title="Klumpmotor"
              description="Grupperingsradie, gatusidesberoende och arbetstakt för automatisk klumpning av oplanerade uppgifter. Team-profiler (Utförarregister) vinner alltid över dessa tenant-defaults."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField
                  fieldKey="groupingRadiusMeters"
                  label="Grupperingsradie"
                  unit="meter"
                  description="Avstånd inom vilket uppgifter utan gatuadress klumpas ihop geografiskt."
                  value={form.groupingRadiusMeters}
                  placeholder={data.defaults.groupingRadiusMeters}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="dailyCapacityMinutes"
                  label="Daglig kapacitet"
                  unit="minuter"
                  description="Maximal arbetstid per dag och resurs som klumpmotorn planerar mot."
                  value={form.dailyCapacityMinutes}
                  placeholder={data.defaults.dailyCapacityMinutes}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="workPacePercent"
                  label="Arbetstakt"
                  unit="%"
                  step="1"
                  description="Justerar produktionstider relativt standardtakten (100% = normal takt)."
                  value={form.workPacePercent}
                  placeholder={data.defaults.workPacePercent}
                  onChange={handleChange}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="field-streetSideGrouping">Gatusidesberoende gruppering</Label>
                  <div className="flex items-center gap-2 h-9">
                    <Switch
                      id="field-streetSideGrouping"
                      data-testid="switch-streetSideGrouping"
                      checked={form.streetSideGrouping === true}
                      onCheckedChange={(checked) => handleToggle("streetSideGrouping", checked)}
                    />
                    <span className="text-sm text-muted-foreground">
                      {form.streetSideGrouping === true ? "På" : form.streetSideGrouping === false ? "Av" : `Ej satt (default: ${data.defaults.streetSideGrouping ? "På" : "Av"})`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Klumpar bara ihop uppgifter på samma sida av gatan.</p>
                </div>
              </div>
            </EngineSection>

            <EngineSection
              icon={RouteIcon}
              title="Restidsmotor"
              description="Hastighetstak, tidsfaktorer och vinterjustering för restidsberäkning. Team-profiler vinner alltid över dessa tenant-defaults."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField
                  fieldKey="speedCapKmh"
                  label="Hastighetstak"
                  unit="km/h"
                  description="Tak på medelfart som restidsmotorn får räkna med."
                  value={form.speedCapKmh}
                  placeholder={data.defaults.speedCapKmh}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="travelTimeFactor"
                  label="Restidsfaktor"
                  step="0.01"
                  description="Multiplikator på beräknad restid (1.0 = ingen justering)."
                  value={form.travelTimeFactor}
                  placeholder={data.defaults.travelTimeFactor}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="productionTimeFactor"
                  label="Produktionstidsfaktor"
                  step="0.01"
                  description="Multiplikator på beräknad produktionstid."
                  value={form.productionTimeFactor}
                  placeholder={data.defaults.productionTimeFactor}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="winterFactor"
                  label="Vinterfaktor"
                  step="0.01"
                  description="Multiplikator som appliceras under vinterperioden nedan."
                  value={form.winterFactor}
                  placeholder={data.defaults.winterFactor}
                  onChange={handleChange}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="field-winterStart">Vinterperiod start</Label>
                  <Input
                    id="field-winterStart"
                    data-testid="input-winterStart"
                    value={typeof form.winterStart === "string" ? form.winterStart : ""}
                    placeholder="MM-DD, t.ex. 11-01"
                    onChange={(e) => handleChange("winterStart", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="field-winterEnd">Vinterperiod slut</Label>
                  <Input
                    id="field-winterEnd"
                    data-testid="input-winterEnd"
                    value={typeof form.winterEnd === "string" ? form.winterEnd : ""}
                    placeholder="MM-DD, t.ex. 03-31"
                    onChange={(e) => handleChange("winterEnd", e.target.value)}
                  />
                </div>
              </div>
            </EngineSection>

            <EngineSection
              icon={Clock}
              title="Tidstypsregister"
              description="Tidskoder (grupp, prioritet och ikon) hanteras i ett eget register med fullständig CRUD."
              linkTo={{ url: "/time-codes", label: "Öppna tidskoder" }}
            >
              <p className="text-sm text-muted-foreground">
                Tidstypsregistret har redan en dedikerad admin-yta för att skapa, döpa om och arkivera tidskoder. Denna sida länkar dit istället för att duplicera funktionaliteten.
              </p>
            </EngineSection>

            <EngineSection
              icon={CalendarClock}
              title="Planeringsmotor"
              description="Kostnads-, vilotids- och kontraktsparametrar som planeringsmotorn använder vid veckoplan-beräkning. Ett veckoplans egna metadata-inställningar vinner alltid över dessa tenant-defaults."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField
                  fieldKey="costPerKmOre"
                  label="Kostnad per km"
                  unit="öre"
                  description="Uppskattad körkostnad per kilometer, används i planeringens kostnadsberäkning."
                  value={form.costPerKmOre}
                  placeholder={data.defaults.costPerKmOre}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="co2KgPerKm"
                  label="CO2-utsläpp"
                  unit="kg/km"
                  step="0.01"
                  description="Uppskattat utsläpp per kilometer för hållbarhetsrapportering."
                  value={form.co2KgPerKm}
                  placeholder={data.defaults.co2KgPerKm}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="defaultSpeedKmh"
                  label="Standardhastighet"
                  unit="km/h"
                  description="Antagen medelhastighet när ingen mer specifik data finns."
                  value={form.defaultSpeedKmh}
                  placeholder={data.defaults.defaultSpeedKmh}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="defaultContractedHours"
                  label="Standard avtalad arbetstid"
                  unit="timmar/vecka"
                  step="0.5"
                  description="Används som fallback när en resurs saknar avtalad veckoarbetstid."
                  value={form.defaultContractedHours}
                  placeholder={data.defaults.defaultContractedHours}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="nightRestMinMinutes"
                  label="Minsta nattvila"
                  unit="minuter"
                  description="Minsta vilotid mellan arbetspass under natt som planeringsmotorn respekterar."
                  value={form.nightRestMinMinutes}
                  placeholder={data.defaults.nightRestMinMinutes}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="weekendRestMinMinutes"
                  label="Minsta helgvila"
                  unit="minuter"
                  description="Minsta sammanhängande vilotid över helg."
                  value={form.weekendRestMinMinutes}
                  placeholder={data.defaults.weekendRestMinMinutes}
                  onChange={handleChange}
                />
                <NumberField
                  fieldKey="travelShareThreshold"
                  label="Restidsandel-tröskel"
                  step="0.01"
                  description="Andel av arbetstid (0–1) som restid får utgöra innan planen flaggas."
                  value={form.travelShareThreshold}
                  placeholder={data.defaults.travelShareThreshold}
                  onChange={handleChange}
                />
              </div>
            </EngineSection>

            <Separator />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Grund-uppgift #1234</Badge>
              <span>
                Denna sida exponerar generellt konfigurerbara motorparametrar. Djupare affärsregler (t.ex. klumpningslogik per orderkoncept eller planeringsregler) hanteras i separata uppföljande uppgifter.
              </span>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
