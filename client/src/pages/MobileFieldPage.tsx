import { MobileFieldApp } from "@/components/MobileFieldApp";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import type { Resource } from "@shared/schema";

export default function MobileFieldPage() {
  const [selectedResourceId, setSelectedResourceId] = useState<string | undefined>(undefined);

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b bg-muted/50">
        <Select 
          value={selectedResourceId || "all"} 
          onValueChange={(v) => setSelectedResourceId(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-full" data-testid="select-resource">
            <SelectValue placeholder="Alla resurser" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla resurser</SelectItem>
            {resources.map(r => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 overflow-hidden">
        <MobileFieldApp resourceId={selectedResourceId} />
      </div>
    </div>
  );
}
