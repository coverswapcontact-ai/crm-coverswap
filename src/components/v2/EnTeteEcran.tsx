import { cn } from "@/lib/utils";

/**
 * Mission 22 (A5) — l'en-tête v2 des écrans de « Plus » (Boîte mail, Simulateur, Site, Bilan, Réglages, À valider,
 * Nouvelle dépense). Ces écrans restent les composants de la v1, servis tels quels dans la coque v2 : chaque
 * `page.tsx` les coiffe de cet en-tête quand `interfaceCourante()` rend `v2`, et rien ne change en v1.
 *
 * Une seule chose en haut (règle 1) : le titre en phrase (20 px), une ligne d'aide facultative, un seul bouton
 * principal facultatif. Le titre que l'écran v1 porte lui-même (`EnTetePage`, ou son propre `h1`) est masqué sous
 * cet en-tête (`[&_h1]:hidden`) : chaque écran v1 n'a qu'un `h1`, en tête, et ses boutons et son sous-titre restent
 * visibles. Composant serveur, sans état ; l'écran v1 dessous garde sa largeur, ses marges et son rendu.
 */
export type CadreEcran = keyof typeof CADRES;

/** Le cadre de l'écran v1 coiffé (largeur et marges), pour que le titre s'aligne sur son contenu. */
export const CADRES = {
  /** Nouvelle dépense (`max-w-lg px-5`). */
  etroit: "max-w-lg px-5",
  /** Boîte mail, Simulateur (`max-w-3xl px-4 md:px-8`). */
  "colonne-4": "max-w-3xl px-4 md:px-8",
  /** Réglages, À valider (`max-w-3xl px-5 md:px-8`). */
  "colonne-5": "max-w-3xl px-5 md:px-8",
  /** Banc et prompts du simulateur (`max-w-5xl px-4 md:px-8`). */
  "large-4": "max-w-5xl px-4 md:px-8",
  /** Le site (`max-w-5xl px-5 md:px-8`). */
  "large-5": "max-w-5xl px-5 md:px-8",
  /** Bilan (`max-w-[1440px] px-4 md:px-10`). */
  bilan: "max-w-[1440px] px-4 md:px-10",
} as const;

export function EnTeteEcran({
  titre,
  aide,
  action,
  cadre = "colonne-4",
  children,
}: {
  titre: string;
  /** Une ligne, facultative : à quoi sert l'écran. Absente quand l'écran v1 garde son propre sous-titre. */
  aide?: string;
  /** Le seul bouton principal de l'en-tête, facultatif (aucun des écrans de Plus n'en a besoin : la v1 garde le sien). */
  action?: React.ReactNode;
  cadre?: CadreEcran;
  /** L'écran v1, tel quel. */
  children: React.ReactNode;
}) {
  return (
    <>
      <header className={cn("mx-auto w-full pt-6 md:pt-8", CADRES[cadre])}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-titre font-semibold text-texte">{titre}</h1>
            {aide ? <p className="mt-1 text-corps-tel text-texte-3 md:text-corps">{aide}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </header>
      {/* L'écran v1 : son titre à lui est masqué (une seule chose en haut), le reste est servi tel quel. */}
      <div className="[&_h1]:hidden">{children}</div>
    </>
  );
}
