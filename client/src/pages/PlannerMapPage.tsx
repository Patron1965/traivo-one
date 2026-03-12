import { useEffect, useRef } from "react";

export default function PlannerMapPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    document.title = "Nordnav One - Planerarvy Karta";
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]" data-testid="page-planner-map">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-planner-map-title">Planerarvy Karta</h1>
          <p className="text-sm text-muted-foreground">Realtidsöversikt av förare och uppdrag på karta</p>
        </div>
        <a
          href="/planner/map"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border bg-background hover:bg-accent transition-colors"
          data-testid="button-open-fullscreen-map"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
          Öppna i helskärm
        </a>
      </div>
      <iframe
        ref={iframeRef}
        src="/planner/map"
        className="flex-1 w-full border-0"
        title="Planerarvy Karta"
        data-testid="iframe-planner-map"
      />
    </div>
  );
}
