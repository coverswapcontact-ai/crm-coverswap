"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type ViewMode = "simple" | "advanced";

interface ViewModeContextType {
  mode: ViewMode;
  toggle: () => void;
  isSimple: boolean;
  isAdvanced: boolean;
}

const ViewModeContext = createContext<ViewModeContextType>({
  mode: "simple",
  toggle: () => {},
  isSimple: true,
  isAdvanced: false,
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("crm-view-mode") as ViewMode) || "simple";
    }
    return "simple";
  });

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === "simple" ? "advanced" : "simple";
      localStorage.setItem("crm-view-mode", next);
      return next;
    });
  }, []);

  return (
    <ViewModeContext.Provider
      value={{
        mode,
        toggle,
        isSimple: mode === "simple",
        isAdvanced: mode === "advanced",
      }}
    >
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode() {
  return useContext(ViewModeContext);
}
