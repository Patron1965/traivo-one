import { useEffect, useRef } from "react";
import { useTour } from "@/hooks/use-tour";
import { platformTour } from "@/lib/tour-definitions";

export function TourAutoStart() {
  const { hasSeenTour, startTour, state } = useTour();
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current || state.isActive) return;
    hasChecked.current = true;

    const isMobile = window.innerWidth < 768;
    if (isMobile) return;

    const timer = setTimeout(() => {
      if (!hasSeenTour(platformTour.id)) {
        startTour(platformTour);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [hasSeenTour, startTour, state.isActive]);

  return null;
}
