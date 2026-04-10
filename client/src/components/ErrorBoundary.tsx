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
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  handleReload = () => {
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
                <AlertTriangle className="h-5 w-5 text-orange-500 dark:text-orange-400" />
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
        <AlertTriangle className="h-5 w-5 text-orange-500 dark:text-orange-400" />
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
