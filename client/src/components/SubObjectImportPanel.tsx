// Task #564: SubObjectImportPanel är nu en genväg till /import med parent förvald.
// Själva import-logiken bor numera i client/src/components/import/ChildObjectImportFlow.tsx
// så att paste- och fil-flödet är konsoliderat på samma plats som övriga importflöden.
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, FilePlus } from "lucide-react";

export function SubObjectImportPanel({ parentId }: { parentId: string }) {
  const target = `/import?mode=ongoing&tab=children&parent=${encodeURIComponent(parentId)}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FilePlus className="h-4 w-4" /> Importera underobjekt
        </CardTitle>
        <CardDescription>
          Paste- eller CSV-baserad import av underobjekt. Flödet bor i den centrala importsidan
          så att det fungerar likadant överallt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild data-testid="button-goto-child-import">
          <Link href={target}>
            Öppna i importera-data
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
