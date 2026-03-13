import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, CheckCircle, Clock, FileText } from "lucide-react";

interface IssueReport {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  reporterName: string | null;
  reporterEmail: string | null;
  createdAt: string;
}

const statusLabels: Record<string, string> = {
  new: "Ny",
  reviewed: "Granskad",
  converted: "Åtgärdad",
  rejected: "Avvisad",
};

const statusColors: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  reviewed: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  converted: "bg-green-500/10 text-green-500 border-green-500/20",
  rejected: "bg-red-500/10 text-red-500 border-red-500/20",
};

const statusIcons: Record<string, typeof Clock> = {
  new: Clock,
  reviewed: AlertCircle,
  converted: CheckCircle,
  rejected: AlertCircle,
};

export default function MyReportsPage() {
  const { data: reports = [], isLoading } = useQuery<IssueReport[]>({
    queryKey: ["/api/my-reports"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Mina felanmälningar</h1>
        <p className="text-sm text-muted-foreground">Följ status på dina inskickade felanmälningar</p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Du har inga felanmälningar ännu.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => {
            const StatusIcon = statusIcons[report.status] || Clock;
            return (
              <Card key={report.id} data-testid={`card-report-${report.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{report.title}</CardTitle>
                    <Badge variant="outline" className={statusColors[report.status] || ""}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {statusLabels[report.status] || report.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {report.description && (
                    <p className="text-sm text-muted-foreground mb-2">{report.description}</p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Kategori: {report.category}</span>
                    <span>Datum: {new Date(report.createdAt).toLocaleDateString("sv-SE")}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
