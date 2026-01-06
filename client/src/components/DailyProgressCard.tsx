import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Trophy, Target } from "lucide-react";
import { Celebration } from "@/components/Celebration";
import { useState, useEffect } from "react";

interface DailyProgressCardProps {
  completed: number;
  total: number;
  compact?: boolean;
}

export function DailyProgressCard({ completed, total, compact = false }: DailyProgressCardProps) {
  const [showCelebration, setShowCelebration] = useState(false);
  const [previousPercentage, setPreviousPercentage] = useState(0);
  
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  useEffect(() => {
    if (percentage === 100 && previousPercentage < 100 && total > 0) {
      setShowCelebration(true);
    }
    setPreviousPercentage(percentage);
  }, [percentage, previousPercentage, total]);

  if (total === 0) return null;

  if (compact) {
    return (
      <>
        <Celebration
          show={showCelebration}
          onComplete={() => setShowCelebration(false)}
        />
        <div 
          className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5"
          data-testid="progress-compact"
        >
          <div className="relative flex-1">
            <Progress value={percentage} className="h-2" />
          </div>
          <Badge 
            variant={percentage === 100 ? "default" : "secondary"}
            className={percentage === 100 ? "bg-green-600" : ""}
            data-testid="badge-progress-percentage"
          >
            {percentage === 100 ? (
              <>
                <Trophy className="h-3 w-3 mr-1" />
                Klart!
              </>
            ) : (
              <>{completed}/{total}</>
            )}
          </Badge>
        </div>
      </>
    );
  }

  return (
    <>
      <Celebration
        show={showCelebration}
        onComplete={() => setShowCelebration(false)}
      />
      <Card 
        className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20"
        data-testid="card-daily-progress"
      >
        <CardContent className="py-4 sm:py-6">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                {percentage === 100 ? (
                  <Trophy className="h-5 w-5 text-green-600" />
                ) : (
                  <Target className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <p className="font-semibold text-sm sm:text-base">Dagens framsteg</p>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {completed} av {total} ordrar klara
                </p>
              </div>
            </div>
            <div 
              className={`text-2xl sm:text-3xl font-bold ${
                percentage === 100 ? "text-green-600" : "text-primary"
              }`}
              data-testid="text-progress-percentage"
            >
              {percentage}%
            </div>
          </div>
          <Progress value={percentage} className="h-2" />
          {percentage === 100 && (
            <div className="flex items-center gap-2 mt-3 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm font-medium">Fantastiskt! Alla jobb avklarade!</span>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
