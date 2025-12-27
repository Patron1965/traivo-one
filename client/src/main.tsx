import { createRoot } from "react-dom/client";
import { Suspense, lazy } from "react";
import "./index.css";

const isStandaloneResourceFocus = 
  window.location.pathname.startsWith("/resource-focus/") && 
  new URLSearchParams(window.location.search).get("standalone") === "1";

const App = lazy(() => 
  isStandaloneResourceFocus 
    ? import("./resourceFocusApp") 
    : import("./App")
);

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<LoadingFallback />}>
    <App />
  </Suspense>
);
