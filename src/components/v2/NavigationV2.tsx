"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartLine, CircleCheck, FolderKanban, Globe, Mail, Menu, SlidersHorizontal, Sun, Undo2, Users, Wallet, WandSparkles, X, type LucideIcon } from "lucide-react";
import type { RappelGoogle } from "@/lib/google/echeance";
import { cn } from "@/lib/utils";
import { libelleDansPlus } from "@/lib/v2/plus";
import { appelApi } from "@/components/pilotage/client";
import { EVENEMENT_COMPTEURS } from "@/components/pilotage/evenements";
import { BandeauRappelGoogle } from "@/components/pilotage/RappelGoogle";
import { RechercheGlobale } from "./RechercheGlobale";
import { TRANS_V2 } from "./transitions";

/**
 * Mission 22 — la navigation de la v2 : quatre entrées et « Plus », les mêmes sur ordinateur (barre du haut) et sur
 * téléphone (barre du bas, au pouce). Un seul compteur, sur Aujourd'hui (règle 8) ; aucun badge ailleurs.
 * Les adresses ne changent pas : Aujourd'hui = /taches, Personnes = /leads (et /clients), Argent = /finances (et
 * /depenses). « Plus » : Boîte mail, Simulateur, Site, Bilan, Réglages, À valider, et le retour à l'ancienne
 * interface (`/api/interface?v=v1`). Rien ne bouge tout seul : `TRANS_V2` seulement.
 */
export type EntreeV2 = {
  href: string;
  libelle: string;
  icone: LucideIcon;
  /** Autres adresses qui allument l'entrée. */
  aussi?: string[];
};

export const ENTREES: readonly EntreeV2[] = [
  { href: "/taches", libelle: "Aujourd'hui", icone: Sun },
  { href: "/dossiers", libelle: "Dossiers", icone: FolderKanban },
  { href: "/leads", libelle: "Personnes", icone: Users, aussi: ["/clients"] },
  { href: "/finances", libelle: "Argent", icone: Wallet, aussi: ["/depenses/nouvelle"] },
];

export const DANS_PLUS: readonly EntreeV2[] = [
  { href: "/mail", libelle: "Boîte mail", icone: Mail },
  { href: "/simulateur", libelle: "Simulateur", icone: WandSparkles },
  { href: "/site", libelle: "Site", icone: Globe },
  { href: "/analytique", libelle: "Bilan", icone: ChartLine },
  { href: "/parametres", libelle: "Réglages", icone: SlidersHorizontal },
  { href: "/validation", libelle: "À valider", icone: CircleCheck },
];

/** L'unique compteur : les tâches d'Aujourd'hui (`GET /api/pilotage/compteurs`). */
const ENTREE_COMPTEE = "/taches";
/** Mission 22 (A5) : dans « Plus », « À valider » dit en phrase ce qui attend (« À valider — 3 en attente »), jamais en badge. */
const ENTREE_EN_ATTENTE = "/validation";

type Compteurs = { tachesAujourdhui: number; rappelGoogle?: RappelGoogle | null; propositionsEnAttente?: number };

function estActive(pathname: string, entree: EntreeV2): boolean {
  return [entree.href, ...(entree.aussi ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

function CompteurAujourdhui({ valeur }: { valeur: number }) {
  if (!valeur || valeur <= 0) return null;
  return (
    <span aria-label={`${valeur} à faire`} className="min-w-[24px] rounded-full bg-action px-1.5 text-center text-petit leading-[24px] font-semibold tabular-nums text-action-texte">
      {valeur > 99 ? "99+" : valeur}
    </span>
  );
}

export function NavigationV2() {
  const pathname = usePathname();
  const [tachesAujourdhui, setTachesAujourdhui] = useState(0);
  const [rappelGoogle, setRappelGoogle] = useState<RappelGoogle | null>(null);
  const [propositionsEnAttente, setPropositionsEnAttente] = useState(0);
  const [plusOuvert, setPlusOuvert] = useState(false);

  const charger = useCallback(() => {
    appelApi<Compteurs>("/api/pilotage/compteurs")
      .then((compteurs) => {
        setTachesAujourdhui(compteurs.tachesAujourdhui ?? 0);
        setRappelGoogle(compteurs.rappelGoogle ?? null);
        setPropositionsEnAttente(compteurs.propositionsEnAttente ?? 0);
      })
      .catch(() => {
        // Compteur indicatif : une panne réseau ne doit rien bloquer.
      });
  }, []);

  // Rafraîchi comme en v1 : toutes les 60 s, au retour sur l'onglet, et après chaque écriture (EVENEMENT_COMPTEURS).
  useEffect(() => {
    charger();
    const minuterie = window.setInterval(charger, 60_000);
    const surVisibilite = () => {
      if (document.visibilityState === "visible") charger();
    };
    window.addEventListener("focus", charger);
    window.addEventListener(EVENEMENT_COMPTEURS, charger);
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      window.clearInterval(minuterie);
      window.removeEventListener("focus", charger);
      window.removeEventListener(EVENEMENT_COMPTEURS, charger);
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [charger]);

  // Le menu se referme quand on change d'écran.
  const [cheminSuivi, setCheminSuivi] = useState(pathname);
  if (cheminSuivi !== pathname) {
    setCheminSuivi(pathname);
    setPlusOuvert(false);
  }

  const plusActif = DANS_PLUS.some((entree) => estActive(pathname, entree));
  const retourV1 = `/api/interface?v=v1&retour=${encodeURIComponent(pathname)}`;

  const menuPlus = (classeLien: string) => (
    <ul className="flex flex-col">
      {DANS_PLUS.map((entree) => {
        const Icone = entree.icone;
        const active = estActive(pathname, entree);
        return (
          <li key={entree.href}>
            <Link href={entree.href} aria-current={active ? "page" : undefined} className={cn(classeLien, active ? "bg-surface-2 text-texte" : "text-texte-2 hover:bg-surface-2 hover:text-texte", TRANS_V2)}>
              <Icone size={20} aria-hidden className="text-texte-3" />
              {entree.href === ENTREE_EN_ATTENTE ? libelleDansPlus(entree.libelle, propositionsEnAttente) : entree.libelle}
            </Link>
          </li>
        );
      })}
      <li className="mt-1 border-t-[0.5px] border-trait pt-1">
        <a href={retourV1} className={cn(classeLien, "text-texte-3 hover:bg-surface-2 hover:text-texte", TRANS_V2)}>
          <Undo2 size={20} aria-hidden />
          Retour à l&apos;ancienne interface
        </a>
      </li>
    </ul>
  );

  return (
    <>
      {/* Ordinateur : la barre du haut */}
      <nav aria-label="Navigation principale" className="sticky top-0 z-40 hidden border-b-[0.5px] border-trait bg-fond/95 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-5 lg:px-8">
          <Link href="/taches" className="mr-2 inline-flex min-h-11 items-center text-corps font-semibold text-texte">
            CoverSwap
          </Link>
          <ul className="flex min-w-0 flex-1 items-center gap-1">
            {ENTREES.map((entree) => {
              const active = estActive(pathname, entree);
              const Icone = entree.icone;
              return (
                <li key={entree.href}>
                  <Link
                    href={entree.href}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex h-11 items-center gap-2 rounded-[10px] px-3 text-corps font-medium whitespace-nowrap", active ? "bg-surface-2 text-texte" : "text-texte-3 hover:bg-surface hover:text-texte", TRANS_V2)}
                  >
                    <Icone size={20} aria-hidden />
                    {entree.libelle}
                    {entree.href === ENTREE_COMPTEE ? <CompteurAujourdhui valeur={tachesAujourdhui} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <RechercheGlobale variante="loupe" />
          <div className="relative">
            <button
              type="button"
              aria-expanded={plusOuvert}
              aria-controls="menu-plus-bureau"
              onClick={() => setPlusOuvert((ouvert) => !ouvert)}
              className={cn("flex h-11 items-center gap-2 rounded-[10px] px-3 text-corps font-medium", plusOuvert || plusActif ? "bg-surface-2 text-texte" : "text-texte-3 hover:bg-surface hover:text-texte", TRANS_V2)}
            >
              {plusOuvert ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
              Plus
            </button>
            {plusOuvert ? (
              <div id="menu-plus-bureau" className="absolute top-full right-0 z-50 mt-1 w-72 rounded-[14px] border-[0.5px] border-trait bg-surface p-2">
                {menuPlus("flex h-11 items-center gap-3 rounded-[10px] px-3 text-corps")}
              </div>
            ) : null}
          </div>
        </div>
      </nav>

      {rappelGoogle ? <BandeauRappelGoogle rappel={rappelGoogle} /> : null}

      {/* Téléphone : la barre du bas, au pouce */}
      <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-40 border-t-[0.5px] border-trait bg-fond/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid h-16 grid-cols-5">
          {ENTREES.map((entree) => {
            const active = estActive(pathname, entree);
            const Icone = entree.icone;
            return (
              <li key={entree.href} className="contents">
                <Link href={entree.href} aria-current={active ? "page" : undefined} className={cn("relative flex flex-col items-center justify-center gap-1 text-petit font-medium tracking-tight whitespace-nowrap", active ? "text-action-clair" : "text-texte-3", TRANS_V2)}>
                  <Icone size={22} aria-hidden />
                  {entree.libelle}
                  {entree.href === ENTREE_COMPTEE ? (
                    <span className="absolute top-1 left-1/2 ml-2">
                      <CompteurAujourdhui valeur={tachesAujourdhui} />
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          <li className="contents">
            <button
              type="button"
              aria-expanded={plusOuvert}
              aria-controls="menu-plus-telephone"
              onClick={() => setPlusOuvert((ouvert) => !ouvert)}
              className={cn("relative flex flex-col items-center justify-center gap-1 text-petit font-medium tracking-tight whitespace-nowrap", plusOuvert || plusActif ? "text-action-clair" : "text-texte-3", TRANS_V2)}
            >
              {plusOuvert ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
              Plus
            </button>
          </li>
        </ul>
      </nav>

      {plusOuvert ? (
        <div className="fixed inset-0 z-30 md:hidden" onClick={() => setPlusOuvert(false)}>
          <div className="absolute inset-0 bg-fond/70" aria-hidden />
          <div id="menu-plus-telephone" className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] rounded-t-[14px] border-t-[0.5px] border-trait bg-surface p-3" onClick={(evenement) => evenement.stopPropagation()}>
            <div className="mb-2">
              <RechercheGlobale variante="champ" />
            </div>
            {menuPlus("flex h-12 items-center gap-3 rounded-[10px] px-3 text-corps-tel")}
          </div>
        </div>
      ) : null}
    </>
  );
}
