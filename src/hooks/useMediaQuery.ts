"use client";

import { useEffect, useState } from "react";

/**
 * Hook detection media-query.
 * Usage: const isMobile = useMediaQuery("(max-width: 768px)");
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setMatches(e.matches);
    handler(mq);
    mq.addEventListener("change", handler as (e: MediaQueryListEvent) => void);
    return () => mq.removeEventListener("change", handler as (e: MediaQueryListEvent) => void);
  }, [query]);

  return matches;
}

export const useIsMobile = () => useMediaQuery("(max-width: 768px)");
