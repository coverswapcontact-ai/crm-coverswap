/**
 * Mission 17 (partie B) — onglet SEO et Google : clics, affichages, taux de clic et position (Search Console, 2 à 3
 * jours de retard), courbes par jour (une par grandeur), requêtes et pages, opportunités (vues jamais cliquées,
 * presque en première page, en hausse), alerte www / sans www, et la fiche Google (« en attente d'accès » tant que
 * Google n'a pas ouvert l'API).
 */
import type { EcranSeo, LigneSeo } from "@/lib/analytique/types";
import { BarresHorizontales, Carte, ENCADRE, EtatVideSource, GrilleMini, GrilleTuiles, LBL, MiniIndicateur, Tableau, etatDe, libelleEtat, type Colonne } from "./base";
import { COULEURS_TON, formaterValeur, evolutionAffichee } from "./format";
import { CourbeTemps } from "./Graphiques";

function colonnesSeo(titre: string): Colonne<LigneSeo>[] {
  return [
    {
      cle: "cle",
      titre,
      className: "max-w-[260px]",
      rendu: (l) => (
        <span className="block truncate text-texte" title={l.cle}>
          {l.cle}
        </span>
      ),
    },
    {
      cle: "clics",
      titre: "Clics",
      nombre: true,
      rendu: (l) => formaterValeur(l.clics, "nombre"),
    },
    {
      cle: "impressions",
      titre: "Affichages",
      nombre: true,
      rendu: (l) => formaterValeur(l.impressions, "nombre"),
    },
    {
      cle: "ctr",
      titre: "CTR",
      nombre: true,
      rendu: (l) => <span className="text-texte-3">{formaterValeur(l.ctr, "pourcent")}</span>,
    },
    {
      cle: "position",
      titre: "Position",
      nombre: true,
      rendu: (l) => formaterValeur(l.position, "position"),
    },
    {
      cle: "evolution",
      titre: "Clics vs avant",
      nombre: true,
      rendu: (l) => {
        if (l.evolutionClics === null) return <span className="text-texte-3">—</span>;
        const sens = Math.abs(l.evolutionClics) < 0.05 ? "stable" : l.evolutionClics > 0 ? "hausse" : "baisse";
        const affichee = evolutionAffichee({
          precedente: null,
          variation: l.evolutionClics,
          sens,
          ton: sens === "hausse" ? "favorable" : sens === "baisse" ? "defavorable" : "neutre",
        });
        return <span style={{ color: affichee.couleur }}>{affichee.texte}</span>;
      },
    },
  ];
}

function ListeOpportunites({ titre, aide, lignes, rendu }: { titre: string; aide: string; lignes: LigneSeo[]; rendu: "affichages" | "position" | "hausse" }) {
  return (
    <Carte titre={titre} sousTitre={aide} gap="gap-3">
      {rendu === "affichages" ? (
        <BarresHorizontales
          couleur="var(--color-attention-texte)"
          lignes={lignes.map((l) => ({
            cle: l.cle,
            libelle: l.cle,
            valeur: l.impressions,
            detail: `${l.clics} clic${l.clics > 1 ? "s" : ""}`,
          }))}
          vide="Aucune requête dans ce cas."
        />
      ) : rendu === "position" ? (
        <BarresHorizontales
          couleur="var(--color-info-texte)"
          lignes={lignes.map((l) => ({
            cle: l.cle,
            libelle: l.cle,
            valeur: l.impressions,
            texte: `position ${formaterValeur(l.position, "position")}`,
            detail: `${formaterValeur(l.impressions, "nombre")} aff.`,
          }))}
          vide="Aucune requête dans ce cas."
        />
      ) : (
        <BarresHorizontales
          couleur={COULEURS_TON.favorable}
          lignes={lignes.map((l) => ({
            cle: l.cle,
            libelle: l.cle,
            valeur: l.clics,
            texte:
              evolutionAffichee({
                precedente: null,
                variation: l.evolutionClics,
                sens: "hausse",
                ton: "favorable",
              }).texte || formaterValeur(l.clics, "nombre"),
            detail: `${formaterValeur(l.clics, "nombre")} clics`,
          }))}
          vide="Aucune requête en hausse."
        />
      )}
    </Carte>
  );
}

export function VueSeo({ ecran }: { ecran: EcranSeo }) {
  const etatSc = etatDe(ecran.sources, "SEARCH_CONSOLE");
  const etatFiche = etatDe(ecran.sources, "FICHE_GOOGLE");
  const sansDonnees = ecran.courbe.points.length === 0 && ecran.requetes.length === 0;
  return (
    <>
      {ecran.doublonWww?.detecte ? (
        <p className={ENCADRE}>
          <span className="text-attention-texte">www et sans www indexés tous les deux.</span> Google voit deux adresses pour les mêmes pages : une redirection unique (sans www vers www, ou l&apos;inverse)
          regroupe leurs clics.
          {ecran.doublonWww.exemples.length > 0 ? <span className="mt-1 block text-[12px] text-texte-3">Exemples : {ecran.doublonWww.exemples.join(" · ")}</span> : null}
        </p>
      ) : null}

      <GrilleTuiles indicateurs={ecran.indicateurs} sources={ecran.sources} />

      <Carte titre={ecran.courbe.titre} sousTitre={ecran.courbe.sousTitre}>
        {sansDonnees && etatSc && etatSc.etat !== "A_JOUR" ? (
          <EtatVideSource etat={etatSc} quoi="Search Console" />
        ) : (
          <>
            <div className="max-md:hidden">
              <CourbeTemps courbe={ecran.courbe} separer hauteur={220} />
            </div>
            <div className="md:hidden">
              <CourbeTemps courbe={ecran.courbe} separer compact />
            </div>
          </>
        )}
      </Carte>

      <div className="grid gap-3 md:gap-4 xl:grid-cols-2">
        <Carte titre="Requêtes" sousTitre="Ce que les gens ont tapé dans Google">
          <Tableau colonnes={colonnesSeo("Requête")} lignes={ecran.requetes} cle={(l) => l.cle} largeurMin={560} vide="Aucune requête sur la période." />
        </Carte>
        <Carte titre="Pages" sousTitre="Les pages du site montrées par Google">
          <Tableau colonnes={colonnesSeo("Page")} lignes={ecran.pages} cle={(l) => l.cle} largeurMin={560} vide="Aucune page sur la période." />
        </Carte>
      </div>

      <div className="grid gap-3 md:gap-4 lg:grid-cols-3">
        <ListeOpportunites titre="Vues, jamais cliquées" aide="Affichées sans clic : titre et description à revoir" lignes={ecran.opportunites.sansClic} rendu="affichages" />
        <ListeOpportunites titre="Presque en première page" aide="Positions 11 à 20 : un peu de contenu les fait monter" lignes={ecran.opportunites.presquePremierePage} rendu="position" />
        <ListeOpportunites titre="En hausse" aide="Les clics montent par rapport à la période précédente" lignes={ecran.opportunites.enHausse} rendu="hausse" />
      </div>

      <Carte titre="Fiche Google" action={etatFiche && etatFiche.etat !== "A_JOUR" ? <span className="text-[12px] text-attention-texte">{libelleEtat(etatFiche)}</span> : undefined}>
        {!ecran.fiche ? (
          <EtatVideSource etat={etatFiche} quoi="Fiche Google" />
        ) : (
          <>
            <GrilleTuiles indicateurs={ecran.fiche.indicateurs} sources={ecran.sources} />
            <div className="flex flex-col gap-2">
              <p className={LBL}>{ecran.fiche.courbe.titre}</p>
              <div className="max-md:hidden">
                <CourbeTemps courbe={ecran.fiche.courbe} hauteur={200} />
              </div>
              <div className="md:hidden">
                <CourbeTemps courbe={ecran.fiche.courbe} hauteur={150} compact />
              </div>
            </div>
            <GrilleMini>
              <MiniIndicateur libelle="Avis" valeur={formaterValeur(ecran.fiche.avis.nombre, "nombre")} />
              <MiniIndicateur libelle="Note" valeur={formaterValeur(ecran.fiche.avis.note, "position")} />
              <span />
            </GrilleMini>
          </>
        )}
      </Carte>
    </>
  );
}
