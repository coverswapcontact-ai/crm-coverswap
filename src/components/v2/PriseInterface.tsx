"use client";

import { useEffect } from "react";

/**
 * Mission 22 — `?interface=v2` (ou `v1`) sur n'importe quelle adresse du CRM : la page est remplacée par
 * `/api/interface?v=…&retour=<la même adresse sans le paramètre>`, qui pose le cookie puis ramène ici.
 * Ne rend rien ; monté par le gabarit en v1 comme en v2, sans toucher au proxy.
 */
export function PriseInterface() {
  useEffect(() => {
    const adresse = new URL(window.location.href);
    const demande = adresse.searchParams.get("interface");
    if (demande !== "v1" && demande !== "v2") return;
    adresse.searchParams.delete("interface");
    const retour = `${adresse.pathname}${adresse.search}${adresse.hash}`;
    window.location.replace(`/api/interface?v=${demande}&retour=${encodeURIComponent(retour)}`);
  }, []);
  return null;
}
