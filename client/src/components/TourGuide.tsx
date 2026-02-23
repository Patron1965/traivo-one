import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useTour } from "@/hooks/use-tour";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { X, ChevronRight, ChevronLeft, Sparkles, SkipForward } from "lucide-react";

interface Position {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPosition {
  top: number;
  left: number;
}

function getTargetPosition(selector: string): Position | null {
  const selectors = selector.split(", ");
  for (const sel of selectors) {
    const el = document.querySelector(sel.trim());
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      return {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      };
    }
  }
  return null;
}

function calculateTooltipPosition(
  target: Position | null,
  placement: "top" | "bottom" | "left" | "right",
  tooltipWidth: number,
  tooltipHeight: number
): TooltipPosition {
  const padding = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (!target) {
    return {
      top: viewportHeight / 2 - tooltipHeight / 2 + window.scrollY,
      left: viewportWidth / 2 - tooltipWidth / 2,
    };
  }

  let top = 0;
  let left = 0;

  switch (placement) {
    case "bottom":
      top = target.top + target.height + padding;
      left = target.left + target.width / 2 - tooltipWidth / 2;
      break;
    case "top":
      top = target.top - tooltipHeight - padding;
      left = target.left + target.width / 2 - tooltipWidth / 2;
      break;
    case "left":
      top = target.top + target.height / 2 - tooltipHeight / 2;
      left = target.left - tooltipWidth - padding;
      break;
    case "right":
      top = target.top + target.height / 2 - tooltipHeight / 2;
      left = target.left + target.width + padding;
      break;
  }

  if (left < padding) left = padding;
  if (left + tooltipWidth > viewportWidth - padding) {
    left = viewportWidth - tooltipWidth - padding;
  }
  if (top < padding) top = target.top + target.height + padding;
  if (top + tooltipHeight > viewportHeight + window.scrollY - padding) {
    top = target.top - tooltipHeight - padding;
  }

  return { top, left };
}

export function TourGuide() {
  const { state, nextStep, prevStep, endTour } = useTour();
  const [targetPos, setTargetPos] = useState<Position | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);
  const retryCount = useRef(0);

  const currentStep = state.activeTour?.steps[state.currentStep];
  const totalSteps = state.activeTour?.steps.length ?? 0;

  const updatePositions = useCallback(() => {
    if (!currentStep) return;

    const pos = getTargetPosition(currentStep.target);
    setTargetPos(pos);

    if (!pos) {
      retryCount.current++;
      if (retryCount.current >= 3) {
        setTargetMissing(true);
      }
    } else {
      retryCount.current = 0;
      setTargetMissing(false);
    }

    const placement = currentStep.placement || "bottom";
    if (tooltipRef.current) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const newPos = calculateTooltipPosition(pos, placement, tooltipRect.width, tooltipRect.height);
      setTooltipPos(newPos);
    }
  }, [currentStep]);

  useEffect(() => {
    if (!state.isActive || !currentStep) return;

    setIsAnimating(true);
    setTargetMissing(false);
    retryCount.current = 0;
    const animTimer = setTimeout(() => setIsAnimating(false), 300);

    const updateTimer = setTimeout(updatePositions, 50);

    const pos = getTargetPosition(currentStep.target);
    if (pos) {
      const elementTop = pos.top - window.scrollY;
      if (elementTop < 0 || elementTop > window.innerHeight) {
        window.scrollTo({ top: pos.top - 100, behavior: "smooth" });
      }
    }

    return () => {
      clearTimeout(animTimer);
      clearTimeout(updateTimer);
    };
  }, [state.currentStep, state.isActive, currentStep, updatePositions]);

  useEffect(() => {
    if (!state.isActive) return;

    const handleResize = () => updatePositions();
    const handleScroll = () => updatePositions();

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    const interval = setInterval(updatePositions, 500);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      clearInterval(interval);
    };
  }, [state.isActive, updatePositions]);

  useEffect(() => {
    if (!state.isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      if (e.key === "ArrowRight" || e.key === "Enter") nextStep();
      if (e.key === "ArrowLeft") prevStep();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [state.isActive, endTour, nextStep, prevStep]);

  if (!state.isActive || !currentStep) return null;

  const spotlightPadding = 8;
  const spotlightRadius = 8;

  return createPortal(
    <div className="fixed inset-0 z-[9999]" data-testid="tour-overlay">
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: "none" }}
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetPos && !targetMissing && (
              <rect
                x={targetPos.left - spotlightPadding + window.scrollX * -1}
                y={targetPos.top - spotlightPadding - window.scrollY}
                width={targetPos.width + spotlightPadding * 2}
                height={targetPos.height + spotlightPadding * 2}
                rx={spotlightRadius}
                fill="black"
                className="transition-all duration-300"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tour-spotlight-mask)"
          style={{ pointerEvents: "auto" }}
          onClick={endTour}
        />
      </svg>

      {targetPos && !targetMissing && (
        <div
          className="absolute pointer-events-none transition-all duration-300"
          style={{
            top: targetPos.top - spotlightPadding - window.scrollY,
            left: targetPos.left - spotlightPadding,
            width: targetPos.width + spotlightPadding * 2,
            height: targetPos.height + spotlightPadding * 2,
            borderRadius: spotlightRadius,
            boxShadow: "0 0 0 2px hsl(var(--primary)), 0 0 16px 4px hsl(var(--primary) / 0.3)",
          }}
          data-testid="tour-spotlight"
        />
      )}

      <div
        ref={tooltipRef}
        className={`absolute z-[10000] w-80 max-w-[calc(100vw-2rem)] transition-all duration-300 ${isAnimating ? "opacity-0 scale-95" : "opacity-100 scale-100"}`}
        style={{
          top: tooltipPos.top - window.scrollY,
          left: tooltipPos.left,
        }}
        data-testid="tour-tooltip"
      >
        <Card className="shadow-xl border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
                <h3 className="font-semibold text-sm">{currentStep.title}</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={endTour}
                data-testid="button-tour-close"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              {currentStep.description}
            </p>

            {targetMissing && (
              <p className="text-xs text-amber-500 mb-3 italic">
                Elementet syns inte just nu. Hoppa vidare till nästa steg.
              </p>
            )}

            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      i === state.currentStep
                        ? "w-6 bg-primary"
                        : i < state.currentStep
                        ? "w-1.5 bg-primary/50"
                        : "w-1.5 bg-muted"
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-2">
                  {state.currentStep + 1} / {totalSteps}
                </span>

                {state.currentStep > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={prevStep}
                    data-testid="button-tour-prev"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}

                {targetMissing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3"
                    onClick={nextStep}
                    data-testid="button-tour-skip"
                  >
                    <SkipForward className="h-4 w-4 mr-1" />
                    Hoppa över
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 px-3"
                    onClick={nextStep}
                    data-testid="button-tour-next"
                  >
                    {state.currentStep === totalSteps - 1 ? (
                      "Klart"
                    ) : (
                      <>
                        Nästa
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>,
    document.body
  );
}
