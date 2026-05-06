import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

const RELOAD_GUARD_KEY = "__chunk_reload_attempted_at";
const RELOAD_GUARD_WINDOW_MS = 10_000;

function isStaleAssetError(message: string | undefined | null): boolean {
  if (!message) return false;
  return (
    /Unable to preload CSS/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message)
  );
}

function tryAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_WINDOW_MS) {
      return false;
    }
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
  }
  window.location.reload();
  return true;
}

interface ChunkReloadWindow extends Window {
  __chunkReloadHandlerInstalled?: boolean;
}

function extractErrorMessage(reason: unknown): string | undefined {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object" && "message" in reason) {
    const msg = (reason as { message: unknown }).message;
    return typeof msg === "string" ? msg : undefined;
  }
  return undefined;
}

if (typeof window !== "undefined") {
  const w = window as ChunkReloadWindow;
  if (!w.__chunkReloadHandlerInstalled) {
    w.__chunkReloadHandlerInstalled = true;
    window.addEventListener("unhandledrejection", (event) => {
      const msg = extractErrorMessage(event.reason);
      if (isStaleAssetError(msg)) {
        console.warn("[chunk-reload] Stale asset detected, reloading:", msg);
        tryAutoReload();
      }
    });
    window.addEventListener("error", (event) => {
      if (isStaleAssetError(event.message)) {
        console.warn("[chunk-reload] Stale asset error event, reloading:", event.message);
        tryAutoReload();
      }
    });
  }
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    if (isStaleAssetError(error?.message)) {
      console.warn("[chunk-reload] ErrorBoundary caught stale asset, reloading");
      tryAutoReload();
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  handleReload = () => {
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[200px] p-4" data-testid="error-boundary">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5 text-chart-4" />
                Något gick fel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ett oväntat fel uppstod i denna del av sidan. Du kan försöka igen eller ladda om hela sidan.
              </p>
              {this.state.error && (
                <p className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
                  {this.state.error.message}
                </p>
              )}
              <div className="flex gap-2">
                <Button onClick={this.handleRetry} variant="outline" className="flex-1" data-testid="button-error-retry">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Försök igen
                </Button>
                <Button onClick={this.handleReload} className="flex-1" data-testid="button-error-reload">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Ladda om sidan
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export function QueryErrorState({ 
  message = "Kunde inte hämta data", 
  onRetry 
}: { 
  message?: string; 
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] p-4 gap-4">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-5 w-5 text-chart-4" />
        <span className="font-medium">{message}</span>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} data-testid="button-retry">
          <RefreshCw className="h-4 w-4 mr-2" />
          Försök igen
        </Button>
      )}
    </div>
  );
}
