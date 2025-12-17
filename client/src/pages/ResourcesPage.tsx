import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Plus, Search, Phone, MapPin, Loader2 } from "lucide-react";
import type { Resource } from "@shared/schema";

const competencyLabels: Record<string, string> = {
  well_service: "Brunnsservice",
  pump_repair: "Pumpreparation",
  installation: "Installation",
  emergency_certified: "Akutcertifierad",
};

export default function ResourcesPage() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: resources = [], isLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const filteredResources = resources.filter(r => 
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Resurser</h1>
          <p className="text-sm text-muted-foreground">{resources.length} tekniker registrerade</p>
        </div>
        <Button onClick={() => console.log("Add resource clicked")} data-testid="button-add-resource">
          <Plus className="h-4 w-4 mr-2" />
          Lägg till resurs
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Sök resurser..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-search-resources"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredResources.map((resource) => (
          <Card 
            key={resource.id}
            className="hover-elevate active-elevate-2 cursor-pointer"
            onClick={() => console.log("Resource selected:", resource.name)}
            data-testid={`resource-card-${resource.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="text-sm">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="font-semibold truncate">{resource.name}</h3>
                    <Badge variant={resource.status === "active" ? "secondary" : "outline"}>
                      {resource.status === "active" ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </div>
                  
                  <div className="space-y-1 text-xs text-muted-foreground mb-3">
                    {resource.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-3 w-3" />
                        <span>{resource.phone}</span>
                      </div>
                    )}
                    {resource.homeLocation && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3 w-3" />
                        <span>{resource.homeLocation}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1 mb-3">
                    {(resource.competencies || []).slice(0, 2).map((comp) => (
                      <Badge key={comp} variant="outline" className="text-[10px]">
                        {competencyLabels[comp] || comp}
                      </Badge>
                    ))}
                    {(resource.competencies || []).length > 2 && (
                      <Badge variant="outline" className="text-[10px]">
                        +{(resource.competencies || []).length - 2}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Veckobeläggning</span>
                      <span>0 av {resource.weeklyHours || 40}h</span>
                    </div>
                    <Progress value={0} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredResources.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Inga resurser hittades</p>
        </div>
      )}
    </div>
  );
}
