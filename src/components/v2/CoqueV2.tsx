import { Suspense } from "react";
import { RetourAppel } from "@/components/pilotage/RetourAppel";
import { HoteEcranSms } from "@/components/pilotage/sms/EcranSms";
import { BandeauEssai } from "./BandeauEssai";
import { MemoireReprendre } from "./MemoireReprendre";
import { NavigationV2 } from "./NavigationV2";
import { PriseInterface } from "./PriseInterface";

/**
 * Mission 22 — la coque de la v2, choisie par le gabarit `app/(pilotage)/layout.tsx` quand `interfaceCourante()`
 * rend `v2`. Elle garde tout ce que les écrans attendent du gabarit v1 : le fond, « Comment ça s'est passé ? » au
 * retour d'un appel (`RetourAppel`), l'écran SMS ouvert de n'importe où (`HoteEcranSms`), le `Toaster` de la racine,
 * et le `main` avec la zone sûre du haut et la place de la barre du bas. Composant serveur ; la navigation est cliente.
 * Mission 22 (A2) : `MemoireReprendre` note le dossier, le contact, la fiche ou le mail ouvert (bandeau « Reprendre »).
 */
export function CoqueV2({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex-1 bg-fond text-texte antialiased selection:bg-action/30">
      <BandeauEssai />
      <NavigationV2 />
      <PriseInterface />
      <Suspense fallback={null}>
        <MemoireReprendre />
      </Suspense>
      <RetourAppel />
      <HoteEcranSms />
      <main className="pt-[env(safe-area-inset-top)] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
    </div>
  );
}
