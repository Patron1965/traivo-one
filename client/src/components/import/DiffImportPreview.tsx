import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  FilePlus,
  Pencil,
  Ban,
} from "lucide-react";

export interface DiffFieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface DiffCreatedRow {
  row: number;
  objectNumber: string;
  name: string;
  customerName: string;
  hierarchyLevel: string;
  parentObjectNumber: string;
  address: string;
  city: string;
  postalCode: string;
  notes: string;
}

export interface DiffUpdatedRow {
  id: string;
  objectNumber: string | null;
  name: string;
  customerName: string;
  fieldDiffs: DiffFieldChange[];
}

export interface DiffMissingRow {
  id: string;
  objectNumber: string | null;
  name: string;
  customerName: string;
}

export interface DiffImportPreviewData {
  totals: {
    totalUploaded: number;
    totalCurrent: number;
    created: number;
    updated: number;
    missing: number;
    unchanged: number;
    errors: number;
  };
  created: DiffCreatedRow[];
  updated: DiffUpdatedRow[];
  missing: DiffMissingRow[];
  errors: Array<{ row: number; message: string }>;
  safety?: {
    numberedCurrent: number;
    matchedNumbered: number;
    matchRatio: number;
    suspectedPartialUpload: boolean;
  };
}

interface Props {
  data: DiffImportPreviewData;
  applyCreate: boolean;
  applyUpdate: boolean;
  applyMissing: boolean;
  onChangeApply: (next: {
    applyCreate: boolean;
    applyUpdate: boolean;
    applyMissing: boolean;
  }) => void;
  testId?: string;
}

export function DiffImportPreview({
  data,
  applyCreate,
  applyUpdate,
  applyMissing,
  onChangeApply,
  testId = "diff-import-preview",
}: Props) {
  const [openCreated, setOpenCreated] = useState(true);
  const [openUpdated, setOpenUpdated] = useState(true);
  const [openMissing, setOpenMissing] = useState(true);

  const previewLimit = 50;
  const createdShown = useMemo(
    () => data.created.slice(0, previewLimit),
    [data.created],
  );
  const updatedShown = useMemo(
    () => data.updated.slice(0, previewLimit),
    [data.updated],
  );
  const missingShown = useMemo(
    () => data.missing.slice(0, previewLimit),
    [data.missing],
  );

  return (
    <div className="space-y-4" data-testid={testId}>
      {/* Summering */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Diff-resultat
          </CardTitle>
          <CardDescription>
            {data.totals.totalUploaded} rader i filen, {data.totals.totalCurrent} objekt i Traivo.
            Inget skrivs förrän du bekräftar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className="border-chart-2/40 text-chart-2"
              data-testid={`${testId}-badge-created`}
            >
              {data.totals.created} nya
            </Badge>
            <Badge
              variant="outline"
              className="border-warning/40 text-warning"
              data-testid={`${testId}-badge-updated`}
            >
              {data.totals.updated} ändrade
            </Badge>
            <Badge
              variant="outline"
              className="border-destructive/40 text-destructive"
              data-testid={`${testId}-badge-missing`}
            >
              {data.totals.missing} saknade
            </Badge>
            <Badge variant="secondary" data-testid={`${testId}-badge-unchanged`}>
              {data.totals.unchanged} oförändrade
            </Badge>
            {data.totals.errors > 0 && (
              <Badge variant="destructive" data-testid={`${testId}-badge-errors`}>
                {data.totals.errors} fel
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {data.errors.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Fel i filen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="max-h-40 overflow-y-auto text-xs space-y-1"
              data-testid={`${testId}-errors-list`}
            >
              {data.errors.slice(0, 50).map((e, i) => (
                <div key={i} className="text-destructive">
                  Rad {e.row}: {e.message}
                </div>
              ))}
              {data.errors.length > 50 && (
                <div className="text-muted-foreground">
                  … och {data.errors.length - 50} fel till
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sektion: Nya rader */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <button
            type="button"
            className="flex items-center gap-2 text-left hover-elevate active-elevate-2 px-2 py-1 rounded"
            onClick={() => setOpenCreated((v) => !v)}
            data-testid={`${testId}-toggle-created`}
          >
            {openCreated ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <FilePlus className="h-4 w-4 text-chart-2" />
            <span className="font-medium">Nya rader ({data.created.length})</span>
          </button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={applyCreate}
              onCheckedChange={(v) =>
                onChangeApply({ applyCreate: !!v, applyUpdate, applyMissing })
              }
              data-testid={`${testId}-checkbox-apply-create`}
            />
            Skapa vid bekräftelse
          </label>
        </CardHeader>
        {openCreated && (
          <CardContent>
            {data.created.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga nya rader hittades.</p>
            ) : (
              <div className="border rounded-md overflow-x-auto">
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">Rad</TableHead>
                      <TableHead>objectNumber</TableHead>
                      <TableHead>Namn</TableHead>
                      <TableHead>Nivå</TableHead>
                      <TableHead>Parent</TableHead>
                      <TableHead>Kund</TableHead>
                      <TableHead>Adress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {createdShown.map((r) => (
                      <TableRow
                        key={`${r.row}-${r.objectNumber}-${r.name}`}
                        data-testid={`${testId}-row-created-${r.row}`}
                      >
                        <TableCell className="text-xs text-muted-foreground">{r.row}</TableCell>
                        <TableCell className="text-xs font-mono">{r.objectNumber}</TableCell>
                        <TableCell className="text-xs">{r.name}</TableCell>
                        <TableCell className="text-xs">{r.hierarchyLevel}</TableCell>
                        <TableCell className="text-xs font-mono">
                          {r.parentObjectNumber}
                        </TableCell>
                        <TableCell className="text-xs">{r.customerName}</TableCell>
                        <TableCell className="text-xs">
                          {[r.address, r.postalCode, r.city].filter(Boolean).join(", ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {data.created.length > previewLimit && (
                  <div className="p-2 text-xs text-muted-foreground border-t">
                    Visar {previewLimit} av {data.created.length} — bekräfta för att skapa alla.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Sektion: Ändrade rader */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <button
            type="button"
            className="flex items-center gap-2 text-left hover-elevate active-elevate-2 px-2 py-1 rounded"
            onClick={() => setOpenUpdated((v) => !v)}
            data-testid={`${testId}-toggle-updated`}
          >
            {openUpdated ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Pencil className="h-4 w-4 text-warning" />
            <span className="font-medium">Ändrade rader ({data.updated.length})</span>
          </button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={applyUpdate}
              onCheckedChange={(v) =>
                onChangeApply({ applyCreate, applyUpdate: !!v, applyMissing })
              }
              data-testid={`${testId}-checkbox-apply-update`}
            />
            Uppdatera vid bekräftelse
          </label>
        </CardHeader>
        {openUpdated && (
          <CardContent>
            {data.updated.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga ändrade rader hittades.</p>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {updatedShown.map((r) => (
                  <div
                    key={r.id}
                    className="border rounded-md p-3 bg-muted/30"
                    data-testid={`${testId}-row-updated-${r.id}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm">
                        <span className="font-medium">{r.name}</span>{" "}
                        {r.objectNumber && (
                          <span className="text-xs font-mono text-muted-foreground">
                            ({r.objectNumber})
                          </span>
                        )}
                        {r.customerName && (
                          <span className="text-xs text-muted-foreground ml-2">
                            — {r.customerName}
                          </span>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {r.fieldDiffs.length} fält
                      </Badge>
                    </div>
                    <Table density="compact">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[160px]">Fält</TableHead>
                          <TableHead>Före</TableHead>
                          <TableHead>Efter</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.fieldDiffs.map((d) => (
                          <TableRow key={d.field}>
                            <TableCell className="text-xs font-mono">{d.field}</TableCell>
                            <TableCell className="text-xs text-muted-foreground line-through">
                              {d.before ?? ""}
                            </TableCell>
                            <TableCell className="text-xs text-warning">
                              {d.after ?? ""}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
                {data.updated.length > previewLimit && (
                  <div className="text-xs text-muted-foreground">
                    Visar {previewLimit} av {data.updated.length} — bekräfta för att uppdatera alla.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Sektion: Saknade rader */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <button
            type="button"
            className="flex items-center gap-2 text-left hover-elevate active-elevate-2 px-2 py-1 rounded"
            onClick={() => setOpenMissing((v) => !v)}
            data-testid={`${testId}-toggle-missing`}
          >
            {openMissing ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Ban className="h-4 w-4 text-destructive" />
            <span className="font-medium">Saknade i filen ({data.missing.length})</span>
          </button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={applyMissing}
              onCheckedChange={(v) =>
                onChangeApply({ applyCreate, applyUpdate, applyMissing: !!v })
              }
              data-testid={`${testId}-checkbox-apply-missing`}
            />
            Markera för granskning
          </label>
        </CardHeader>
        {openMissing && (
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2">
              Saknade rader raderas <strong>aldrig</strong> automatiskt — de markeras endast med en
              reconciliation-flagga så ni kan granska manuellt (t.ex. sålda eller stängda butiker).
            </p>
            {data.missing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Alla nuvarande objekt finns även i filen.
              </p>
            ) : (
              <div className="border rounded-md overflow-x-auto">
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>objectNumber</TableHead>
                      <TableHead>Namn</TableHead>
                      <TableHead>Kund</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missingShown.map((r) => (
                      <TableRow key={r.id} data-testid={`${testId}-row-missing-${r.id}`}>
                        <TableCell className="text-xs font-mono">
                          {r.objectNumber ?? ""}
                        </TableCell>
                        <TableCell className="text-xs">{r.name}</TableCell>
                        <TableCell className="text-xs">{r.customerName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {data.missing.length > previewLimit && (
                  <div className="p-2 text-xs text-muted-foreground border-t">
                    Visar {previewLimit} av {data.missing.length}.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
