import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Phone, MapPin } from "lucide-react";

interface ResourceListProps {
  onAddResource?: () => void;
  onSelectResource?: (id: string) => void;
}

export function ResourceList({ onAddResource, onSelectResource }: ResourceListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: resources = [], isLoading } = useQuery<Array<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    status: string;
    homeAddress?: string;
    competencies?: string[];
  }>>({
    queryKey: ["/api/resources"],
  });

  const filteredResources = resources.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Resurser</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-resource-count">
            {resources.length} tekniker registrerade
          </p>
        </div>
        <Button onClick={() => onAddResource?.()} data-testid="button-add-resource">
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

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredResources.map((resource) => (
            <Card
              key={resource.id}
              className="hover-elevate active-elevate-2 cursor-pointer"
              onClick={() => onSelectResource?.(resource.id)}
              data-testid={`resource-card-${resource.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="text-sm">{getInitials(resource.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-semibold truncate" data-testid={`text-resource-name-${resource.id}`}>{resource.name}</h3>
                      <Badge variant={resource.status === "active" ? "secondary" : "outline"} data-testid={`badge-resource-status-${resource.id}`}>
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
                      {resource.homeAddress && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3" />
                          <span>{resource.homeAddress}</span>
                        </div>
                      )}
                    </div>

                    {resource.competencies && resource.competencies.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {resource.competencies.slice(0, 3).map((comp) => (
                          <Badge key={comp} variant="outline" className="text-[10px]">
                            {comp}
                          </Badge>
                        ))}
                        {resource.competencies.length > 3 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{resource.competencies.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filteredResources.length === 0 && !isLoading && (
            <p className="text-sm text-muted-foreground col-span-full text-center py-8" data-testid="text-no-resources">
              {searchQuery ? "Inga resurser matchade sökningen" : "Inga resurser registrerade"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
