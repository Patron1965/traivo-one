import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface TourStep {
  target: string;
  title: string;
  description: string;
  placement?: "top" | "bottom" | "left" | "right";
  route?: string;
}

export interface TourDefinition {
  id: string;
  name: string;
  description: string;
  steps: TourStep[];
}

interface TourState {
  activeTour: TourDefinition | null;
  currentStep: number;
  isActive: boolean;
}

interface TourContextValue {
  state: TourState;
  startTour: (tour: TourDefinition) => void;
  nextStep: () => void;
  prevStep: () => void;
  endTour: () => void;
  markTourSeen: (tourId: string) => void;
  hasSeenTour: (tourId: string) => boolean;
  resetAllTours: () => void;
}

const STORAGE_KEY = "unicorn-tours-seen";

function getSeenTours(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setSeenTours(tours: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tours));
}

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TourState>({
    activeTour: null,
    currentStep: 0,
    isActive: false,
  });

  const startTour = useCallback((tour: TourDefinition) => {
    setState({ activeTour: tour, currentStep: 0, isActive: true });
  }, []);

  const nextStep = useCallback(() => {
    setState((prev) => {
      if (!prev.activeTour) return prev;
      const next = prev.currentStep + 1;
      if (next >= prev.activeTour.steps.length) {
        markTourSeenInternal(prev.activeTour.id);
        return { activeTour: null, currentStep: 0, isActive: false };
      }
      return { ...prev, currentStep: next };
    });
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => {
      if (!prev.activeTour || prev.currentStep <= 0) return prev;
      return { ...prev, currentStep: prev.currentStep - 1 };
    });
  }, []);

  const endTour = useCallback(() => {
    setState((prev) => {
      if (prev.activeTour) {
        markTourSeenInternal(prev.activeTour.id);
      }
      return { activeTour: null, currentStep: 0, isActive: false };
    });
  }, []);

  const markTourSeen = useCallback((tourId: string) => {
    markTourSeenInternal(tourId);
  }, []);

  const hasSeenTour = useCallback((tourId: string) => {
    return getSeenTours().includes(tourId);
  }, []);

  const resetAllTours = useCallback(() => {
    setSeenTours([]);
  }, []);

  return (
    <TourContext.Provider
      value={{ state, startTour, nextStep, prevStep, endTour, markTourSeen, hasSeenTour, resetAllTours }}
    >
      {children}
    </TourContext.Provider>
  );
}

function markTourSeenInternal(tourId: string) {
  const seen = getSeenTours();
  if (!seen.includes(tourId)) {
    setSeenTours([...seen, tourId]);
  }
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within TourProvider");
  return ctx;
}
