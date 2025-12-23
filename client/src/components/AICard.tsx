import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ChevronDown, ChevronUp, Lightbulb, Zap, TrendingUp, AlertTriangle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type AICardVariant = "full" | "compact" | "inline";

interface AIInsight {
  type: "suggestion" | "warning" | "optimization" | "info";
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface AICardProps {
  title: string;
  description?: string;
  variant?: AICardVariant;
  insights?: AIInsight[];
  isLoading?: boolean;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
  onRefresh?: () => void;
}

const insightIcons = {
  suggestion: Lightbulb,
  warning: AlertTriangle,
  optimization: Zap,
  info: TrendingUp,
};

const insightColors = {
  suggestion: "text-blue-500",
  warning: "text-amber-500",
  optimization: "text-purple-500",
  info: "text-green-500",
};

export function AICard({
  title,
  description,
  variant = "full",
  insights = [],
  isLoading,
  children,
  defaultExpanded = true,
  onRefresh,
}: AICardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-2 p-2 rounded-md bg-purple-500/5 border border-purple-500/20">
        <Sparkles className="h-4 w-4 text-purple-500 shrink-0" />
        <span className="text-sm">{title}</span>
        {children}
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <Card className="border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-blue-500/5">
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 cursor-pointer hover-elevate" data-testid="button-ai-card-toggle">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <div className="p-1 rounded-md bg-purple-500/20">
                    <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                  </div>
                  {title}
                  {insights.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {insights.length}
                    </Badge>
                  )}
                </CardTitle>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {children}
              {insights.length > 0 && (
                <div className="space-y-2 mt-2">
                  {insights.slice(0, 3).map((insight, index) => {
                    const Icon = insightIcons[insight.type];
                    return (
                      <div
                        key={index}
                        className="flex items-start gap-2 p-2 rounded-md bg-background/50"
                      >
                        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${insightColors[insight.type]}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{insight.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {insight.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    );
  }

  return (
    <Card className="border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-blue-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-md bg-purple-500/20">
              <Sparkles className="h-4 w-4 text-purple-500" />
            </div>
            {title}
          </CardTitle>
          {onRefresh && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={isLoading}
              data-testid="button-ai-refresh"
            >
              {isLoading ? "Analyserar..." : "Uppdatera"}
            </Button>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardHeader>
      <CardContent>
        {children}
        {insights.length > 0 && (
          <div className="space-y-2 mt-3">
            {insights.map((insight, index) => {
              const Icon = insightIcons[insight.type];
              return (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 rounded-md bg-background/50 border border-border/50"
                >
                  <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${insightColors[insight.type]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{insight.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {insight.description}
                    </p>
                    {insight.action && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={insight.action.onClick}
                        data-testid={`button-insight-action-${index}`}
                      >
                        {insight.action.label}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
