import type { Metadata, Viewport } from "next";
import { FOND_HEX } from "@/lib/application/charte";
import { etatLien } from "@/lib/fichiers-depot/jetons";
import { COMPRESSION_NAVIGATEUR } from "@/lib/fichiers-depot/types";
import { FormulaireDepot } from "./formulaire";

export const metadata: Metadata = { title: "Déposer des fichiers — CoverSwap", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: FOND_HEX };
export const dynamic = "force-dynamic";

/**
 * Mission 17 (partie C) — la page publique du lien de dépôt, hors navigation du
 * CRM (pas de session : le jeton dans l'adresse fait foi, routes-publiques.ts).
 * Ouvrir la page ne consomme rien ; seule la soumission du formulaire consomme
 * le lien. Lien expiré, déjà utilisé ou inconnu : un message clair, rien d'autre.
 */
export default async function PageDepot({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  const etat = await etatLien(jeton);
  return (
    <main className="flex min-h-[100dvh] w-full flex-1 justify-center bg-fond px-4 py-6 text-texte sm:items-center">
      <div className="w-full max-w-[440px] rounded-[14px] border-[0.5px] border-trait bg-surface p-5 sm:p-6">
        <p className="flex items-baseline gap-2 text-[17px] font-semibold tracking-tight">
          CoverSwap
          <span className="text-[13px] font-normal text-texte-3">dépôt de fichiers</span>
        </p>
        {etat.etat === "valide" ? (
          <FormulaireDepot jeton={jeton} titre={etat.titre} expireLe={etat.expireLe} fichiersMax={etat.fichiersMax} octetsMaxFichier={etat.octetsMaxFichier} octetsMaxDepot={etat.octetsMaxDepot} photosSeules={etat.type === "PHOTO_AVANT" || etat.type === "PHOTO_APRES" || etat.entite === "PUBLICATION"} compression={COMPRESSION_NAVIGATEUR} />
        ) : (
          <>
            <h1 className="mt-4 text-[15px] font-medium">{etat.etat === "expire" ? "Lien expiré" : etat.etat === "utilise" ? "Lien déjà utilisé" : "Lien inconnu"}</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-attention-texte">{etat.message}</p>
          </>
        )}
      </div>
    </main>
  );
}
