import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ClipboardList,
  Star,
  AlertTriangle,
  Loader2,
  Cog,
  Building,
  MapPin,
  Navigation as NavigationIcon,
  Target,
  CalendarClock,
  CircleSlash,
  Image as ImageIcon,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
interface SystemUnperformedTask {
  id: string;
  title: string | null;
  reasonCode: string | null;
  reason: string | null;
  reasonText: string | null;
  impossibleAt: string | null;
  executionCode: string | null;
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
  propertyOwner: string | null;
  pointedInConcepts: PointedInConcept[];
  tasksHistory: SystemTaskHistory[];
  tasksFuture: SystemTaskFuture[];
  unperformedTasks: SystemUnperformedTask[];
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
  isEmpty?: boolean;
}

function Section({ title, icon, count, testId, children, locked, defaultOpen, isEmpty }: SectionProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  // Fas 2 (Task #1128): systemgenererade grupper visas endast "i det förekommande
  // fall" — utan värde renderas ingen sektion alls (ingen tom "Inga …"-rad).
  if (isEmpty) return null;
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

  // Defensivt: defaulta alla list-/objektfält så en avvikande API-payload
  // (t.ex. äldre serverversion) inte kraschar hela panelen med
  // "Cannot read properties of undefined".
  const {
    address = {} as SystemGeneratedMetadata["address"],
    position = { geocoded: false } as SystemGeneratedMetadata["position"],
    propertyOwner,
    pointedInConcepts = [],
    tasksHistory = [],
    tasksFuture = [],
    unperformedTasks = [],
    images = [],
    issueReports = [],
    ratings = [],
  } = data;
  const hasAddress = !!(address?.gatuadress || address?.postnummer || address?.ort);

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
        isEmpty={!hasAddress}
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
        icon={<NavigationIcon className="h-4 w-4" />}
        testId="system-position"
        locked
        isEmpty={!position.geocoded}
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

      <Section
        title="Fastighetsägare"
        icon={<Building className="h-4 w-4" />}
        testId="system-property-owner"
        isEmpty={!propertyOwner}
      >
        <Field label="Fastighetsägare" value={propertyOwner} testId="field-property-owner" />
      </Section>

      <Section
        title="Inpekade orderkoncept"
        icon={<Target className="h-4 w-4" />}
        count={pointedInConcepts.length}
        testId="system-concepts"
        isEmpty={pointedInConcepts.length === 0}
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
        isEmpty={tasksHistory.length === 0}
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
        isEmpty={tasksFuture.length === 0}
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

      {/* Task #1155 (Feature G): Ej-utförda uppgifter ("kunde ej utföras") */}
      <Section
        title="Ej-utförda uppgifter"
        icon={<CircleSlash className="h-4 w-4 text-destructive" />}
        count={unperformedTasks.length}
        testId="system-unperformed"
        isEmpty={unperformedTasks.length === 0}
      >
        {unperformedTasks.length === 0 ? (
          <Empty text="Inga ej-utförda uppgifter." testId="text-no-unperformed" />
        ) : (
          <ul className="space-y-1">
            {unperformedTasks.map((u) => (
              <li
                key={u.id}
                className="flex items-start justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent"
                data-testid={`row-unperformed-${u.id}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{u.title || "Uppgift"}</span>
                  {u.reasonText && (
                    <span className="block text-xs text-muted-foreground truncate">{u.reasonText}</span>
                  )}
                </span>
                <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  {u.reason && <Badge variant="destructive" className="text-xs">{u.reason}</Badge>}
                  {fmtDate(u.impossibleAt) && <span className="text-xs">{fmtDate(u.impossibleAt)}</span>}
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
        isEmpty={images.length === 0}
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
        isEmpty={issueReports.length === 0}
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
        isEmpty={ratings.length === 0}
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
