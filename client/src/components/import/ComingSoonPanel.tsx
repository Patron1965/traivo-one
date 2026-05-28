import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

export function ComingSoonPanel({
  title,
  description,
  bullets,
  testId,
}: {
  title: string;
  description: string;
  bullets?: string[];
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="outline" className="ml-auto text-xs">Kommer snart</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {bullets && bullets.length > 0 && (
        <CardContent>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
