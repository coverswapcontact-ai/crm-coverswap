/**
 * Mission 17 (partie B) — la Vue d'ensemble, telle que la maquette validée du 30/09/2026 (ordinateur 1 440 px,
 * téléphone 390 px) : résumé du jour et alertes, six tuiles, leads par jour et par source, tunnel commercial,
 * Publicité Meta, SEO Google, Fiche Google, qualité par source, argent et la jauge des 20 %. Au téléphone, l'ordre
 * et les coupes de la maquette : tuiles en deux colonnes, SEO et fiche fusionnés, alertes en dernier.
 */
import Link from "next/link";
import { COULEURS_FAMILLE, LIBELLES_FAMILLE, type Alerte, type EcranEnsemble, type LigneSource } from "@/lib/analytique/types";
import { cn } from "@/lib/utils";
import {
  BadgeVerdict,
  BarresHorizontales,
  Carte,
  CARTE_A,
  ENCADRE,
  EtatVideSource,
  GrilleMini,
  GrilleTuiles,
  LBL,
  LienDetail,
  MiniIndicateur,
  Pastille,
  Progression,
  Tableau,
  TunnelBarres,
  etatDe,
  libelleEtat,
  phrasePerte,
} from "./base";
import { CourbeEnsemble } from "./CourbeEnsemble";
import { GRIS_ABSENT, dateHeureLongue, euros, formaterValeur, momentSynchro, moisCourt, surLaPeriode } from "./format";
import { AgentEtQualite } from "./OutilsSynthese";
import { adresseAnalytique } from "./requete";

/** Ordre des tuiles au téléphone (maquette) : Leads, Coût / lead Meta, Simulations, Devis, Signés, Visites. */
export const ORDRE_TUILES_TELEPHONE = ["leads", "coutParLead", "coutParLeadMeta", "coutParSigne", "simulations", "devis", "signes", "visites"];

/** Libellés des tuiles au téléphone (maquette). */
export const LIBELLES_TUILES_TELEPHONE: Record<string, string> = {
  visites: "Visites",
  signes: "Signés",
  coutParLead: "Coût / lead Meta",
  coutParLeadMeta: "Coût / lead Meta",
  coutParSigne: "Coût / signé",
};

/** Le tunnel de la Vue d'ensemble : libellés de l'écran (maquette : « Devis envoyés », « Devis » au téléphone). */
export const LIBELLES_TUNNEL = {
  visites: { long: "Visites", court: "Visites" },
  simulations: { long: "Simulations", court: "Simulations" },
  devis: { long: "Devis envoyés", court: "Devis" },
  encaisses: { long: "Encaissés", court: "Encaissés" },
  encaisse: { long: "Encaissés", court: "Encaissés" },
};

/** Au téléphone, la première phrase seulement (maquette : « 4 devis pour 45 leads, aucun signé. »). */
export function premierePhrase(texte: string): string {
  const coupe = texte.match(/^.+?[.!?](?=\s+[A-ZÀÂÉÈÊÎÔÛÇ0-9«])/u);
  return coupe ? coupe[0] : texte;
}

/** Le sous-titre du tunnel : la source filtrée, puis la période. */
export function sousTitreTunnel(ecran: Pick<EcranEnsemble, "filtreSource" | "periode">): string {
  const source = ecran.filtreSource ? `Source ${LIBELLES_FAMILLE[ecran.filtreSource]}` : "Toutes sources";
  return `${source}, ${ecran.periode.libelle.charAt(0).toLowerCase()}${ecran.periode.libelle.slice(1)}`;
}

// « À faire » : blanc à l'ordinateur, couleur du texte au téléphone (maquette).
const COULEURS_PHRASE = {
  MONTE: "text-[#5DCAA5]",
  BAISSE: "text-[#F5B454]",
  A_FAIRE: "md:text-[#F2F3F5]",
} as const;

export { surLaPeriode };

function ListeAlertes({ alertes, compact = false }: { alertes: Alerte[]; compact?: boolean }) {
  // Téléphone : les informations sans conséquence (gris) sont omises (maquette).
  const visibles = compact ? alertes.filter((alerte) => alerte.gravite !== "INFO") : alertes;
  if (visibles.length === 0) return <p className="text-[13px] text-[#6B7280]">Rien à signaler.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {visibles.map((alerte) => {
        const couleur = alerte.gravite === "ATTENTION" ? "#F5B454" : "#9CA3AF";
        const texte = alerte.lien ? (
          <Link href={alerte.lien} className="underline-offset-2 hover:underline" style={{ color: couleur }}>
            {alerte.texte}
          </Link>
        ) : (
          alerte.texte
        );
        return (
          <li key={alerte.cle} className={cn("flex gap-2 text-[13px] leading-[1.4]", compact && "gap-1.5")} style={{ color: couleur }} data-gravite={alerte.gravite}>
            <span aria-hidden>●</span>
            <span>{texte}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Resume({ ecran }: { ecran: EcranEnsemble }) {
  const { resume } = ecran;
  const heure = resume ? momentSynchro(resume.genereLe, new Date(resume.genereLe)).replace(/^à /, "") : null;
  return (
    <section
      className={cn(CARTE_A, "grid items-start gap-2.5 border-[#24463A] bg-[#1A2420] p-4 md:gap-7 md:px-[26px] md:py-[22px] lg:grid-cols-[200px_minmax(0,1fr)_280px]")}
      aria-label="Résumé du jour"
    >
      <div className="flex flex-col gap-1.5">
        <p className={cn(LBL, "text-[#5DCAA5]")}>
          Résumé du jour
          {heure ? <span className="md:hidden"> · {heure}</span> : null}
        </p>
        {resume ? <p className="hidden text-[13px] text-[#9CA3AF] md:block">{dateHeureLongue(resume.genereLe)}</p> : null}
      </div>
      <div className="flex flex-col gap-2.5 text-[14px] leading-[1.5] text-[#E5E7EB] md:text-[15px]">
        {resume && resume.phrases.length > 0 ? (
          resume.phrases.map((phrase) => (
            <p key={phrase.genre + phrase.amorce} title={phrase.sources.length > 0 ? `Sources : ${phrase.sources.join(", ")}` : undefined}>
              <span className={cn("font-semibold", COULEURS_PHRASE[phrase.genre])}>{phrase.amorce}</span>{" "}
              {premierePhrase(phrase.texte) !== phrase.texte ? (
                <>
                  <span className="md:hidden">{premierePhrase(phrase.texte)}</span>
                  <span className="hidden md:inline">{phrase.texte}</span>
                </>
              ) : (
                phrase.texte
              )}
            </p>
          ))
        ) : (
          <p className="text-[#9CA3AF]">Le résumé se compose chaque matin à 7 h, à partir des chiffres de la veille.</p>
        )}
      </div>
      <div className="hidden flex-col gap-2 md:flex">
        <p className={LBL}>Alertes</p>
        <ListeAlertes alertes={ecran.alertes} />
      </div>
    </section>
  );
}

function CartePublicite({ ecran }: { ecran: EcranEnsemble }) {
  const pub = ecran.publicite;
  const meta = etatDe(ecran.sources, "META");
  const googleAds = etatDe(ecran.sources, "GOOGLE_ADS");
  const premierVerdict = pub?.publicites[0]?.verdict;
  const approx = Boolean(pub?.estimation);
  return (
    <Carte
      titre="Publicité Meta"
      action={
        <>
          <span className="hidden md:inline">
            <LienDetail
              href={adresseAnalytique({
                onglet: "publicite",
                periode: ecran.periode.cle,
                du: ecran.periode.du,
                au: ecran.periode.au,
              })}
            />
          </span>
          {premierVerdict ? (
            <span className="md:hidden">
              <BadgeVerdict verdict={premierVerdict} />
            </span>
          ) : null}
        </>
      }
    >
      {!pub ? (
        <EtatVideSource etat={meta} quoi="Publicité Meta" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-[12px] text-[#9CA3AF] md:text-[13px]">
              <span>
                {pub.jourCampagne !== null && pub.dureeCampagne ? (
                  <>
                    <span className="hidden md:inline">Campagne&nbsp;: jour</span>
                    <span className="md:hidden">Jour</span> {pub.jourCampagne} sur {pub.dureeCampagne}
                  </>
                ) : (
                  "Pas de campagne en cours"
                )}
              </span>
              <span>
                {euros(pub.depense, { approximatif: approx })}
                {pub.budget ? ` sur ${euros(pub.budget)}` : ""}
              </span>
            </div>
            {pub.budget && pub.depense !== null ? <Progression ratio={pub.depense / pub.budget} titre={`${euros(pub.depense)} dépensés sur ${euros(pub.budget)} de budget`} /> : null}
          </div>
          <GrilleMini>
            <MiniIndicateur libelle="Leads" valeur={formaterValeur(pub.leads, "nombre")} />
            <MiniIndicateur libelle="Par lead" valeur={euros(pub.coutParLead, { approximatif: approx })} />
            <MiniIndicateur
              libelle="Par devis"
              valeur={euros(pub.coutParDevis, {
                approximatif: approx,
                decimales: 0,
              })}
            />
          </GrilleMini>
          {pub.publicites.length > 0 ? (
            <ul className="hidden flex-col md:flex">
              {pub.publicites.slice(0, 3).map((publicite) => (
                <li key={publicite.nom} className="flex items-center justify-between gap-3 border-t border-[#2A2D34] py-3.5 last:pb-0">
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <p className="truncate text-[14px] font-medium text-[#F2F3F5]">{publicite.nom}</p>
                    <p className="truncate text-[12px] text-[#9CA3AF]">{publicite.detail}</p>
                  </div>
                  <BadgeVerdict verdict={publicite.verdict} />
                </li>
              ))}
            </ul>
          ) : null}
          {pub.estimation ? <p className="text-[12px] text-[#F5B454]">Dépense estimée au prorata du budget&nbsp;: Meta n&apos;est pas synchronisé.</p> : null}
        </>
      )}
      {googleAds && googleAds.etat !== "A_JOUR" ? (
        <p className="hidden text-[12px] text-[#6B7280] md:block">
          Google Ads&nbsp;: {googleAds.etat === "EN_ECHEC" ? "synchronisation en échec" : googleAds.etat === "EN_ATTENTE_ACCES" ? "en attente d'accès" : "pas encore branché"}
        </p>
      ) : null}
    </Carte>
  );
}

function CarteSeo({ ecran }: { ecran: EcranEnsemble }) {
  const seo = ecran.seo;
  return (
    <Carte
      titre="SEO Google"
      action={
        <LienDetail
          href={adresseAnalytique({
            onglet: "seo",
            periode: ecran.periode.cle,
            du: ecran.periode.du,
            au: ecran.periode.au,
          })}
        />
      }
      className="max-md:hidden"
    >
      {!seo ? (
        <EtatVideSource etat={etatDe(ecran.sources, "SEARCH_CONSOLE")} quoi="Search Console" />
      ) : (
        <>
          <GrilleMini>
            <MiniIndicateur libelle="Clics" valeur={formaterValeur(seo.clics, "nombre")} />
            <MiniIndicateur libelle="Affichages" valeur={formaterValeur(seo.impressions, "nombre")} />
            <MiniIndicateur libelle="Position" valeur={formaterValeur(seo.position, "position")} />
          </GrilleMini>
          <div className="flex flex-col gap-2.5">
            <p className={LBL}>Opportunités&nbsp;: vu, jamais cliqué</p>
            <BarresHorizontales
              couleur="#F5B454"
              lignes={seo.opportunites.slice(0, 3).map((o) => ({
                cle: o.requete,
                libelle: o.requete,
                valeur: o.impressions,
              }))}
              vide="Aucune requête affichée sans clic."
            />
          </div>
        </>
      )}
    </Carte>
  );
}

/** La courbe mensuelle des vues de la fiche : aire bleue discrète, sans axe (maquette). */
function MiniCourbeMois({ mois }: { mois: { mois: string; vues: number }[] }) {
  if (mois.length < 2) return null;
  const max = Math.max(...mois.map((m) => m.vues), 1);
  const points = mois.map((m, i) => `${(i / (mois.length - 1)) * 300},${68 - (m.vues / max) * 62}`).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <svg
        className="block h-[70px] w-full"
        viewBox="0 0 300 70"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Vues de la fiche par mois : ${mois.map((m) => `${moisCourt(m.mois)} ${m.vues}`).join(", ")}`}
      >
        <path d={`M${points.split(" ").join(" L")} L300,70 L0,70 Z`} fill="#7AA7FF" fillOpacity={0.12} />
        <polyline points={points} fill="none" stroke="#7AA7FF" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[11px] text-[#6B7280]">
        {mois.map((m) => (
          <span key={m.mois} title={`${m.vues} vues`}>
            {moisCourt(m.mois)}
          </span>
        ))}
      </div>
    </div>
  );
}

function CarteFiche({ ecran }: { ecran: EcranEnsemble }) {
  const fiche = ecran.fiche;
  const etat = etatDe(ecran.sources, "FICHE_GOOGLE");
  const enAttente = etat && etat.etat !== "A_JOUR";
  return (
    <Carte
      titre="Fiche Google"
      className="max-md:hidden"
      action={
        enAttente ? (
          <span className="text-[12px] text-[#F5B454]">{libelleEtat(etat)}</span>
        ) : (
          <LienDetail
            href={adresseAnalytique({
              onglet: "seo",
              periode: ecran.periode.cle,
              du: ecran.periode.du,
              au: ecran.periode.au,
            })}
          />
        )
      }
    >
      {!fiche ? (
        <EtatVideSource etat={etat} quoi="Fiche Google" />
      ) : (
        <>
          <GrilleMini>
            <MiniIndicateur libelle="Vues" valeur={formaterValeur(fiche.vues, "nombre")} />
            <MiniIndicateur libelle="Interactions" valeur={formaterValeur(fiche.interactions, "nombre")} />
            <MiniIndicateur libelle="Avis" valeur={fiche.avis === null ? "—" : `${fiche.avis}${fiche.note !== null ? ` · ${formaterValeur(fiche.note, "position")}` : ""}`} />
          </GrilleMini>
          <MiniCourbeMois mois={fiche.mois} />
        </>
      )}
    </Carte>
  );
}

const TEXTE_ETAT_FICHE = { A_JOUR: "à jour", EN_ECHEC: "synchronisation en échec", NON_BRANCHEE: "pas encore branchée", EN_ATTENTE_ACCES: "accès API en attente" } as const;

/** Téléphone : SEO et fiche Google fusionnés, avec la première opportunité. */
function CarteSeoFicheTelephone({ ecran }: { ecran: EcranEnsemble }) {
  const { seo, fiche } = ecran;
  const opportunite = seo?.opportunites[0];
  return (
    <Carte titre="SEO et fiche Google" className="md:hidden">
      {seo ? (
        <GrilleMini>
          <MiniIndicateur libelle="Clics" valeur={formaterValeur(seo.clics, "nombre")} />
          <MiniIndicateur libelle="Position" valeur={formaterValeur(seo.position, "position")} />
          <MiniIndicateur libelle="Vues fiche" valeur={formaterValeur(fiche?.vues ?? null, "nombre")} couleur={fiche?.vues == null ? GRIS_ABSENT : undefined} />
        </GrilleMini>
      ) : (
        <EtatVideSource etat={etatDe(ecran.sources, "SEARCH_CONSOLE")} quoi="Search Console" compact />
      )}
      {opportunite ? (
        <p className={ENCADRE}>
          <span className="text-[#F5B454]">Opportunité&nbsp;:</span>{" "}
          «&nbsp;
          {opportunite.requete}&nbsp;», {formaterValeur(opportunite.impressions, "nombre")} affichages, {formaterValeur(opportunite.clics, "nombre")} clic.
        </p>
      ) : null}
      {!fiche && seo ? (
        <p className="text-[12px] text-[#9CA3AF]">
          Fiche Google&nbsp;: {TEXTE_ETAT_FICHE[etatDe(ecran.sources, "FICHE_GOOGLE")?.etat ?? "NON_BRANCHEE"]}
        </p>
      ) : null}
      {!fiche && !seo ? <EtatVideSource etat={etatDe(ecran.sources, "FICHE_GOOGLE")} quoi="Fiche Google" compact /> : null}
    </Carte>
  );
}

function CarteQualite({ lignes }: { lignes: LigneSource[] }) {
  const meilleur = Math.max(...lignes.filter((l) => !l.horsTunnel && l.tauxDevis !== null).map((l) => l.tauxDevis as number), -1);
  return (
    <Carte titre="Qualité par source" gap="gap-4">
      <Tableau
        largeurMin={420}
        lignes={lignes}
        cle={(ligne) => `${ligne.famille}:${ligne.libelle}`}
        vide="Aucun lead sur la période."
        colonnes={[
          {
            cle: "source",
            titre: "Source",
            className: "w-[40%]",
            rendu: (ligne) => (
              <span className="flex items-center gap-2 text-[#F2F3F5]">
                <Pastille couleur={COULEURS_FAMILLE[ligne.famille]} />
                <span className="truncate">{ligne.libelle}</span>
                {ligne.note ? <span className="text-[11px] text-[#6B7280]">({ligne.note})</span> : null}
              </span>
            ),
          },
          {
            cle: "leads",
            titre: "Leads",
            nombre: true,
            rendu: (ligne) => formaterValeur(ligne.leads, "nombre"),
          },
          {
            cle: "joints",
            titre: "Joints",
            nombre: true,
            rendu: (ligne) => (ligne.horsTunnel ? "—" : formaterValeur(ligne.joints, "nombre")),
          },
          {
            cle: "devis",
            titre: "Devis",
            nombre: true,
            rendu: (ligne) => formaterValeur(ligne.devis, "nombre"),
          },
          {
            cle: "taux",
            titre: "Taux devis",
            nombre: true,
            rendu: (ligne) =>
              ligne.tauxDevis === null || ligne.horsTunnel ? (
                <span className="text-[#9CA3AF]">—</span>
              ) : (
                <span className={ligne.tauxDevis === meilleur && meilleur > 0 ? "font-semibold text-[#5DCAA5]" : "text-[#9CA3AF]"}>
                  {formaterValeur(ligne.tauxDevis, "pourcent", {
                    decimales: 0,
                  })}
                </span>
              ),
          },
        ]}
      />
    </Carte>
  );
}

/** La jauge des 20 % : repère du plafond aux 4/5 de la barre (pleine barre = 25 %), ambre au-delà du plafond. */
export function JaugePub({ ratio, plafond }: { ratio: number | null; plafond: number }) {
  const echelle = plafond * 1.25;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between gap-3 text-[13px] text-[#9CA3AF]">
        <span>
          Pub réinvestie sur le chiffre encaissé
          {ratio !== null ? (
            <>
              {" "}
              · <span className={cn("font-heading tabular-nums", ratio > plafond ? "text-[#F5B454]" : "text-[#F2F3F5]")}>{formaterValeur(ratio, "pourcent")}</span>
            </>
          ) : null}
        </span>
        <span className="shrink-0">plafond {formaterValeur(plafond, "pourcent", { decimales: 0 })}</span>
      </div>
      {ratio === null ? (
        <p className="text-[12px] text-[#6B7280]">Rien d&apos;encaissé sur la période&nbsp;: ratio non calculable.</p>
      ) : (
        <Progression
          ratio={ratio / echelle}
          hauteur={8}
          repere={plafond / echelle}
          couleur={ratio > plafond ? "#F5B454" : "#5DCAA5"}
          titre={`${formaterValeur(ratio, "pourcent")} de l'encaissé réinvesti en publicité (plafond ${formaterValeur(plafond, "pourcent", { decimales: 0 })})`}
        />
      )}
    </div>
  );
}

function CarteArgent({ ecran }: { ecran: EcranEnsemble }) {
  const { argent, periode } = ecran;
  return (
    <Carte
      titre="Argent"
      gap="gap-4"
      action={
        <LienDetail
          href={adresseAnalytique({
            onglet: "argent",
            periode: periode.cle,
            du: periode.du,
            au: periode.au,
          })}
        />
      }
    >
      <GrilleMini>
        <MiniIndicateur libelle={`Encaissé ${surLaPeriode(periode)}`} valeur={euros(argent.encaisse)} />
        <MiniIndicateur libelle="Devis en attente" valeur={euros(argent.devisEnAttente)} couleur={argent.devisEnAttente > 0 ? "#F5B454" : undefined} />
        <MiniIndicateur libelle="Dépense pub" valeur={euros(argent.depensePub)} couleur={argent.depensePub === null ? GRIS_ABSENT : undefined} />
      </GrilleMini>
      <JaugePub ratio={argent.ratioPub} plafond={argent.plafond} />
      <p className="text-[12px] text-[#6B7280]">
        Règle&nbsp;: la pub d&apos;un mois ne dépasse pas {formaterValeur(argent.plafond, "pourcent", { decimales: 0 })} de l&apos;encaissé du mois précédent (livre des recettes).
      </p>
    </Carte>
  );
}

export function VueEnsemble({ ecran }: { ecran: EcranEnsemble }) {
  const { tunnel } = ecran;
  return (
    <>
      <Resume ecran={ecran} />

      <GrilleTuiles
        indicateurs={ecran.indicateurs}
        sources={ecran.sources}
        ordreTelephone={ORDRE_TUILES_TELEPHONE}
        libellesCourts={LIBELLES_TUILES_TELEPHONE}
        estimation={Boolean(ecran.publicite?.estimation)}
      />

      <div className="grid gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <CourbeEnsemble courbeLeads={ecran.courbeLeads} courbeDevis={ecran.courbeDevis ?? null} />

        <Carte titre="Tunnel commercial" sousTitre={<span className="hidden md:inline">{sousTitreTunnel(ecran)}</span>} gap="gap-3 md:gap-[18px]">
          {/* Des visites aux encaissés : le site (visites, simulations) et le commercial (leads → encaissés), chacun à
              son échelle ; au téléphone, la partie du site se replie (la maquette commence aux leads). */}
          <TunnelBarres tunnel={tunnel} groupes={["leads"]} replierAuTelephone sansTaux={["signes"]} libelles={LIBELLES_TUNNEL} encadre={false} />
          {tunnel.perteMax ? (
            <p className={cn(ENCADRE, "px-3.5 py-3 max-md:hidden")}>
              L&apos;étape qui perd le plus&nbsp;: <span className="text-[#F5B454]">{tunnel.perteMax.libelle}</span>. {phrasePerte(tunnel.perteMax)}
            </p>
          ) : null}
        </Carte>
      </div>

      <div className="grid gap-3 md:gap-4 lg:grid-cols-3">
        <CartePublicite ecran={ecran} />
        <CarteSeo ecran={ecran} />
        <CarteFiche ecran={ecran} />
        <CarteSeoFicheTelephone ecran={ecran} />
      </div>

      <div className="grid gap-3 max-md:hidden md:gap-4 lg:grid-cols-2">
        <CarteQualite lignes={ecran.qualite} />
        <CarteArgent ecran={ecran} />
      </div>

      <Carte className="md:hidden" gap="gap-2.5">
        <p className={LBL}>Alertes</p>
        <ListeAlertes alertes={ecran.alertes} compact />
      </Carte>

      <AgentEtQualite du={ecran.periode.du} au={ecran.periode.au} />
    </>
  );
}
