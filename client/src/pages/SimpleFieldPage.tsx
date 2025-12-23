import { SimpleFieldApp } from "@/components/SimpleFieldApp";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Resource } from "@shared/schema";

export default function SimpleFieldPage() {
  const [selectedResourceId, setSelectedResourceId] = useState<string | undefined>(undefined);
  const [showResourcePicker, setShowResourcePicker] = useState(false);

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const selectedResource = resources.find(r => r.id === selectedResourceId);

  if (showResourcePicker) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="p-6 border-b text-center">
          <h1 className="text-3xl font-bold">Välj din profil</h1>
          <p className="text-xl text-muted-foreground mt-2">
            Vem är du?
          </p>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <button
            onClick={() => {
              setSelectedResourceId(undefined);
              setShowResourcePicker(false);
            }}
            className="w-full flex items-center gap-4 p-6 bg-card rounded-2xl border-2 text-left hover-elevate active-elevate-2"
            data-testid="button-all-resources"
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted text-2xl font-bold shrink-0">
              *
            </div>
            <div className="flex-1">
              <p className="text-2xl font-medium">Alla jobb</p>
              <p className="text-lg text-muted-foreground">Visa alla resurser</p>
            </div>
          </button>

          {resources.map((resource) => (
            <button
              key={resource.id}
              onClick={() => {
                setSelectedResourceId(resource.id);
                setShowResourcePicker(false);
              }}
              className="w-full flex items-center gap-4 p-6 bg-card rounded-2xl border-2 text-left hover-elevate active-elevate-2"
              data-testid={`button-resource-${resource.id}`}
            >
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary text-primary-foreground text-2xl font-bold shrink-0">
                {resource.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-2xl font-medium">{resource.name}</p>
                <p className="text-lg text-muted-foreground">{resource.resourceType || "Fältarbetare"}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <button
        onClick={() => setShowResourcePicker(true)}
        className="flex items-center justify-between gap-2 p-4 border-b bg-muted/50 hover-elevate"
        data-testid="button-change-resource"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
            {selectedResource ? selectedResource.name.charAt(0).toUpperCase() : "*"}
          </div>
          <span className="text-lg font-medium">
            {selectedResource ? selectedResource.name : "Alla resurser"}
          </span>
        </div>
        <ChevronDown className="h-6 w-6" />
      </button>
      <div className="flex-1 overflow-hidden">
        <SimpleFieldApp resourceId={selectedResourceId} />
      </div>
    </div>
  );
}
