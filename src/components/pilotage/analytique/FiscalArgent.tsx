"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { useParametresExiges } from "@/components/pilotage/SaisieParametres";
import { Bouton } from "@/components/pilotage/ui";
import type { EcranArgent } from "@/lib/analytique/types";
import { DEFINITIONS_PARAMETRES, type CleParametre } from "@/lib/parametres/definitions";
import { cn } from "@/lib/utils";
import { Carte, ENCADRE, LBL, NUM, Progression } from "./base";
import { euros, formaterValeur } from "./format";

/**
 * Mission 17 (partie B, relecture) — les outils de l'ancien écran Finances repris dans l'onglet Argent : l'URSSAF à
 * déclarer (période, échéance, base, détail cotisations / formation professionnelle / versement libératoire) et la
 * période en cours ; les trois seuils de l'année (franchise de TVA, franchise majorée, plafond de la micro-entreprise)
 * avec la projection au 31 décembre ; un paramètre manquant se renseigne sur place (« Renseigner » : la fenêtre des
 * paramètres exigés, puis l'écran se relit). Jamais de valeur supposée, jamais de rouge.
 */

type Fiscal = NonNullable<EcranArgent["fiscal"]>;

const estCle = (cle: string): cle is CleParametre => Object.hasOwn(DEFINITIONS_PARAMETRES, cle);

/** « Pour … il manque : … » et « Renseigner » (même geste que l'écran Finances). */
export function AParametrer({ manquants, pourquoi, onRenseigner }: { manquants: CleParametre[]; pourquoi: string; onRenseigner: () => void }) {
  return (
    <div className={cn(ENCADRE, "flex flex-col gap-2.5 px-3.5 py-3 sm:flex-row sm:items-center")} data-a-parametrer={manquants.join(",")}>
      <SlidersHorizontal size={16} aria-hidden className="shrink-0 text-[#F5B454]" />
      <p className="flex-1">
        {pourquoi} Il manque&nbsp;: {manquants.map((cle) => DEFINITIONS_PARAMETRES[cle].libelle.toLowerCase()).join(" ; ")}.
      </p>
      <Bouton variante="secondaire" taille="sm" onClick={onRenseigner}>
        Renseigner
      </Bouton>
    </div>
  );
}

function ratioSeuil(seuil: Fiscal["seuils"][number]): number | null {
  if (seuil.ratio !== null && seuil.ratio !== undefined) return seuil.ratio;
  return seuil.plafond ? seuil.atteint / seuil.plafond : null;
}

function Seuils({ seuils }: { seuils: Fiscal["seuils"] }) {
  return (
    <ul className="flex flex-col gap-4">
      {seuils.map((seuil) => {
        const ratio = ratioSeuil(seuil);
        const couleur = ratio !== null && ratio >= 0.8 ? "#F5B454" : "#5DCAA5";
        const depassera = seuil.projection !== null && seuil.plafond !== null && seuil.projection > seuil.plafond;
        return (
          <li key={seuil.cle} className="flex flex-col gap-1.5" data-seuil={seuil.cle}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
              <span className="text-[#D1D5DB]">{seuil.libelle}</span>
              <span className="text-[#9CA3AF]">
                <span className={cn(NUM, "text-[#F2F3F5]")}>{euros(seuil.atteint)}</span>
                {seuil.plafond !== null ? ` sur ${euros(seuil.plafond)}` : " · seuil à renseigner"}
                {ratio !== null ? <span style={{ color: couleur }}> · {formaterValeur(ratio, "pourcent")}</span> : null}
              </span>
            </div>
            {seuil.plafond !== null ? <Progression ratio={ratio ?? 0} hauteur={8} couleur={couleur} titre={`${euros(seuil.atteint)} encaissés depuis le 1er janvier, seuil ${euros(seuil.plafond)}`} /> : null}
            {seuil.projection !== null ? (
              <p className={cn("text-[12px]", depassera ? "text-[#F5B454]" : "text-[#6B7280]")}>
                Au rythme actuel&nbsp;: {euros(seuil.projection)} au 31 décembre{depassera ? ", seuil dépassé si le rythme continue" : ""}.
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** « 31/07/2026 » pour une date AAAA-MM-JJ (le texte tel quel sinon). */
export function dateEcheance(echeance: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(echeance);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : echeance;
}

/** L'échéance de la déclaration : à venir (ambre), passée (gris : déjà déclarée, ou à régulariser). */
function TexteEcheance({ echeance, aujourdhui }: { echeance: string | null; aujourdhui: string }) {
  if (!echeance) return <p className="text-[12px] text-[#9CA3AF]">Échéance à vérifier dans l&apos;espace URSSAF.</p>;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(echeance);
  if (iso && echeance < aujourdhui) return <p className="text-[12px] text-[#9CA3AF]">Échéance de déclaration passée ({dateEcheance(echeance)})&nbsp;: à vérifier dans l&apos;espace URSSAF.</p>;
  return <p className="text-[12px] text-[#F5B454]">À déclarer au plus tard le {dateEcheance(echeance)}.</p>;
}

function Urssaf({ urssaf, aujourdhui }: { urssaf: NonNullable<Fiscal["urssaf"]>; aujourdhui: string }) {
  const { aDeclarer, enCours } = urssaf;
  return (
    <div className="flex flex-col gap-4">
      {aDeclarer ? (
        <div className="flex flex-col gap-2" data-urssaf="a-declarer">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-[14px] font-medium text-[#F2F3F5]">
              À déclarer&nbsp;: <span>{aDeclarer.libelle}</span>
            </p>
            <span className={cn(NUM, "text-[20px] font-semibold", aDeclarer.echeance && aDeclarer.echeance < aujourdhui ? "text-[#F2F3F5]" : "text-[#F5B454]")}>{euros(aDeclarer.montant)}</span>
          </div>
          <TexteEcheance echeance={aDeclarer.echeance} aujourdhui={aujourdhui} />
          <dl className="flex flex-col gap-1 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-[#9CA3AF]">Chiffre d&apos;affaires encaissé sur la période</dt>
              <dd className={cn(NUM, "text-[#F2F3F5]")}>{euros(aDeclarer.base)}</dd>
            </div>
            {aDeclarer.detail.map((ligne) => (
              <div key={ligne.libelle} className="flex justify-between gap-3">
                <dt className="text-[#9CA3AF]">{ligne.libelle}</dt>
                <dd className={cn(NUM, "text-[#D1D5DB]")}>{euros(ligne.montant)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-[#2A2D34] pt-1">
              <dt className="text-[#D1D5DB]">Total estimé</dt>
              <dd className={cn(NUM, "font-semibold text-[#F2F3F5]")}>{euros(aDeclarer.montant)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
      {enCours ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-[#2A2D34] pt-3 text-[13px]" data-urssaf="en-cours">
          <span className="text-[#9CA3AF]">
            En cours&nbsp;: <span className="text-[#D1D5DB]">{enCours.libelle}</span> · {euros(enCours.base)} encaissés
          </span>
          <span className={cn(NUM, "text-[#F2F3F5]")}>{euros(enCours.montant)} estimés</span>
        </div>
      ) : null}
      <p className="text-[12px] text-[#6B7280]">
        Estimation sur l&apos;encaissé de chaque période URSSAF (pas la période choisie en haut de l&apos;écran), aux taux saisis dans les paramètres&nbsp;; le montant exact est calculé par
        l&apos;URSSAF sur le chiffre déclaré.
      </p>
    </div>
  );
}

export function FiscalArgent({ fiscal, aujourdhui }: { fiscal: EcranArgent["fiscal"]; aujourdhui: string }) {
  const router = useRouter();
  const { demander, modale } = useParametresExiges();
  const manquants = (fiscal?.parametresManquants ?? []).filter(estCle);
  const renseigner = (cles: CleParametre[]) => demander(cles, async () => router.refresh());
  const seuils = fiscal?.seuils ?? [];
  const urssaf = fiscal?.urssaf ?? null;
  const manquantsUrssaf = manquants.filter((cle) => /URSSAF|TAUX_COTISATIONS|TAUX_CFP|VERSEMENT|PERIODICITE/.test(cle));
  const manquantsSeuils = manquants.filter((cle) => /SEUIL|PLAFOND/.test(cle));
  const autres = manquants.filter((cle) => !manquantsUrssaf.includes(cle) && !manquantsSeuils.includes(cle));

  return (
    <Carte titre="URSSAF et seuils de l'année" action={<Link href="/finances" className="text-[13px] text-[#5DCAA5] hover:text-[#8FE0C3]">Finances →</Link>} gap="gap-4">
      {!fiscal ? (
        <p className="text-[13px] text-[#9CA3AF]">Le tableau des finances est illisible pour l&apos;instant&nbsp;: réessaie dans un moment, ou ouvre l&apos;écran Finances.</p>
      ) : (
        <>
          {autres.length > 0 ? <AParametrer manquants={autres} pourquoi="Pour dater les chèques dans le livre des recettes (à confirmer par le comptable)." onRenseigner={() => renseigner(autres)} /> : null}
          <div className="grid gap-6 md:grid-cols-2 md:gap-8">
            <section className="flex min-w-0 flex-col gap-3" aria-label="URSSAF">
              <p className={LBL}>URSSAF</p>
              {urssaf && (urssaf.aDeclarer || urssaf.enCours) ? <Urssaf urssaf={urssaf} aujourdhui={aujourdhui} /> : null}
              {manquantsUrssaf.length > 0 ? (
                <AParametrer manquants={manquantsUrssaf} pourquoi="Pour estimer ce qui est dû à l'URSSAF." onRenseigner={() => renseigner(manquantsUrssaf)} />
              ) : !urssaf || (!urssaf.aDeclarer && !urssaf.enCours) ? (
                <p className="text-[13px] text-[#6B7280]">Rien à estimer pour l&apos;instant.</p>
              ) : null}
            </section>
            <section className="flex min-w-0 flex-col gap-3" aria-label="Seuils de l'année">
              <p className={LBL}>Seuils de l&apos;année</p>
              {seuils.length > 0 ? <Seuils seuils={seuils} /> : null}
              {manquantsSeuils.length > 0 ? (
                <AParametrer manquants={manquantsSeuils} pourquoi="Pour suivre la progression vers les seuils fiscaux." onRenseigner={() => renseigner(manquantsSeuils)} />
              ) : seuils.length === 0 ? (
                <p className="text-[13px] text-[#6B7280]">Seuils à renseigner dans Paramètres (Facturation).</p>
              ) : (
                <p className="text-[12px] text-[#6B7280]">Chiffre d&apos;affaires encaissé du 1er janvier à aujourd&apos;hui (livre des recettes). Les règles de dépassement sont à vérifier avec le comptable.</p>
              )}
            </section>
          </div>
        </>
      )}
      <p className={ENCADRE}>
        Le travail sur l&apos;argent reste dans{" "}
        <Link href="/finances" className="text-[#5DCAA5] hover:text-[#8FE0C3]">
          Finances
        </Link>
        &nbsp;: reste à encaisser et saisie des paiements, chèques à créditer, points à corriger, livre des recettes et son export.
      </p>
      {modale}
    </Carte>
  );
}
