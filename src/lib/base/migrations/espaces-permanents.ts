import { rattacherDossier } from "@/lib/clients/identification";
import { lireLignes } from "@/lib/dossiers/stockage";
import { deduireSelection } from "@/lib/prestations/deduction";
import { famillesDe, lireSelection, normaliserSelection, resumerSelection, selectionDepuisZones, type SelectionPrestations } from "@/lib/prestations/prestations";
import type { MigrationDonnees } from "./index";

/**
 * Mission 5 (22/09/2026) : l'espace client devient PERMANENT.
 *
 * 1. Chaque espace existant devient un projet de l'espace permanent de son
 *    client (créé au passage) ; le permanent reprend le code et la version de
 *    l'espace : le lien déjà envoyé par SMS EST le lien permanent, il continue
 *    de fonctionner. Visites et favoris sont repris ; un lien désactivé le reste.
 * 2. Les dossiers en cours reçoivent leurs familles et sous-parties : d'après
 *    les lignes de leur devis quand il en a (ou son objet, pour un devis repris
 *    sans lignes), sinon d'après ce que le client a coché dans son espace ;
 *    sinon rien (Lucas complète). Un mot douteux ne coche rien.
 *
 * Rejouable : un espace déjà rattaché, un dossier qui a déjà ses familles, ne
 * bougent plus.
 */

/**
 * Ce que Lucas a dit lui-même d'un dossier en cours (énoncé de la mission du
 * 22/09/2026) : le dossier J. R. (devis repris 2026-037, « Cuisine + Dressing +
 * Plan ») porte sur la cuisine — façades hautes, plan de travail, crédence —,
 * les portes de dressing et le plan vasque avec la crédence de la salle de bain.
 * Son objet seul ne le dit pas (« Plan » : de travail ou vasque ?).
 */
const DITS_PAR_LUCAS: Record<string, SelectionPrestations> = {
  cmu54m7ia000f11ppka56hwq7: { CUISINE: ["facades-hautes", "plan-de-travail", "credence"], SDB: ["plan-vasque", "credence"], MEUBLES: ["portes-dressing"] },
};

const JAMAIS = new Date("2100-01-01T00:00:00.000Z");
const ETAPES_CLOSES = ["ENCAISSE", "PERDU"];

export const migrationEspacesPermanents: MigrationDonnees = {
  nom: "espaces-permanents-22-09",
  description: "Chaque espace client devient l'espace permanent de son client (même lien) ; familles et sous-parties reprises sur les dossiers en cours",
  executer: async (client) => {
    const compteurs = { permanents: 0, projets: 0, fusionnes: 0, clientsRattaches: 0, famillesDitesParLucas: 0, famillesDuDevis: 0, famillesDeLEspace: 0, famillesLaisseesVides: 0 };

    // 1. Les espaces deviennent des projets de l'espace permanent de leur client.
    const espaces = await client.espaceClient.findMany({ where: { permanentId: null }, orderBy: { createdAt: "asc" }, include: { dossier: true } });
    for (const espace of espaces) {
      let clientId = espace.dossier.clientId;
      if (!clientId) {
        clientId = await rattacherDossier(client, espace.dossier);
        compteurs.clientsRattaches++;
      }
      const existant = await client.espacePermanent.findUnique({ where: { clientId } });
      if (existant) {
        // Un deuxième espace du même client : ses visites et favoris rejoignent l'espace permanent ; son code reste un lien valable.
        const favoris = [...new Set([...lireListe(existant.favoris), ...lireListe(espace.favoris)])];
        await client.espacePermanent.update({
          where: { id: existant.id },
          data: {
            nbAcces: existant.nbAcces + espace.nbAcces,
            premierAccesLe: plusTot(existant.premierAccesLe, espace.premierAccesLe),
            dernierAccesLe: plusTard(existant.dernierAccesLe, espace.dernierAccesLe),
            favoris: favoris.length ? JSON.stringify(favoris) : existant.favoris,
          },
        });
        await client.espaceClient.update({ where: { id: espace.id }, data: { permanentId: existant.id, expireLe: JAMAIS } });
        compteurs.fusionnes++;
      } else {
        const libre = !(await client.espacePermanent.findUnique({ where: { code: espace.code }, select: { id: true } }));
        const permanent = await client.espacePermanent.create({
          data: {
            code: libre ? espace.code : `${espace.code.slice(0, 7)}${Math.floor(Math.random() * 8) + 2}`,
            version: espace.version,
            clientId,
            lienEmisLe: espace.createdAt,
            revoqueLe: espace.revoqueLe,
            premierAccesLe: espace.premierAccesLe,
            dernierAccesLe: espace.dernierAccesLe,
            nbAcces: espace.nbAcces,
            favoris: espace.favoris,
          },
        });
        await client.espaceClient.update({ where: { id: espace.id }, data: { permanentId: permanent.id, expireLe: JAMAIS } });
        await client.dossierEvenement.create({
          data: { dossierId: espace.dossierId, type: "ESPACE_PERMANENT", direction: "INTERNE", contenu: "L'espace client devient permanent : ce dossier est le premier projet du client, son lien reste le même et n'expire plus.", metadata: JSON.stringify({ permanentId: permanent.id, espaceId: espace.id }) },
        });
        compteurs.permanents++;
      }
      compteurs.projets++;
    }

    // 2. Les familles des dossiers en cours.
    const dossiers = await client.dossier.findMany({
      where: { archiveLe: null, prestations: null, etape: { notIn: ETAPES_CLOSES } },
      select: {
        id: true,
        lead: { select: { typeProjet: true } },
        espaces: { select: { souhaits: true } },
        documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { notIn: ["BROUILLON", "ANNULEE"] } }, orderBy: { createdAt: "desc" }, select: { numero: true, objet: true, lignes: true } },
      },
    });
    for (const d of dossiers) {
      let selection: SelectionPrestations = {};
      let source = "";
      if (DITS_PAR_LUCAS[d.id]) {
        selection = normaliserSelection(DITS_PAR_LUCAS[d.id]);
        source = "d'après Lucas (mission du 22/09)";
        compteurs.famillesDitesParLucas++;
      } else if (d.documents.length > 0) {
        const devis = d.documents[0];
        const lignes = lireLignes(devis.lignes);
        const textes = lignes.length ? lignes.flatMap((l) => (l.type === "SECTION" ? [l.libelle] : [l.designation, l.sousDesignation ?? ""])) : [devis.objet];
        selection = deduireSelection(textes);
        source = `d'après le devis ${devis.numero}`;
        if (famillesDe(selection).length) compteurs.famillesDuDevis++;
      }
      if (!famillesDe(selection).length) {
        // Ce que le client a coché dans son espace (zones de l'onglet Projet, v3).
        const zones = (() => {
          try {
            const brut = JSON.parse(d.espaces[0]?.souhaits ?? "{}") as { zones?: unknown };
            return Array.isArray(brut.zones) ? brut.zones.filter((z): z is string => typeof z === "string") : [];
          } catch {
            return [];
          }
        })();
        selection = selectionDepuisZones(zones, d.lead?.typeProjet);
        source = "d'après ce que le client a coché dans son espace";
        if (famillesDe(selection).length) compteurs.famillesDeLEspace++;
      }
      if (!famillesDe(selection).length) {
        compteurs.famillesLaisseesVides++;
        continue;
      }
      await client.dossier.update({ where: { id: d.id }, data: { prestations: JSON.stringify(selection), prestationsLe: new Date(), prestationsPar: "REPRISE" } });
      await client.dossierEvenement.create({
        data: { dossierId: d.id, type: "PRESTATIONS", direction: "INTERNE", contenu: `Familles du projet reprises ${source} : ${resumerSelection(selection)}`, metadata: JSON.stringify({ auteur: "REPRISE", avant: lireSelection(null), apres: selection }) },
      });
    }
    return compteurs;
  },
};

function lireListe(json: string | null | undefined): string[] {
  try {
    const valeur: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const plusTot = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));
const plusTard = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));
