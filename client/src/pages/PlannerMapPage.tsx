import { useEffect, useRef, useState } from "react";
import { UrgentJobDialog } from "@/components/UrgentJobDialog";
import { goToLogin } from "@/lib/auth-utils";

export default function PlannerMapPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [urgentDialogOpen, setUrgentDialogOpen] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    document.title = "Traivo - Planerarvy Karta";
  }, []);

  useEffect(() => {
    // Iframen (`/planner/map`) skickar `traivo:session-expired` när
    // serverns HTML-auth-wrapper renderar fallback-sidan (sessionen död).
    // Vi visar då en banner ovanför iframen och låter användaren starta
    // om login utan att texten `{"message":"Unauthorized"}` någonsin syns.
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (data && typeof data === "object" && data.type === "traivo:session-expired") {
        setSessionExpired(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    // När fokus återkommer till fliken efter ev. login i topp-fönstret,
    // försök ladda om iframen så att kartan kommer upp utan att användaren
    // behöver klicka manuellt en andra gång.
    function onFocus() {
      if (sessionExpired && iframeRef.current) {
        iframeRef.current.src = "/planner/map?_t=" + Date.now();
        setSessionExpired(false);
      }
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [sessionExpired]);

  const startRelogin = () => {
    goToLogin("/planner-map");
  };

  const openPopout = () => {
    window.open("/monitor/popout", "traivo-monitor", "width=1200,height=800,menubar=no,toolbar=no,location=no,status=no");
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]" data-testid="page-planner-map">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-planner-map-title">Planerarvy Karta</h1>
          <p className="text-sm text-muted-foreground">Realtidsöversikt av förare och uppdrag på karta</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUrgentDialogOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-destructive text-white hover:bg-destructive transition-colors"
            data-testid="button-urgent-job"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Akut jobb
          </button>
          <button
            onClick={openPopout}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border bg-background hover:bg-accent transition-colors"
            data-testid="button-popout-monitor"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Eget fönster
          </button>
          <a
            href="/planner/map"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border bg-background hover:bg-accent transition-colors"
            data-testid="button-open-fullscreen-map"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2h6"/></svg>
            Helskärm
          </a>
        </div>
      </div>
      {sessionExpired && (
        <div
          className="flex items-center justify-between gap-3 border-b bg-warning/15 px-4 py-2 text-sm text-foreground"
          data-testid="banner-session-expired"
        >
          <span>Sessionen har gått ut – logga in igen för att ladda om kartan.</span>
          <button
            onClick={startRelogin}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            data-testid="button-relogin-planner-map"
          >
            Logga in igen
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="/planner/map"
        className="flex-1 w-full border-0"
        title="Planerarvy Karta"
        data-testid="iframe-planner-map"
      />
      <UrgentJobDialog
        open={urgentDialogOpen}
        onClose={() => setUrgentDialogOpen(false)}
      />
    </div>
  );
}
