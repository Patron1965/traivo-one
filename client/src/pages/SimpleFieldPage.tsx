import { AIFieldAssistant } from "@/components/AIFieldAssistant";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Resource } from "@shared/schema";

export default function SimpleFieldPage() {
  const [selectedResourceId, setSelectedResourceId] = useState<string | undefined>(undefined);
  const [showResourcePicker, setShowResourcePicker] = useState(true);

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const selectedResource = resources.find(r => r.id === selectedResourceId);

  if (showResourcePicker) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="p-6 border-b text-center bg-gradient-to-b from-primary/10 to-transparent">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">AI Fältassistent</h1>
          </div>
          <p className="text-muted-foreground">
            Välj din profil för att komma igång
          </p>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {resources.map((resource) => (
            <button
              key={resource.id}
              onClick={() => {
                setSelectedResourceId(resource.id);
                setShowResourcePicker(false);
              }}
              className="w-full flex items-center gap-4 p-5 bg-card rounded-xl border text-left hover-elevate active-elevate-2"
              data-testid={`button-resource-${resource.id}`}
            >
              <Avatar className="h-14 w-14 bg-primary">
                <AvatarFallback className="bg-primary text-primary-foreground text-xl font-bold">
                  {resource.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-xl font-medium">{resource.name}</p>
                <p className="text-muted-foreground">{resource.resourceType || "Fältarbetare"}</p>
              </div>
            </button>
          ))}
          
          {resources.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>Inga resurser tillgängliga</p>
            </div>
          )}
        </div>
        <PWAInstallPrompt />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <AIFieldAssistant 
        resourceId={selectedResourceId} 
        resourceName={selectedResource?.name}
        onLogout={() => {
          setSelectedResourceId(undefined);
          setShowResourcePicker(true);
        }}
      />
      <PWAInstallPrompt />
    </div>
  );
}
