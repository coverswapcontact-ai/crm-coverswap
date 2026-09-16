"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  CircleCheckBig,
  FolderKanban,
  Hash,
  Menu,
  Radar,
  SlidersHorizontal,
  Users,
  Wallet,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { appelApi } from "./client";
import { TRANS } from "./ui";

export type Compteurs = { aValider: number; tachesEnEchec: number };

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

// Écrans principaux, dans l'ordre de la journée.
const PRINCIPALES: Entree[] = [
  { href: "/dossiers", libelle: "Dossiers", icone: FolderKanban, mobile: true },
  { href: "/validation", libelle: "À valider", icone: CircleCheckBig, compteur: "aValider", mobile: true },
  { href: "/clients", libelle: "Clients", icone: Users, mobile: true },
  { href: "/finances", libelle: "Finances", icone: Wallet, mobile: true },
];

// Écrans secondaires, dans le menu « Plus ».
const SECONDAIRES: Entree[] = [
  { href: "/prospection", libelle: "Prospection", icone: Radar },
  { href: "/taches", libelle: "Tâches de fond", icone: Workflow, compteur: "tachesEnEchec" },
  { href: "/numeros", libelle: "Registre des numéros", icone: Hash },
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
  const [compteurs, setCompteurs] = useState<Compteurs>({ aValider: 0, tachesEnEchec: 0 });
  const [menuOuvert, setMenuOuvert] = useState(false);

  const charger = useCallback(() => {
    appelApi<Compteurs>("/api/pilotage/compteurs")
      .then(setCompteurs)
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

  const secondaireActive = SECONDAIRES.some((entree) => estActive(pathname, entree.href));
  const alerteSecondaire = SECONDAIRES.reduce((total, entree) => total + (entree.compteur ? compteurs[entree.compteur] : 0), 0);

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
              // Écrans secondaires : l'icône seule tant que la place manque, le libellé en grand écran.
              const secondaire = SECONDAIRES.includes(entree);
              return (
                <li key={entree.href}>
                  <Link
                    href={entree.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={secondaire ? entree.libelle : undefined}
                    title={secondaire ? entree.libelle : undefined}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium whitespace-nowrap",
                      active ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:bg-[#1C1F25] hover:text-[#F2F3F5]",
                      TRANS
                    )}
                  >
                    <Icone size={14} aria-hidden />
                    <span className={secondaire ? "hidden xl:inline" : undefined}>{entree.libelle}</span>
                    {entree.compteur ? <Compteur valeur={compteurs[entree.compteur]} ton={tonDe(entree.compteur)} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href="/dashboard"
            className={cn("flex shrink-0 items-center gap-1 text-[12px] whitespace-nowrap text-[#6B7280] hover:text-[#F2F3F5]", TRANS)}
          >
            Anciens écrans
            <ArrowUpRight size={12} aria-hidden />
          </Link>
        </div>
      </nav>

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
              {alerteSecondaire > 0 ? (
                <span className="absolute top-1.5 left-1/2 ml-2">
                  <Compteur valeur={alerteSecondaire} ton="rouge" />
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
              {SECONDAIRES.map((entree) => {
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
              <li>
                <Link href="/dashboard" className="flex h-12 items-center gap-3 rounded-[10px] px-3 text-[15px] text-[#9CA3AF]">
                  <ArrowUpRight size={18} aria-hidden />
                  Anciens écrans
                </Link>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
