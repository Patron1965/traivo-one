import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Layers, ChevronRight, ChevronDown, Package, Settings2, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { type Article, type ArticleComponent } from "@shared/schema";

type StructureArticle = Article & { componentCount: number };
type StructureDetail = Article & { components: (ArticleComponent & { childArticle?: Article })[] };

function ComponentRows({ id }: { id: string }) {
  const { data, isLoading } = useQuery<StructureDetail>({
    queryKey: ["/api/structure-articles", id],
  });
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-sm text-muted-foreground py-4 px-12">
          Laddar komponenter…
        </TableCell>
      </TableRow>
    );
  }
  const components = data?.components ?? [];
  if (components.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-sm text-muted-foreground py-4 px-12">
          Inga komponenter i denna strukturartikel.
        </TableCell>
      </TableRow>
    );
  }
  return (
    <>
      {components.map((c) => (
        <TableRow key={c.id} className="bg-muted/30" data-testid={`row-structure-component-${c.id}`}>
          <TableCell className="pl-12">
            <span className="inline-flex items-center gap-2 text-sm">
              <Package className="h-3.5 w-3.5 text-chart-4" />
              {c.childArticle ? `${c.childArticle.articleNumber} – ${c.childArticle.name}` : c.childArticleId}
            </span>
          </TableCell>
          <TableCell className="text-sm tabular-nums">{c.quantity}{c.quantityFormula ? ` (${c.quantityFormula})` : ""}</TableCell>
          <TableCell className="text-sm">
            {c.isMandatory ? <Badge variant="default">Obligatorisk</Badge> : <Badge variant="secondary">Valfri</Badge>}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">{c.reportingMetadataField ?? "—"}</TableCell>
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

export default function StructureArticlesPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const { data: structures = [], isLoading, isError, error, refetch } = useQuery<StructureArticle[]>({
    queryKey: ["/api/structure-articles"],
  });

  const filtered = structures.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.articleNumber.toLowerCase().includes(q);
  });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex flex-col gap-4 mb-6">
        <PageHeader
          icon={Layers}
          title="Strukturartikelregister"
          description="Strukturartiklar (paket av komponenter). Expandera en rad för att se ingående komponenter. Komponenter hanteras under Artikelkomponenter."
          testId="text-structure-articles-title"
        >
          <Link href="/article-components">
            <Button variant="outline" data-testid="button-manage-components">
              <Settings2 className="h-4 w-4 mr-2" />
              Hantera komponenter
            </Button>
          </Link>
        </PageHeader>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök strukturartikel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-structure"
          />
        </div>
      </div>

      <Card className="flex-1">
        <CardContent className="p-0">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            isEmpty={filtered.length === 0}
            error={error as any}
            onRetry={refetch}
            loadingVariant="skeleton-rows"
            emptyTitle="Inga strukturartiklar"
            emptyDescription="Markera en artikel som strukturartikel i artikelregistret för att den ska visas här."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artikel</TableHead>
                  <TableHead>Komponenter</TableHead>
                  <TableHead>Rapporteringstyp</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const isOpen = expanded.has(s.id);
                  return (
                    <>
                      <TableRow
                        key={s.id}
                        className="cursor-pointer"
                        onClick={() => toggle(s.id)}
                        data-testid={`row-structure-${s.id}`}
                      >
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <Layers className="h-4 w-4 text-chart-1" />
                            {s.articleNumber} – {s.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" data-testid={`badge-component-count-${s.id}`}>
                            {s.componentCount} st
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {(s as any).reportingType ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={s.status === "active" ? "default" : "secondary"}>
                            {s.status === "active" ? "Aktiv" : s.status ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell />
                      </TableRow>
                      {isOpen && <ComponentRows id={s.id} />}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
