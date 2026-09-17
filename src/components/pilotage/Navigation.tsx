"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartColumn,
  CircleCheckBig,
  FolderKanban,
  Hash,
  Mail,
  Menu,
  Radar,
  Receipt,
  ScrollText,
  SlidersHorizontal,
  Users,
  Wallet,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { RappelGoogle } from "@/lib/google/echeance";
import { cn } from "@/lib/utils";
import { appelApi } from "./client";
import { BandeauRappelGoogle } from "./RappelGoogle";
import { TRANS } from "./ui";

export type Compteurs = { entrantsATraiter: number; aValider: number; messagesATrier: number; tachesEnEchec: number };
type EtatNavigation = Compteurs & { rappelGoogle?: RappelGoogle | null };

/** À déclencher après une action qui change un compteur (validation, relance d'une tâche). */
export const EVENEMENT_COMPTEURS = "pilotage:compteurs";
export function rafraichirCompteurs(): void {
  window.dispatchEvent(new Event(EVENEMENT_COMPTEURS));
}

type Entree = {
  href: string;
  libelle: string;
  icone: LucideIcon;
  compteur?: keyof Compteurs;
  /** Barre du bas sur téléphone (4 entrées au plus, « Plus » en cinquième). */
  mobile?: boolean;
};

// Écrans principaux, dans l'ordre de la journée : les prospects alimentent les dossiers.
const PRINCIPALES: Entree[] = [
  { href: "/prospects", libelle: "Prospects", icone: Radar, compteur: "entrantsATraiter", mobile: true },
  { href: "/dossiers", libelle: "Dossiers", icone: FolderKanban, mobile: true },
  { href: "/validation", libelle: "À valider", icone: CircleCheckBig, compteur: "aValider", mobile: true },
  { href: "/messages", libelle: "Messages", icone: Mail, compteur: "messagesATrier" },
  { href: "/clients", libelle: "Clients", icone: Users, mobile: true },
  { href: "/finances", libelle: "Finances", icone: Wallet },
];

// Écrans secondaires, dans le menu « Plus ».
const SECONDAIRES: Entree[] = [
  { href: "/synthese", libelle: "Synthèse", icone: ChartColumn },
  { href: "/taches", libelle: "Tâches de fond", icone: Workflow, compteur: "tachesEnEchec" },
  { href: "/depenses", libelle: "Dépenses", icone: Receipt },
  { href: "/numeros", libelle: "Registre des numéros", icone: Hash },
  { href: "/journal", libelle: "Journal", icone: ScrollText },
  { href: "/parametres", libelle: "Paramètres", icone: SlidersHorizontal },
];

function estActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Compteur({ valeur, ton = "vert" }: { valeur: number; ton?: "vert" | "rouge" }) {
  if (valeur <= 0) return null;
  return (
    <span
      className={cn(
        "min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] leading-[18px] font-semibold tabular-nums",
        ton === "rouge" ? "bg-[#EF4444] text-white" : "bg-[#1D9E75] text-[#0B1612]"
      )}
    >
      {valeur > 99 ? "99+" : valeur}
    </span>
  );
}

function tonDe(cle: keyof Compteurs | undefined): "vert" | "rouge" {
  return cle === "tachesEnEchec" ? "rouge" : "vert";
}

export function Navigation() {
  const pathname = usePathname();
  const [compteurs, setCompteurs] = useState<Compteurs>({ entrantsATraiter: 0, aValider: 0, messagesATrier: 0, tachesEnEchec: 0 });
  const [rappelGoogle, setRappelGoogle] = useState<RappelGoogle | null>(null);
  const [menuOuvert, setMenuOuvert] = useState(false);

  const charger = useCallback(() => {
    appelApi<EtatNavigation>("/api/pilotage/compteurs")
      .then(({ rappelGoogle: rappel, ...nombres }) => {
        setCompteurs(nombres);
        setRappelGoogle(rappel ?? null);
      })
      .catch(() => {
        // Compteurs indicatifs : une panne réseau ne doit rien bloquer.
      });
  }, []);

  useEffect(() => {
    charger();
    const minuterie = window.setInterval(charger, 60_000);
    window.addEventListener("focus", charger);
    window.addEventListener(EVENEMENT_COMPTEURS, charger);
    return () => {
      window.clearInterval(minuterie);
      window.removeEventListener("focus", charger);
      window.removeEventListener(EVENEMENT_COMPTEURS, charger);
    };
  }, [charger]);

  // Le menu se referme quand on change d'écran.
  const [cheminSuivi, setCheminSuivi] = useState(pathname);
  if (cheminSuivi !== pathname) {
    setCheminSuivi(pathname);
    setMenuOuvert(false);
  }

  // Menu « Plus » du téléphone : les écrans principaux absents de la barre du bas, puis les secondaires.
  const DANS_LE_MENU = [...PRINCIPALES.filter((entree) => !entree.mobile), ...SECONDAIRES];
  const secondaireActive = DANS_LE_MENU.some((entree) => estActive(pathname, entree.href));
  const alerteMenu = DANS_LE_MENU.reduce((total, entree) => total + (entree.compteur && tonDe(entree.compteur) === "rouge" ? compteurs[entree.compteur] : 0), 0);
  const aTraiterMenu = DANS_LE_MENU.reduce((total, entree) => total + (entree.compteur && tonDe(entree.compteur) === "vert" ? compteurs[entree.compteur] : 0), 0);

  return (
    <>
      {/* Bureau : barre du haut */}
      <nav
        aria-label="Navigation principale"
        className="sticky top-0 z-40 hidden border-b-[0.5px] border-[#2A2D34] bg-[#16181D]/95 backdrop-blur md:block"
      >
        <div className="mx-auto flex h-[52px] max-w-[1680px] items-center gap-6 px-8">
          <Link href="/dossiers" className="flex items-baseline gap-2 text-[14px] font-semibold tracking-tight text-[#F2F3F5]">
            CoverSwap
            <span className="text-[12px] font-normal text-[#6B7280]">pilotage</span>
          </Link>
          <ul className="flex min-w-0 flex-1 items-center gap-1">
            {[...PRINCIPALES, ...SECONDAIRES].map((entree) => {
              const active = estActive(pathname, entree.href);
              const Icone = entree.icone;
              // L'icône seule tant que la place manque : libellés des écrans principaux dès 1280 px,
              // ceux des secondaires sur très grand écran.
              const secondaire = SECONDAIRES.includes(entree);
              return (
                <li key={entree.href}>
                  <Link
                    href={entree.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={entree.libelle}
                    title={entree.libelle}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium whitespace-nowrap",
                      active ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:bg-[#1C1F25] hover:text-[#F2F3F5]",
                      TRANS
                    )}
                  >
                    <Icone size={14} aria-hidden />
                    <span className={secondaire ? "hidden min-[1680px]:inline" : "hidden xl:inline"}>{entree.libelle}</span>
                    {entree.compteur ? <Compteur valeur={compteurs[entree.compteur]} ton={tonDe(entree.compteur)} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {rappelGoogle ? <BandeauRappelGoogle rappel={rappelGoogle} /> : null}

      {/* Téléphone : barre du bas, au pouce */}
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-40 border-t-[0.5px] border-[#2A2D34] bg-[#16181D]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul
          className="grid h-16"
          style={{ gridTemplateColumns: `repeat(${PRINCIPALES.filter((entree) => entree.mobile).length + 1}, minmax(0, 1fr))` }}
        >
          {PRINCIPALES.filter((entree) => entree.mobile).map((entree) => {
            const active = estActive(pathname, entree.href);
            const Icone = entree.icone;
            return (
              <li key={entree.href} className="contents">
                <Link
                  href={entree.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    active ? "text-[#5DCAA5]" : "text-[#9CA3AF]",
                    TRANS
                  )}
                >
                  <Icone size={20} aria-hidden />
                  {entree.libelle}
                  {entree.compteur ? (
                    <span className="absolute top-1.5 left-1/2 ml-2">
                      <Compteur valeur={compteurs[entree.compteur]} ton={tonDe(entree.compteur)} />
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          <li className="contents">
            <button
              type="button"
              aria-expanded={menuOuvert}
              aria-controls="menu-plus"
              onClick={() => setMenuOuvert((ouvert) => !ouvert)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium",
                menuOuvert || secondaireActive ? "text-[#5DCAA5]" : "text-[#9CA3AF]",
                TRANS
              )}
            >
              {menuOuvert ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
              Plus
              {alerteMenu > 0 || aTraiterMenu > 0 ? (
                <span className="absolute top-1.5 left-1/2 ml-2">
                  <Compteur valeur={alerteMenu > 0 ? alerteMenu : aTraiterMenu} ton={alerteMenu > 0 ? "rouge" : "vert"} />
                </span>
              ) : null}
            </button>
          </li>
        </ul>
      </nav>

      {menuOuvert ? (
        <div className="fixed inset-0 z-30 md:hidden" onClick={() => setMenuOuvert(false)}>
          <div className="absolute inset-0 bg-black/40" aria-hidden />
          <div
            id="menu-plus"
            className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] rounded-t-[14px] border-t-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-2"
            onClick={(evenement) => evenement.stopPropagation()}
          >
            <ul className="flex flex-col">
              {DANS_LE_MENU.map((entree) => {
                const Icone = entree.icone;
                const active = estActive(pathname, entree.href);
                return (
                  <li key={entree.href}>
                    <Link
                      href={entree.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-12 items-center gap-3 rounded-[10px] px-3 text-[15px]",
                        active ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#D1D5DB]",
                        TRANS
                      )}
                    >
                      <Icone size={18} aria-hidden className="text-[#9CA3AF]" />
                      <span className="flex-1">{entree.libelle}</span>
                      {entree.compteur ? <Compteur valeur={compteurs[entree.compteur]} ton={tonDe(entree.compteur)} /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
