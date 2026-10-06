/**
 * Mission 17 (partie B) — onglet Site (mesure maison sans cookie) : visites, pages vues, taux de simulation et
 * simulation → lead, visites par jour et par source, pages d'entrée, pages vues, sources (les assistants IA à part),
 * appareils, pays (déduit du fuseau, approximation volontaire), le chemin de la visite au lead, et l'entonnoir du
 * simulateur en sept étapes avec les abandons et le choix de la source (repris de l'ancien bloc de Leads).
 */
import { COULEURS_FAMILLE, LIBELLES_FAMILLE, type EcranSite } from "@/lib/analytique/types";
import { BarresHorizontales, Carte, EtatVideSource, GrilleTuiles, Pastille, Tableau, TunnelBarres, etatDe } from "./base";
import { formaterValeur } from "./format";
import { EntonnoirSimulateur } from "./EntonnoirSimulateur";
import { CourbeTemps, LegendeCourbe } from "./Graphiques";

const nombre = (valeur: number) => formaterValeur(valeur, "nombre");

export function VueSite({ ecran }: { ecran: EcranSite }) {
  const etatSite = etatDe(ecran.sources, "SITE");
  const provenances = ecran.provenances;
  const sourcesIa = provenances.filter((s) => s.famille === "ia");
  const autresSources = provenances.filter((s) => s.famille !== "ia");
  const sansVisite = ecran.courbe.points.every((point) => Object.values(point.valeurs).every((v) => !v));
  return (
    <>
      <GrilleTuiles indicateurs={ecran.indicateurs} sources={ecran.sources} />

      <Carte
        titre={ecran.courbe.titre}
        sousTitre={ecran.courbe.sousTitre}
        action={
          <span className="hidden md:block">
            <LegendeCourbe courbe={ecran.courbe} />
          </span>
        }
      >
        {sansVisite && etatSite && etatSite.etat !== "A_JOUR" ? (
          <EtatVideSource etat={etatSite} quoi="Mesure du site" />
        ) : (
          <>
            <div className="max-md:hidden">
              <CourbeTemps courbe={ecran.courbe} hauteur={260} />
            </div>
            <div className="md:hidden">
              <CourbeTemps courbe={ecran.courbe} hauteur={170} compact />
            </div>
          </>
        )}
      </Carte>

      <div className="grid gap-3 md:gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Carte titre="Pages d'entrée" sousTitre="La première page de chaque visite">
          <Tableau
            largeurMin={420}
            lignes={ecran.pagesEntree}
            cle={(l) => l.page}
            vide="Aucune visite sur la période."
            colonnes={[
              {
                cle: "page",
                titre: "Page",
                rendu: (l) => (
                  <span className="block max-w-[260px] truncate text-texte" title={l.page}>
                    {l.page}
                  </span>
                ),
              },
              {
                cle: "visites",
                titre: "Visites",
                nombre: true,
                rendu: (l) => nombre(l.visites),
              },
              {
                cle: "simulations",
                titre: "Simulations",
                nombre: true,
                rendu: (l) => nombre(l.simulations),
              },
              {
                cle: "leads",
                titre: "Leads",
                nombre: true,
                rendu: (l) => nombre(l.leads),
              },
            ]}
          />
        </Carte>
        <Carte titre="Pages vues">
          <BarresHorizontales
            couleur="var(--color-info-texte)"
            lignes={ecran.pagesVues.map((p) => ({
              cle: p.page,
              libelle: p.page,
              valeur: p.vues,
            }))}
            vide="Aucune page vue sur la période."
          />
        </Carte>
      </div>

      <div className="grid gap-3 md:gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Carte titre="D'où viennent les visites">
          <Tableau
            largeurMin={420}
            lignes={autresSources}
            cle={(l) => `${l.famille}:${l.nom}`}
            vide="Aucune visite sur la période."
            colonnes={[
              {
                cle: "nom",
                titre: "Source",
                rendu: (l) => (
                  <span className="flex min-w-0 items-center gap-2 text-texte" title={LIBELLES_FAMILLE[l.famille]}>
                    <Pastille couleur={COULEURS_FAMILLE[l.famille]} />
                    <span className="truncate">{l.nom}</span>
                  </span>
                ),
              },
              {
                cle: "visites",
                titre: "Visites",
                nombre: true,
                rendu: (l) => nombre(l.visites),
              },
              {
                cle: "simulations",
                titre: "Simulations",
                nombre: true,
                rendu: (l) => nombre(l.simulations),
              },
              {
                cle: "leads",
                titre: "Leads",
                nombre: true,
                rendu: (l) => nombre(l.leads),
              },
            ]}
          />
        </Carte>
        <Carte titre="ChatGPT et IA" sousTitre="Visites venues d'un assistant IA, à part">
          <BarresHorizontales
            couleur={COULEURS_FAMILLE.ia}
            lignes={sourcesIa.map((s) => ({
              cle: s.nom,
              libelle: s.nom,
              valeur: s.visites,
              detail: s.simulations || s.leads ? `${s.simulations} sim. · ${s.leads} lead${s.leads > 1 ? "s" : ""}` : undefined,
            }))}
            vide="Aucune visite venue d'un assistant IA."
          />
        </Carte>
        <div className="grid gap-3 md:gap-4 lg:col-span-2 lg:grid-cols-2 2xl:col-span-1 2xl:grid-cols-1">
          <Carte titre="Appareils" gap="gap-3">
            <BarresHorizontales
              lignes={ecran.appareils.map((a) => ({
                cle: a.appareil,
                libelle: a.appareil,
                valeur: a.visites,
              }))}
              vide="Aucune visite."
            />
          </Carte>
          <Carte titre="Pays" sousTitre="Déduit du fuseau horaire" gap="gap-3">
            <BarresHorizontales
              couleur="var(--color-info-texte)"
              lignes={ecran.pays.map((p) => ({
                cle: p.pays,
                libelle: p.pays,
                valeur: p.visites,
              }))}
              vide="Aucune visite."
            />
          </Carte>
        </div>
      </div>

      <div className="grid gap-3 md:gap-4 xl:grid-cols-2 xl:items-start">
        <Carte titre="De la visite au lead" sousTitre="Visite → simulation lancée → terminée → coordonnées laissées">
          <TunnelBarres tunnel={ecran.entonnoir} />
        </Carte>
        <Carte id="entonnoir-simulateur" titre="Entonnoir du simulateur" sousTitre="Les sept étapes du parcours, avec les abandons, par source de la visite">
          <EntonnoirSimulateur simulateur={ecran.simulateur ?? []} />
        </Carte>
      </div>
    </>
  );
}
