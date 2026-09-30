/**
 * Mission 17 (partie B) — onglet Publicité : jour de campagne et règle du jour, huit tuiles (dépense, impressions,
 * clics, CTR, CPM, leads Meta, coût par lead, coût par chantier signé), dépense et leads par jour (deux courbes, jamais
 * un double axe), tableau campagnes → ensembles → publicités avec coûts, retour sur dépense et verdict, place Google
 * Ads (vide tant que non branché), puis la chaîne des leads Meta (outil de travail repris de l'ancien /publicite).
 */
import type { EcranPublicite, LignePublicite } from "@/lib/analytique/types";
import type { SanteMeta } from "@/lib/meta/sante";
import { cn } from "@/lib/utils";
import { BadgeVerdict, Carte, ENCADRE, EtatVideSource, GrilleTuiles, Progression, Tableau, etatDe, type Colonne } from "./base";
import { ChaineMeta } from "./ChaineMeta";
import { euros, formaterValeur, jourAxe } from "./format";
import { CourbeTemps } from "./Graphiques";

/** Campagnes, puis leurs ensembles, puis leurs publicités (rattachés par nom ; un orphelin reste à la fin). */
export function ordonnerLignes(lignes: LignePublicite[]): (LignePublicite & { profondeur: number })[] {
  const resultat: (LignePublicite & { profondeur: number })[] = [];
  const vues = new Set<LignePublicite>();
  const ajouter = (ligne: LignePublicite, profondeur: number) => {
    if (vues.has(ligne)) return;
    vues.add(ligne);
    resultat.push({ ...ligne, profondeur });
  };
  for (const campagne of lignes.filter((l) => l.niveau === "CAMPAGNE")) {
    ajouter(campagne, 0);
    for (const ensemble of lignes.filter((l) => l.niveau === "ENSEMBLE" && l.parentNom === campagne.nom && l.plateforme === campagne.plateforme)) {
      ajouter(ensemble, 1);
      for (const publicite of lignes.filter((l) => l.niveau === "PUBLICITE" && l.parentNom === ensemble.nom && l.plateforme === campagne.plateforme)) ajouter(publicite, 2);
    }
  }
  for (const ligne of lignes) ajouter(ligne, ligne.niveau === "CAMPAGNE" ? 0 : ligne.niveau === "ENSEMBLE" ? 1 : 2);
  return resultat;
}

const nombre = (valeur: number | null) => formaterValeur(valeur, "nombre");
const cout = (valeur: number | null) => (valeur === null ? <span className="text-[#6B7280]">—</span> : euros(valeur));

function colonnes(approx: boolean): Colonne<LignePublicite & { profondeur: number }>[] {
  return [
    {
      cle: "nom",
      titre: "Campagne, ensemble, publicité",
      className: "min-w-[220px] max-w-[320px]",
      rendu: (ligne) => (
        <div className="flex min-w-0 flex-col gap-0.5" style={{ paddingLeft: ligne.profondeur * 14 }}>
          <span className={cn("truncate", ligne.niveau === "CAMPAGNE" ? "font-semibold text-[#F2F3F5]" : ligne.niveau === "ENSEMBLE" ? "text-[#E5E7EB]" : "text-[#D1D5DB]")} title={ligne.nom}>
            {ligne.profondeur > 0 ? <span className="mr-1.5 text-[#6B7280]">{ligne.profondeur === 1 ? "└" : "·"}</span> : null}
            {ligne.nom}
          </span>
          {ligne.raisonVerdict ? <span className="text-[11.5px] leading-[1.35] whitespace-normal text-[#6B7280]">{ligne.raisonVerdict}</span> : null}
        </div>
      ),
    },
    {
      cle: "depense",
      titre: "Dépense",
      nombre: true,
      rendu: (l) => euros(l.depense, { approximatif: approx }),
    },
    {
      cle: "impressions",
      titre: "Impr.",
      nombre: true,
      rendu: (l) => nombre(l.impressions),
    },
    {
      cle: "clics",
      titre: "Clics",
      nombre: true,
      rendu: (l) => nombre(l.clics),
    },
    {
      cle: "ctr",
      titre: "CTR",
      nombre: true,
      rendu: (l) => formaterValeur(l.ctr, "pourcent"),
    },
    {
      cle: "leads",
      titre: "Leads CRM",
      nombre: true,
      rendu: (l) => <span title={`${l.leadsPlateforme} comptés par la plateforme`}>{nombre(l.leadsCrm)}</span>,
    },
    {
      cle: "leadsPlateforme",
      titre: "Leads Meta",
      nombre: true,
      rendu: (l) => <span className="text-[#9CA3AF]">{nombre(l.leadsPlateforme)}</span>,
    },
    {
      cle: "coutParLead",
      titre: "Par lead",
      nombre: true,
      rendu: (l) => cout(l.coutParLead),
    },
    {
      cle: "devis",
      titre: "Devis",
      nombre: true,
      rendu: (l) => nombre(l.devis),
    },
    {
      cle: "coutParDevis",
      titre: "Par devis",
      nombre: true,
      rendu: (l) => cout(l.coutParDevis),
    },
    {
      cle: "signes",
      titre: "Signés",
      nombre: true,
      rendu: (l) => nombre(l.signes),
    },
    {
      cle: "coutParSigne",
      titre: "Par signé",
      nombre: true,
      rendu: (l) => cout(l.coutParSigne),
    },
    {
      cle: "retour",
      titre: "Retour",
      nombre: true,
      rendu: (l) =>
        l.retourSurDepense === null ? (
          <span className="text-[#6B7280]">—</span>
        ) : (
          <span title={`${euros(l.encaisse)} encaissés`}>
            {formaterValeur(l.retourSurDepense, "decimal", { decimales: 1 })}
            &nbsp;×
          </span>
        ),
    },
    {
      cle: "verdict",
      className: "pl-4",
      titre: "Verdict",
      rendu: (l) => (l.verdict ? <BadgeVerdict verdict={l.verdict} titre={l.raisonVerdict} /> : null),
    },
  ];
}

export function VuePublicite({ ecran, chaineMeta }: { ecran: EcranPublicite; chaineMeta: SanteMeta | null }) {
  const { campagne } = ecran;
  const meta = ecran.lignes.filter((l) => l.plateforme === "META");
  const googleAds = ecran.lignes.filter((l) => l.plateforme === "GOOGLE_ADS");
  const etatMeta = etatDe(ecran.sources, "META");
  const etatGoogleAds = etatDe(ecran.sources, "GOOGLE_ADS");
  return (
    <>
      <Carte titre="Campagne" gap="gap-3">
        {campagne && campagne.jour !== null ? (
          <>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px] text-[#9CA3AF]">
              <span>
                Jour <span className="font-heading text-[#F2F3F5] tabular-nums">{campagne.jour}</span>
                {campagne.duree ? ` sur ${campagne.duree}` : ""}
                {campagne.debut ? ` · lancée le ${jourAxe(campagne.debut)}` : ""}
              </span>
              <span>{campagne.budget ? `Budget ${euros(campagne.budget)}` : "Budget non renseigné"}</span>
            </div>
            {campagne.duree ? <Progression ratio={campagne.jour / campagne.duree} titre={`Jour ${campagne.jour} sur ${campagne.duree}`} /> : null}
            {campagne.regleDuJour ? (
              <p className={ENCADRE}>
                <span className="text-[#5DCAA5]">Règle du jour&nbsp;:</span> {campagne.regleDuJour}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-[#9CA3AF]">
            Aucune campagne en cours
            {campagne?.debut ? ` (dernière lancée le ${jourAxe(campagne.debut)})` : ""}. Le début, le budget et la durée se règlent dans Paramètres.
          </p>
        )}
        {ecran.estimation ? (
          <p className="text-[12px] text-[#F5B454]">Dépense estimée au prorata du budget&nbsp;: Meta n&apos;est pas synchronisé, les coûts sont précédés de «&nbsp;≈&nbsp;».</p>
        ) : null}
      </Carte>

      <GrilleTuiles indicateurs={ecran.indicateurs} sources={ecran.sources} estimation={ecran.estimation} />

      <Carte titre={ecran.courbeDepense.titre} sousTitre={ecran.courbeDepense.sousTitre}>
        <div className="max-md:hidden">
          <CourbeTemps courbe={ecran.courbeDepense} separer hauteur={240} />
        </div>
        <div className="md:hidden">
          <CourbeTemps courbe={ecran.courbeDepense} separer compact />
        </div>
      </Carte>

      <Carte titre="Campagnes, ensembles et publicités" sousTitre="Meta · verdict selon le protocole de campagne (jours lus dans les consignes)">
        {meta.length === 0 ? (
          <EtatVideSource etat={etatMeta} quoi="Meta" />
        ) : (
          <Tableau colonnes={colonnes(ecran.estimation)} lignes={ordonnerLignes(meta)} cle={(l) => `${l.niveau}:${l.id}`} largeurMin={1120} />
        )}
      </Carte>

      <Carte titre="Google Ads">
        {googleAds.length === 0 ? (
          <EtatVideSource etat={etatGoogleAds} quoi="Google Ads" />
        ) : (
          <Tableau colonnes={colonnes(false)} lignes={ordonnerLignes(googleAds)} cle={(l) => `${l.niveau}:${l.id}`} largeurMin={1120} />
        )}
      </Carte>

      {chaineMeta ? <ChaineMeta initiale={chaineMeta} /> : null}
    </>
  );
}
