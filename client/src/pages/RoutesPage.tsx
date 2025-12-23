import { RouteMap } from "@/components/RouteMap";
import { AICard } from "@/components/AICard";

export default function RoutesPage() {
  return (
    <div className="h-full p-6 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Ruttplanering</h1>
        <p className="text-sm text-muted-foreground">Optimera dagens rutter och minimera körtid</p>
      </div>
      
      <AICard
        title="AI Ruttoptimering"
        variant="compact"
        defaultExpanded={false}
        insights={[
          { type: "optimization", title: "Ruttoptimering", description: "AI kan optimera ordningen på stopp för att minimera körtid" },
          { type: "suggestion", title: "Bränslebesparingar", description: "Föreslå ruttändringar som sparar bränsle och minskar utsläpp" },
          { type: "info", title: "Trafikprognoser", description: "Anpassa rutter baserat på förväntad trafik och väderförhållanden" },
        ]}
      />
      
      <div className="flex-1 min-h-0">
        <RouteMap />
      </div>
    </div>
  );
}
