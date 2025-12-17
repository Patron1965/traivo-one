import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Plus, Search, Phone, Mail, MapPin, Wrench } from "lucide-react";

// todo: remove mock functionality
const mockResources = [
  {
    id: "1",
    name: "Bengt Bengtsson",
    initials: "BB",
    type: "person",
    phone: "+46701234569",
    email: "bengt@kinab.se",
    weeklyHours: 40,
    completedThisWeek: 8,
    competencies: ["well_service", "pump_repair", "installation"],
    status: "active",
    homeLocation: "Stockholm",
  },
  {
    id: "2",
    name: "Carina Carlsson",
    initials: "CC",
    type: "person",
    phone: "+46701234570",
    email: "carina@kinab.se",
    weeklyHours: 40,
    completedThisWeek: 6,
    competencies: ["well_service", "emergency_certified"],
    status: "active",
    homeLocation: "Täby",
  },
];

const competencyLabels: Record<string, string> = {
  well_service: "Brunnsservice",
  pump_repair: "Pumpreparation",
  installation: "Installation",
  emergency_certified: "Akutcertifierad",
};

interface ResourceListProps {
  onAddResource?: () => void;
  onSelectResource?: (id: string) => void;
}

export function ResourceList({ onAddResource, onSelectResource }: ResourceListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredResources = mockResources.filter(r => 
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Resurser</h1>
          <p className="text-sm text-muted-foreground">{mockResources.length} tekniker registrerade</p>
        </div>
        <Button onClick={() => { onAddResource?.(); console.log("Add resource clicked"); }} data-testid="button-add-resource">
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
            onClick={() => { onSelectResource?.(resource.id); console.log("Resource selected:", resource.name); }}
            data-testid={`resource-card-${resource.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="text-sm">{resource.initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="font-semibold truncate">{resource.name}</h3>
                    <Badge variant={resource.status === "active" ? "secondary" : "outline"}>
                      {resource.status === "active" ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </div>
                  
                  <div className="space-y-1 text-xs text-muted-foreground mb-3">
                    <div className="flex items-center gap-2">
                      <Phone className="h-3 w-3" />
                      <span>{resource.phone}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3" />
                      <span>{resource.homeLocation}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-3">
                    {resource.competencies.slice(0, 2).map((comp) => (
                      <Badge key={comp} variant="outline" className="text-[10px]">
                        {competencyLabels[comp] || comp}
                      </Badge>
                    ))}
                    {resource.competencies.length > 2 && (
                      <Badge variant="outline" className="text-[10px]">
                        +{resource.competencies.length - 2}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Veckobeläggning</span>
                      <span>{resource.completedThisWeek} av {resource.weeklyHours}h</span>
                    </div>
                    <Progress value={(resource.completedThisWeek / resource.weeklyHours) * 100} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
