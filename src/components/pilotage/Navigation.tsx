"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartLine, FolderKanban, Globe, ListChecks, Mail, Menu, MessagesSquare, PhoneForwarded, SlidersHorizontal, Users, Wallet, WandSparkles, X, type LucideIcon } from "lucide-react";
import type { RappelGoogle } from "@/lib/google/echeance";
import { cn } from "@/lib/utils";
import { appelApi } from "./client";
import { EVENEMENT_COMPTEURS } from "./evenements";
import { BandeauRappelGoogle } from "./RappelGoogle";
import { TRANS } from "./ui";

/**
 * Mission 14 (partie 3) : l'onglet Leads ne compte que les rappels en retard (en rouge).
 * Mission 17 (partie A) : l'onglet Tâches compte les tâches d'« Aujourd'hui » (10 au plus, en vert).
 * Mission 18 (A5) : plus de compteur des tâches de fond en échec : un échec remonte comme tâche système dans Tâches
 * (« Relancer N tâches de fond en échec »), un seul compteur. La route le rend encore, pour les réponses mises en cache.
 */
export type Compteurs = { tachesAujourdhui: number; leadsEnRetard: number; mailATraiter: number; messagesAEnvoyer: number };
type EtatNavigation = Compteurs & { rappelGoogle?: RappelGoogle | null };

// Mission 13 (lot 5) : l'événement vit dans `evenements.ts` (émis par `appelApi` après chaque écriture) ; réexporté pour les écrans qui l'importaient d'ici.
export { EVENEMENT_COMPTEURS, rafraichirCompteurs } from "./evenements";

export type Entree = {
  href: string;
  libelle: string;
  /** Libellé court de la barre du bas (téléphone). */
  court?: string;
  icone: LucideIcon;
  compteur?: keyof Compteurs;
  /** Barre du bas sur téléphone (5 entrées au plus, « Plus » en sixième). */
  mobile?: boolean;
  /** Autres adresses qui allument l'entrée (un écran devenu section d'un autre, sa saisie restée à part). */
  aussi?: string[];
};

// Navigation resserrée (21/09/2026) : ce que Lucas utilise, dans l'ordre du travail — un lead
// devient un dossier, le client avance dans son espace, on s'écrit par SMS, le client reste,
// l'argent rentre. Le simulateur prépare les visuels (depuis ici ou depuis un dossier).
// Mission 13 (lot 7, 29/09/2026) : Commercial, Prospects, Journal, Registre des numéros, SMS, la messagerie et
// l'agent mail v1 sont retirés du CRM (leurs données restent en base) ; À valider et Synthèse restent joignables
// par leur adresse (menu Plus : Simulateur, Finances, Site, Publicité, Tâches de fond, Dépenses, Paramètres).
// Mission 17 (partie A) : « Tâches » en premier, l'accueil de l'application ; sur téléphone, Clients passe dans « Plus »
// (Tâches, Leads, Dossiers, Espaces, Mail, puis Plus).
// Mission 17 (partie B) : « Analytique » (tous les chiffres) rejoint les écrans principaux, sur téléphone aussi : la barre
// du bas devient Tâches, Leads, Dossiers, Mail, Analytique, puis Plus (Espaces clients y passe). « Publicité » et
// « Synthèse » ont disparu (leurs chiffres sont dans l'Analytique ; la chaîne des leads Meta en bas de son onglet Publicité).
// Mission 18 (A1) : l'onglet « Espaces clients » disparaît : l'état de l'espace est une colonne et un filtre de Dossiers
// (/espaces y redirige), le bloc Espace du panneau du dossier et la fiche client gardent les gestes.
// Mission 18 (A3) : « Dépenses » devient une section de Finances (/depenses y redirige) ; la saisie /depenses/nouvelle
// (raccourci de l'application installée) reste et allume Finances.
// Mission 18 (A5) : « Tâches de fond » devient l'onglet Système de Paramètres (/taches-de-fond y redirige), sans badge.
// Mission 18 (A6) : les tarifs passent dans Paramètres (onglet Tarifs). Navigation cible, 10 onglets : principaux Tâches,
// Leads, Dossiers, Mail, Clients, Analytique ; secondaires Simulateur, Site, Finances, Paramètres. Barre du bas inchangée
// (Tâches, Leads, Dossiers, Mail, Analytique, puis Plus) ; « Plus » : Clients, puis Simulateur, Site, Finances, Paramètres.
// Mission 25 (10/10/2026) : « Messagerie » (une conversation par client, les messages préparés, « Un par un ») entre en
// deuxième, dans la barre du bas ; Analytique passe dans « Plus » sur téléphone (toujours en haut sur ordinateur).
export const PRINCIPALES: Entree[] = [
  { href: "/taches", libelle: "Tâches", icone: ListChecks, compteur: "tachesAujourdhui", mobile: true },
  { href: "/messagerie", libelle: "Messagerie", court: "Messages", icone: MessagesSquare, compteur: "messagesAEnvoyer", mobile: true },
  { href: "/leads", libelle: "Leads", icone: PhoneForwarded, compteur: "leadsEnRetard", mobile: true },
  { href: "/dossiers", libelle: "Dossiers", icone: FolderKanban, mobile: true },
  // Mission 7 (22/09/2026) : SMS retiré (pas de numéro professionnel) ; le mail prend le relais : l'onglet Mail, trié d'office.
  { href: "/mail", libelle: "Mail", icone: Mail, compteur: "mailATraiter", mobile: true },
  { href: "/clients", libelle: "Clients", icone: Users },
  { href: "/analytique", libelle: "Analytique", icone: ChartLine },
];

// Écrans secondaires : petites icônes à droite (libellés sur très grand écran), menu « Plus » sur téléphone.
export const SECONDAIRES: Entree[] = [
  { href: "/simulateur", libelle: "Simulateur", icone: WandSparkles },
  { href: "/site", libelle: "Site", icone: Globe },
  { href: "/finances", libelle: "Finances", icone: Wallet, aussi: ["/depenses/nouvelle"] },
  { href: "/parametres", libelle: "Paramètres", icone: SlidersHorizontal },
];

/** Menu « Plus » du téléphone : les écrans principaux absents de la barre du bas, puis les secondaires. */
export const DANS_LE_MENU: Entree[] = [...PRINCIPALES.filter((entree) => !entree.mobile), ...SECONDAIRES];

function estActive(pathname: string, entree: Entree): boolean {
  return [entree.href, ...(entree.aussi ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

function Compteur({ valeur, ton = "vert" }: { valeur: number; ton?: "vert" | "rouge" }) {
  // (une réponse d'avant, servie par le cache hors ligne, peut ne pas connaître la clé)
  if (!valeur || valeur <= 0) return null;
  return (
    <span
      className={cn(
        "min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] leading-[18px] font-semibold tabular-nums",
        ton === "rouge" ? "bg-retard text-white" : "bg-action text-action-texte"
      )}
    >
      {valeur > 99 ? "99+" : valeur}
    </span>
  );
}

function tonDe(cle: keyof Compteurs | undefined): "vert" | "rouge" {
  return cle === "leadsEnRetard" ? "rouge" : "vert";
}

export function Navigation() {
  const pathname = usePathname();
  const [compteurs, setCompteurs] = useState<Compteurs>({ tachesAujourdhui: 0, leadsEnRetard: 0, mailATraiter: 0, messagesAEnvoyer: 0 });
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
    // Mission 13 (lot 5, B9) : au retour sur l'onglet aussi (le téléphone revient d'un appel ou d'une autre application).
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
    setMenuOuvert(false);
  }

  const secondaireActive = DANS_LE_MENU.some((entree) => estActive(pathname, entree));
  const alerteMenu = DANS_LE_MENU.reduce((total, entree) => total + (entree.compteur && tonDe(entree.compteur) === "rouge" ? compteurs[entree.compteur] : 0), 0);
  const aTraiterMenu = DANS_LE_MENU.reduce((total, entree) => total + (entree.compteur && tonDe(entree.compteur) === "vert" ? compteurs[entree.compteur] : 0), 0);

  return (
    <>
      {/* Bureau : barre du haut */}
      <nav
        aria-label="Navigation principale"
        className="sticky top-0 z-40 hidden border-b-[0.5px] border-trait bg-fond/95 backdrop-blur md:block"
      >
        <div className="mx-auto flex h-[52px] max-w-[1680px] items-center gap-4 px-5 lg:gap-6 lg:px-8">
          <Link href="/taches" className="flex items-baseline gap-2 text-[14px] font-semibold tracking-tight text-texte">
            CoverSwap
            <span className="text-[12px] font-normal text-texte-3">pilotage</span>
          </Link>
          <ul className="flex min-w-0 flex-1 items-center gap-1">
            {[...PRINCIPALES, ...SECONDAIRES].map((entree) => {
              const active = estActive(pathname, entree);
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
                      "flex h-11 sm:h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium whitespace-nowrap",
                      active ? "bg-surface-2 text-texte" : "text-texte-3 hover:bg-surface hover:text-texte",
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
        className="fixed inset-x-0 bottom-0 z-40 border-t-[0.5px] border-trait bg-fond/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul
          className="grid h-16"
          style={{ gridTemplateColumns: `repeat(${PRINCIPALES.filter((entree) => entree.mobile).length + 1}, minmax(0, 1fr))` }}
        >
          {PRINCIPALES.filter((entree) => entree.mobile).map((entree) => {
            const active = estActive(pathname, entree);
            const Icone = entree.icone;
            return (
              <li key={entree.href} className="contents">
                <Link
                  href={entree.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    active ? "text-action-clair" : "text-texte-3",
                    TRANS
                  )}
                >
                  <Icone size={20} aria-hidden />
                  {entree.court ?? entree.libelle}
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
                menuOuvert || secondaireActive ? "text-action-clair" : "text-texte-3",
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
            className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] rounded-t-[14px] border-t-[0.5px] border-trait bg-surface p-2"
            onClick={(evenement) => evenement.stopPropagation()}
          >
            <ul className="flex flex-col">
              {DANS_LE_MENU.map((entree) => {
                const Icone = entree.icone;
                const active = estActive(pathname, entree);
                return (
                  <li key={entree.href}>
                    <Link
                      href={entree.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-12 items-center gap-3 rounded-[10px] px-3 text-[15px]",
                        active ? "bg-surface-2 text-texte" : "text-texte-2",
                        TRANS
                      )}
                    >
                      <Icone size={18} aria-hidden className="text-texte-3" />
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
