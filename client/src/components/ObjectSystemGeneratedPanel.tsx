import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronDown,
  ClipboardList,
  Star,
  AlertTriangle,
  Loader2,
  Cog,
  MapPin,
  MapPinned,
  Navigation,
  Target,
  CalendarClock,
  Image as ImageIcon,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  isValidWhat3words,
  normalizeWhat3words,
  WHAT3WORDS_FORMAT_ERROR,
} from "@shared/what3words";

// Task #1085: Systemgenererad metadata-vy. Ersätter de gamla
// "Ordrar/Rating/Felanmälningar"-sektionerna och samlar de systemgenererade
// (read-only, "låsta mot manuell krock") fälten i objektets metadata-modell.
// Allt backas av verklig data (kolumner / live-compute / relaterade tabeller) —
// inget fabriceras. Varje grupp märks tydligt som "Systemgenererad".

interface SystemAddressGroup {
  gatuadress: string | null;
  postnummer: string | null;
  ort: string | null;
}
interface SystemPositionGroup {
  latitude: number | null;
  longitude: number | null;
  entranceLatitude: number | null;
  entranceLongitude: number | null;
  locationType: string | null;
  geocoded: boolean;
  what3words: string | null;
}
interface PointedInConcept {
  id: string;
  name: string;
  status: string | null;
  invoiceModel: string | null;
  customerId: string | null;
  customerName: string | null;
}
interface SystemTaskHistory {
  id: string;
  title: string | null;
  status: string | null;
  orderStatus: string | null;
  scheduledDate: string | null;
  lineCount: number;
}
interface SystemTaskFuture {
  id: string;
  title: string | null;
  status: string | null;
  priority: string | null;
  scheduledDate: string | null;
  quantity: number | null;
  orderConceptId: string | null;
  orderConceptName: string | null;
  customerId: string | null;
  customerName: string | null;
}
interface SystemImage {
  id: string;
  imageUrl: string;
  description: string | null;
  imageType: string | null;
  imageDate: string | null;
}
interface SystemIssueReport {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  status: string | null;
  photos: string[] | null;
  createdAt: string | null;
}
interface SystemRating {
  id: string;
  workOrderId: string | null;
  resourceName: string | null;
  rating: number;
  comment: string | null;
  createdAt: string | null;
}
interface SystemGeneratedMetadata {
  address: SystemAddressGroup;
  position: SystemPositionGroup;
  pointedInConcepts: PointedInConcept[];
  tasksHistory: SystemTaskHistory[];
  tasksFuture: SystemTaskFuture[];
  images: SystemImage[];
  issueReports: SystemIssueReport[];
  ratings: SystemRating[];
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("sv-SE") : null;

/** Read-only "Systemgenererad"-märkning (samma semantik som MetadataSourceBadge). */
function SystemBadge({ locked }: { locked?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="text-[10px] cursor-help inline-flex items-center gap-1"
          data-testid="badge-systemgenererad"
        >
          <Cog className="h-3 w-3" /> Systemgenererad
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {locked
          ? "Automatiskt satt av systemet — låst mot manuell ändring"
          : "Automatiskt satt av systemet"}
      </TooltipContent>
    </Tooltip>
  );
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  testId: string;
  children: React.ReactNode;
  locked?: boolean;
  defaultOpen?: boolean;
}

function Section({ title, icon, count, testId, children, locked, defaultOpen }: SectionProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        data-testid={`trigger-${testId}`}
      >
        <span className="flex items-center gap-2 font-medium min-w-0">
          {icon}
          <span className="truncate">{title}</span>
          {typeof count === "number" && (
            <Badge variant="secondary" className="text-xs shrink-0">
              {count}
            </Badge>
          )}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <SystemBadge locked={locked} />
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-1 py-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Empty({ text, testId }: { text: string; testId: string }) {
  return (
    <p className="text-sm text-muted-foreground px-2" data-testid={testId}>
      {text}
    </p>
  );
}

function Field({ label, value, testId }: { label: string; value: React.ReactNode; testId: string }) {
  return (
    <div
      className="flex items-center justify-between gap-2 text-sm px-2 py-1"
      data-testid={testId}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-words">{value ?? "—"}</span>
    </div>
  );
}

// Task #1110: What3words är ett SEKUNDÄRT, manuellt redigerbart platsfält
// (icke-system metadata). Egen sektion med inline-editering.
function What3wordsSection({
  objectId,
  value,
}: {
  objectId: string;
  value: string | null;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);

  const trimmedDraft = draft.trim();
  // Task #1118: spegla serverns formatvalidering inline. Tomt = giltigt (rensar).
  const formatInvalid = trimmedDraft.length > 0 && !isValidWhat3words(trimmedDraft);

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      const res = await apiRequest("POST", `/api/objects/${objectId}/what3words`, {
        what3words: next,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/objects", objectId, "system-generated-metadata"],
      });
      setEditing(false);
      setError(null);
      toast({ title: "What3words sparad" });
    },
    onError: (err: Error) => {
      setError(err.message || WHAT3WORDS_FORMAT_ERROR);
    },
  });

  const handleSave = () => {
    const next = trimmedDraft ? normalizeWhat3words(trimmedDraft) : "";
    if (next && !isValidWhat3words(next)) {
      setError(WHAT3WORDS_FORMAT_ERROR);
      return;
    }
    setError(null);
    mutation.mutate(next);
  };

  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger
        className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        data-testid="trigger-system-what3words"
      >
        <span className="flex items-center gap-2 font-medium min-w-0">
          <MapPinned className="h-4 w-4" />
          <span className="truncate">What3words</span>
        </span>
        <ChevronDown className="h-4 w-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-1 py-2">
        {editing ? (
          <div className="px-2 py-1">
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !formatInvalid && !mutation.isPending) {
                    handleSave();
                  }
                }}
                placeholder="t.ex. filled.count.soap"
                className="h-8"
                aria-invalid={formatInvalid || !!error}
                data-testid="input-what3words"
              />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={mutation.isPending || formatInvalid}
                data-testid="button-save-what3words"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Spara"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(value ?? "");
                  setError(null);
                  setEditing(false);
                }}
                disabled={mutation.isPending}
                data-testid="button-cancel-what3words"
              >
                Avbryt
              </Button>
            </div>
            {(formatInvalid || error) && (
              <p
                className="mt-1 text-xs text-destructive"
                data-testid="error-what3words"
              >
                {error ?? WHAT3WORDS_FORMAT_ERROR}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span
              className="text-sm font-medium break-words"
              data-testid="text-what3words"
            >
              {value ?? "—"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(value ?? "");
                setEditing(true);
              }}
              data-testid="button-edit-what3words"
            >
              {value ? "Ändra" : "Lägg till"}
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface Props {
  objectId: string;
}

export function ObjectSystemGeneratedPanel({ objectId }: Props) {
  const { data, isLoading } = useQuery<SystemGeneratedMetadata>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" data-testid="loading-system-generated">
        <Loader2 className="h-4 w-4 animate-spin" /> Laddar systemgenererad metadata...
      </div>
    );
  }

  const { address, position, pointedInConcepts, tasksHistory, tasksFuture, images, issueReports, ratings } = data;
  const hasAddress = !!(address.gatuadress || address.postnummer || address.ort);

  return (
    <div className="space-y-2" data-testid="panel-system-generated">
      <p className="text-xs text-muted-foreground px-1">
        Systemgenererade fält härleds automatiskt från objektets data och är skrivskyddade.
      </p>

      <Section
        title="Adress"
        icon={<MapPin className="h-4 w-4" />}
        testId="system-address"
        locked
        defaultOpen
      >
        {!hasAddress ? (
          <Empty text="Ingen adress registrerad." testId="text-no-address" />
        ) : (
          <div>
            <Field label="Gatuadress" value={address.gatuadress} testId="field-gatuadress" />
            <Field label="Postnummer" value={address.postnummer} testId="field-postnummer" />
            <Field label="Ort" value={address.ort} testId="field-ort" />
          </div>
        )}
      </Section>

      <Section
        title="Geokodad position"
        icon={<Navigation className="h-4 w-4" />}
        testId="system-position"
        locked
      >
        {!position.geocoded ? (
          <Empty text="Ej geokodad." testId="text-no-position" />
        ) : (
          <div>
            <Field
              label="Latitud"
              value={position.latitude != null ? position.latitude.toFixed(6) : null}
              testId="field-latitude"
            />
            <Field
              label="Longitud"
              value={position.longitude != null ? position.longitude.toFixed(6) : null}
              testId="field-longitude"
            />
            {position.entranceLatitude != null && position.entranceLongitude != null && (
              <Field
                label="Entré"
                value={`${position.entranceLatitude.toFixed(6)}, ${position.entranceLongitude.toFixed(6)}`}
                testId="field-entrance"
              />
            )}
            {position.locationType && (
              <Field label="Platstyp" value={position.locationType} testId="field-location-type" />
            )}
          </div>
        )}
      </Section>

      <What3wordsSection objectId={objectId} value={position.what3words} />

      <Section
        title="Inpekade orderkoncept"
        icon={<Target className="h-4 w-4" />}
        count={pointedInConcepts.length}
        testId="system-concepts"
      >
        {pointedInConcepts.length === 0 ? (
          <Empty text="Inga orderkoncept pekar in på detta objekt." testId="text-no-concepts" />
        ) : (
          <ul className="space-y-1">
            {pointedInConcepts.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent"
                data-testid={`row-concept-${c.id}`}
              >
                <span className="truncate">
                  {c.name}
                  {c.customerName && (
                    <span className="text-xs text-muted-foreground"> · {c.customerName}</span>
                  )}
                </span>
                <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  {c.invoiceModel && <Badge variant="outline" className="text-xs">{c.invoiceModel}</Badge>}
                  {c.status && <Badge variant="secondary" className="text-xs">{c.status}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Kopplade uppgifter (historik)"
        icon={<ClipboardList className="h-4 w-4" />}
        count={tasksHistory.length}
        testId="system-tasks-history"
      >
        {tasksHistory.length === 0 ? (
          <Empty text="Inga utförda/skapade uppgifter." testId="text-no-tasks-history" />
        ) : (
          <ul className="space-y-1">
            {tasksHistory.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent"
                data-testid={`row-task-history-${o.id}`}
              >
                <span className="truncate">{o.title || "Uppgift"}</span>
                <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  {o.lineCount > 0 && <span className="text-xs">{o.lineCount} rader</span>}
                  {fmtDate(o.scheduledDate) && <span className="text-xs">{fmtDate(o.scheduledDate)}</span>}
                  {o.orderStatus && <Badge variant="outline" className="text-xs">{o.orderStatus}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Kopplade uppgifter (kommande)"
        icon={<CalendarClock className="h-4 w-4" />}
        count={tasksFuture.length}
        testId="system-tasks-future"
      >
        {tasksFuture.length === 0 ? (
          <Empty text="Inga planerade uppgifter." testId="text-no-tasks-future" />
        ) : (
          <ul className="space-y-1">
            {tasksFuture.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent"
                data-testid={`row-task-future-${a.id}`}
              >
                <span className="truncate">
                  {a.title || "Uppgift"}
                  {a.orderConceptName && (
                    <span className="text-xs text-muted-foreground"> · {a.orderConceptName}</span>
                  )}
                </span>
                <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  {fmtDate(a.scheduledDate) && <span className="text-xs">{fmtDate(a.scheduledDate)}</span>}
                  {a.status && <Badge variant="outline" className="text-xs">{a.status}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Bilder"
        icon={<ImageIcon className="h-4 w-4" />}
        count={images.length}
        testId="system-images"
      >
        {images.length === 0 ? (
          <Empty text="Inga bilder." testId="text-no-images" />
        ) : (
          <div className="grid grid-cols-3 gap-2 px-1">
            {images.map((img) => (
              <a
                key={img.id}
                href={img.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square overflow-hidden rounded border hover:opacity-90"
                data-testid={`img-system-${img.id}`}
                title={img.description || undefined}
              >
                <img src={img.imageUrl} alt={img.description || "Objektbild"} className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Felanmälningar"
        icon={<AlertTriangle className="h-4 w-4" />}
        count={issueReports.length}
        testId="system-issues"
      >
        {issueReports.length === 0 ? (
          <Empty text="Inga felanmälningar." testId="text-no-issues" />
        ) : (
          <ul className="space-y-1">
            {issueReports.map((it) => (
              <li
                key={it.id}
                className="flex items-start justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent"
                data-testid={`row-issue-${it.id}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{it.title || it.description || "Felanmälan"}</span>
                  {it.category && <span className="block text-xs text-muted-foreground">{it.category}</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  {it.status && <Badge variant="outline" className="text-xs">{it.status}</Badge>}
                  {fmtDate(it.createdAt) && <span className="text-xs">{fmtDate(it.createdAt)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Betyg"
        icon={<Star className="h-4 w-4" />}
        count={ratings.length}
        testId="system-ratings"
      >
        {ratings.length === 0 ? (
          <Empty text="Inga betyg." testId="text-no-ratings" />
        ) : (
          <ul className="space-y-1">
            {ratings.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent"
                data-testid={`row-rating-${r.id}`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${i < r.rating ? "fill-warning text-warning" : "text-muted-foreground"}`}
                      />
                    ))}
                    {r.resourceName && (
                      <span className="text-xs text-muted-foreground ml-1 truncate">{r.resourceName}</span>
                    )}
                  </span>
                  {r.comment && <span className="block text-xs text-muted-foreground truncate">{r.comment}</span>}
                </span>
                {fmtDate(r.createdAt) && (
                  <span className="text-xs text-muted-foreground shrink-0">{fmtDate(r.createdAt)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
