import { useEffect, useCallback, useRef } from "react";

export function useUnsavedChanges(isDirty: boolean) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "Du har osparade ändringar. Vill du verkligen lämna sidan?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const confirmNavigation = useCallback((callback: () => void) => {
    if (dirtyRef.current) {
      const confirmed = window.confirm("Du har osparade ändringar. Vill du verkligen lämna sidan?");
      if (confirmed) callback();
    } else {
      callback();
    }
  }, []);

  return { confirmNavigation };
}
