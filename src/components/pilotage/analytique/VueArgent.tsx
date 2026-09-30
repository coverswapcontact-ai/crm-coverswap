/**
 * Mission 17 (partie B) — onglet Argent : encaissé, signé, marge estimée, panier moyen, dépense pub et carnet de
 * commandes ; encaissé et signé par mois (12 mois glissants), le mois par mois, la pub face à l'encaissé du mois
 * précédent (règle des 20 %), le carnet de commandes ; l'URSSAF à déclarer et les trois seuils de l'année (repris de
 * l'ancien écran Finances, qui garde le travail : reste à encaisser, chèques, points à corriger, livre des recettes) ;
 * les dépenses par catégorie (repris de Dépenses), d'où viennent les clients (repris de Clients), et les outils de
 * l'ancienne Synthèse : export, version rédigée, anonymisation, mois figés.
 */
import Link from "next/link";
import type { Courbe, EcranArgent } from "@/lib/analytique/types";
import { BarresHorizontales, Carte, GrilleTuiles, LienDetail, Progression, Tableau } from "./base";
import { FiscalArgent } from "./FiscalArgent";
import { euros, formaterValeur, moisLong, surLaPeriode } from "./format";
import { CourbeTemps, LegendeCourbe } from "./Graphiques";
import { MoisFigesEtExport } from "./OutilsSynthese";

export function courbeDesMois(ecran: EcranArgent): Courbe {
  return {
    titre: "Encaissé et signé par mois",
    sousTitre: "12 mois glissants",
    series: [
      { cle: "encaisse", libelle: "Encaissé", couleur: "#5DCAA5" },
      { cle: "signe", libelle: "Signé", couleur: "#7AA7FF" },
    ],
    points: ecran.mois.map((m) => ({
      jour: m.mois,
      valeurs: { encaisse: m.encaisse, signe: m.signe },
    })),
  };
}

export function VueArgent({ ecran }: { ecran: EcranArgent }) {
  const courbe = courbeDesMois(ecran);
  const totalCarnet = ecran.carnet.reduce((total, ligne) => total + ligne.montant, 0);
  const mois = [...ecran.mois].reverse();
  const regle = [...ecran.regle20].reverse();
  const { fiscal } = ecran;
  const formatsMois = { encaisse: "euros" as const, signe: "euros" as const };
  // Écran calculé avant la relecture (instantané du jour) : ces blocs arrivent vides plutôt que de casser l'écran.
  const depenses = [...(ecran.depensesParCategorie ?? [])].sort((a, b) => b.montant - a.montant);
  const totalDepenses = depenses.reduce((total, ligne) => total + ligne.montant, 0);
  const clients = ecran.clientsParSource ?? [];
  return (
    <>
      <GrilleTuiles indicateurs={ecran.indicateurs} sources={ecran.sources} />

      <div className="grid gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Carte
          titre={courbe.titre}
          sousTitre={courbe.sousTitre}
          action={
            <span className="hidden md:block">
              <LegendeCourbe courbe={courbe} />
            </span>
          }
        >
          <div className="max-md:hidden">
            <CourbeTemps courbe={courbe} hauteur={260} formats={formatsMois} aire />
          </div>
          <div className="md:hidden">
            <CourbeTemps courbe={courbe} hauteur={170} compact formats={formatsMois} aire />
          </div>
        </Carte>

        <Carte titre="Pub et encaissé" sousTitre="Règle des 20 % : la pub d'un mois face à l'encaissé du mois d'avant" gap="gap-3">
          {regle.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Pas encore de mois à comparer.</p>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {regle.slice(0, 6).map((ligne) => (
                <li key={ligne.mois} className="flex flex-col gap-1.5" data-depasse={ligne.depasse || undefined}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-[#D1D5DB]">{moisLong(ligne.mois)}</span>
                    <span className="text-right text-[12px] text-[#9CA3AF]">
                      {euros(ligne.depensePub)} de pub · {euros(ligne.encaissePrecedent)} encaissés avant
                    </span>
                  </div>
                  {ligne.ratio === null || ligne.depensePub === 0 ? (
                    <p className="text-[12px] text-[#6B7280]">{ligne.depensePub > 0 ? "Rien d'encaissé le mois d'avant : ratio non calculable." : "Pas de pub ce mois-là."}</p>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <Progression
                          ratio={ligne.ratio / (ligne.plafond * 1.25)}
                          hauteur={6}
                          repere={0.8}
                          couleur={ligne.depasse ? "#F5B454" : "#5DCAA5"}
                          titre={`${formaterValeur(ligne.ratio, "pourcent")} (plafond ${formaterValeur(ligne.plafond, "pourcent", { decimales: 0 })})`}
                        />
                      </div>
                      <span className="w-12 text-right font-heading text-[13px] tabular-nums" style={{ color: ligne.depasse ? "#F5B454" : "#F2F3F5" }}>
                        {formaterValeur(ligne.ratio, "pourcent")}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Carte>
      </div>

      <div className="grid gap-3 md:gap-4 xl:grid-cols-2">
        <Carte
          titre="Carnet de commandes"
          sousTitre="Devis envoyés, non signés, non annulés"
          action={<span className="font-heading text-[15px] font-semibold text-[#F5B454] tabular-nums">{euros(totalCarnet)}</span>}
        >
          <Tableau
            largeurMin={480}
            lignes={ecran.carnet}
            cle={(l) => l.dossierId}
            vide="Aucun devis en attente de signature."
            colonnes={[
              {
                cle: "client",
                titre: "Client",
                rendu: (l) => (
                  <Link href={`/dossiers?dossier=${l.dossierId}`} className="block max-w-[200px] truncate text-[#F2F3F5] hover:text-[#8FE0C3]">
                    {l.client}
                  </Link>
                ),
              },
              {
                cle: "numero",
                titre: "Devis",
                rendu: (l) => <span className="font-heading text-[#9CA3AF] tabular-nums">{l.numero ?? "—"}</span>,
              },
              {
                cle: "montant",
                titre: "Montant",
                nombre: true,
                rendu: (l) => euros(l.montant),
              },
              {
                cle: "envoye",
                titre: "Envoyé",
                nombre: true,
                rendu: (l) => (l.envoyeLe ? `${l.envoyeLe.slice(8, 10)}/${l.envoyeLe.slice(5, 7)}` : "—"),
              },
              {
                cle: "relances",
                titre: "Relances",
                nombre: true,
                rendu: (l) => <span className={l.relances === 0 ? "text-[#6B7280]" : undefined}>{l.relances}</span>,
              },
            ]}
          />
        </Carte>

        <Carte titre="Mois par mois" sousTitre="Marge estimée = encaissé − dépenses de chantier rattachées">
          <Tableau
            largeurMin={480}
            lignes={mois}
            cle={(l) => l.mois}
            colonnes={[
              {
                cle: "mois",
                titre: "Mois",
                rendu: (l) => <span className="text-[#F2F3F5]">{moisLong(l.mois)}</span>,
              },
              {
                cle: "encaisse",
                titre: "Encaissé",
                nombre: true,
                rendu: (l) => euros(l.encaisse),
              },
              {
                cle: "signe",
                titre: "Signé",
                nombre: true,
                rendu: (l) => <span className="text-[#9CA3AF]">{euros(l.signe)}</span>,
              },
              {
                cle: "pub",
                titre: "Pub",
                nombre: true,
                rendu: (l) => <span className="text-[#9CA3AF]">{euros(l.depensesPub)}</span>,
              },
              {
                cle: "marge",
                titre: "Marge est.",
                nombre: true,
                rendu: (l) => euros(l.encaisse - l.depensesChantier),
              },
            ]}
          />
        </Carte>
      </div>

      <FiscalArgent fiscal={fiscal} />

      <div className="grid gap-3 md:gap-4 xl:grid-cols-2">
        <Carte
          titre="Dépenses par catégorie"
          sousTitre={`Saisies ${surLaPeriode(ecran.periode)} (écran Dépenses)`}
          action={<LienDetail href="/depenses">Dépenses →</LienDetail>}
          gap="gap-4"
        >
          <BarresHorizontales
            format="euros"
            couleur="#F5B454"
            lignes={depenses.map((ligne) => ({
              cle: ligne.categorie,
              libelle: ligne.libelle,
              valeur: ligne.montant,
              detail: `${ligne.nombre} dépense${ligne.nombre > 1 ? "s" : ""}`,
            }))}
            vide="Aucune dépense saisie sur la période."
          />
          {depenses.length > 0 ? (
            <p className="flex justify-between gap-3 border-t border-[#2A2D34] pt-3 text-[13px] text-[#9CA3AF]">
              <span>Total</span>
              <span className="font-heading text-[#F2F3F5] tabular-nums">{euros(totalDepenses)}</span>
            </p>
          ) : null}
        </Carte>

        <Carte titre="D'où viennent les clients" sousTitre={`Clients arrivés ${surLaPeriode(ecran.periode)}, signés et montant signé, par source`} action={<LienDetail href="/clients">Clients →</LienDetail>}>
          <Tableau
            largeurMin={420}
            lignes={clients}
            cle={(l) => l.source}
            vide="Aucun nouveau client sur la période."
            colonnes={[
              {
                cle: "source",
                titre: "Source",
                rendu: (l) => <span className="text-[#F2F3F5]">{l.libelle}</span>,
              },
              { cle: "clients", titre: "Clients", nombre: true, rendu: (l) => formaterValeur(l.clients, "nombre") },
              { cle: "signes", titre: "Signés", nombre: true, rendu: (l) => <span className={l.signes === 0 ? "text-[#6B7280]" : undefined}>{formaterValeur(l.signes, "nombre")}</span> },
              { cle: "montant", titre: "Montant signé", nombre: true, rendu: (l) => (l.montantSigne > 0 ? euros(l.montantSigne) : <span className="text-[#6B7280]">—</span>) },
            ]}
          />
        </Carte>
      </div>

      <MoisFigesEtExport key={`${ecran.periode.du}:${ecran.periode.au}`} du={ecran.periode.du} au={ecran.periode.au} libellePeriode={ecran.periode.libelle} />
    </>
  );
}
