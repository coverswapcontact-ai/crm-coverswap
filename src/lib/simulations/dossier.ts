import { promises as fs } from "node:fs";
import { recalculerMain } from "@/lib/dossiers/main";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { SimulationEspace } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { alerter } from "@/lib/alertes/canaux";
import { FORMATS_PHOTO, PHOTO_OCTETS_MAX } from "@/lib/dossiers/constants";
import { changerEtape } from "@/lib/dossiers/transitions";
import { lienPourLeProjet, ouvrirEspace } from "@/lib/espace/liens";
import { resolveUploadsDir } from "@/lib/uploads";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { conversationDuNumero } from "@/lib/sms/conversations";
import { envoyerSms } from "@/lib/sms/envoi";
import { etatFournisseur } from "@/lib/sms/fournisseurs";
import { lireModele } from "@/lib/sms/modeles";
import { estMobileFrancais, remplirModele } from "@/lib/sms/texte";
import { lireZones, surfaceDepuisLibelle, typeSurface, type ZoneTeinte } from "@/lib/simulateur/types-surface";

/**
 * Les simulations d'un dossier — toutes, d'où qu'elles viennent :
 *  - SITE : faites par le client sur coverswap.fr (il les a vues : publiées d'office) ;
 *  - API : générées depuis le CRM par le moteur du site ;
 *  - CHATGPT : rendues par ChatGPT, déposées depuis le CRM ;
 *  - MANUEL : toute autre image déposée par Lucas.
 *
 * Tout ce qui vient du CRM arrive en BROUILLON : le client ne voit que les
 * simulations PUBLIEE (jamais un brouillon, jamais une simulation masquée).
 * Publier peut prévenir le client par SMS : c'est le clic de Lucas qui envoie,
 * texte sous les yeux (aucun envoi automatique).
 *
 * Elles vivent dans l'espace du client (`SimulationEspace`) : l'espace est
 * ouvert au premier brouillon — ouvert ne veut pas dire envoyé.
 */

export const SOURCES_SIMULATION = ["SITE", "API", "CHATGPT", "MANUEL"] as const;
export type SourceSimulation = (typeof SOURCES_SIMULATION)[number];
export const STATUTS_SIMULATION = ["BROUILLON", "PUBLIEE", "MASQUEE"] as const;
export type StatutSimulation = (typeof STATUTS_SIMULATION)[number];

const ACTEUR_SITE = { acteur: "SYSTEME:simulation-dossier", origine: "Simulation du site rangée dans l'espace du client" };
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");

function cheminAbsolu(relatif: string): string {
  const base = path.resolve(resolveUploadsDir());
  const complet = path.resolve(base, relatif);
  if (!complet.startsWith(base + path.sep)) throw new ErreurMetier("Chemin de fichier invalide.", 400);
  return complet;
}

function typeDe(chemin: string): string {
  const extension = path.posix.extname(chemin).slice(1).toLowerCase();
  return extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
}

export async function lireImage(relatif: string | null): Promise<{ contenu: Buffer; type: string }> {
  if (!relatif) throw new ErreurMetier("Image introuvable.", 404);
  try {
    return { contenu: await fs.readFile(cheminAbsolu(relatif)), type: typeDe(relatif) };
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) throw erreur;
    throw new ErreurMetier("Image introuvable.", 404);
  }
}

/** Écrit une image sous dossiers/<id>/simulations/ et rend son chemin relatif. */
export async function ecrireImageSimulation(dossierId: string, octets: Buffer, extension: string, suffixe = ""): Promise<string> {
  const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}${suffixe}`;
  const relatif = path.posix.join("dossiers", dossierId, "simulations", `${id}.${extension}`);
  const absolu = cheminAbsolu(relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  await fs.writeFile(absolu, octets);
  return relatif;
}

/* ── Simulations faites sur le site ───────────────────────────────── */

/** Zones et teintes d'une simulation du site, relues sur la simulation d'origine du parcours. */
async function zonesDuSite(simulationId: string, notes: string | null, referenceChoisie: string | null): Promise<ZoneTeinte[]> {
  const origine = await prisma.simulationSite.findFirst({ where: { ...AVEC_ARCHIVES, simulationId }, select: { references: true } });
  const depuisParcours = lireZones(origine?.references ?? null);
  if (depuisParcours.length > 0) return depuisParcours;
  // Ancien parcours : « Libellé : REF (Nom) | … » dans les notes.
  const lues = (notes ?? "")
    .split("|")
    .map((morceau) => /^\s*(.+?)\s*:\s*([A-Za-z0-9_-]+)\s*\((.*)\)\s*$/.exec(morceau))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ zone: surfaceDepuisLibelle(m[1]), libelle: m[1], ref: m[2], nom: m[3] }));
  if (lues.length > 0) return lues;
  return referenceChoisie ? [{ zone: "", libelle: "", ref: referenceChoisie, nom: "" }] : [];
}

/**
 * Les simulations du site rangées dans ce dossier rejoignent son espace, déjà
 * publiées (le client les a vues). Rejouable : une simulation déjà présente —
 * même retirée par Lucas — n'est jamais recréée. Rend les lignes créées.
 */
export async function synchroniserSimulationsSite(dossierId: string): Promise<SimulationEspace[]> {
  const espace = await prisma.espaceClient.findFirst({ where: { dossierId }, select: { id: true } });
  if (!espace) return [];
  const [simulations, dejaLa] = await Promise.all([
    prisma.simulation.findMany({ where: { dossierId, imageAfterPath: { not: null } }, orderBy: { createdAt: "asc" } }),
    prisma.simulationEspace.findMany({ where: { ...AVEC_ARCHIVES, espaceId: espace.id, simulationId: { not: null } }, select: { simulationId: true } }),
  ]);
  const connues = new Set(dejaLa.map((s) => s.simulationId));
  const creees: SimulationEspace[] = [];
  for (const simulation of simulations) {
    if (connues.has(simulation.id)) continue;
    const zones = await zonesDuSite(simulation.id, simulation.notes, simulation.referenceChoisie);
    const ordre = await prisma.simulationEspace.count({ where: { ...AVEC_ARCHIVES, espaceId: espace.id } });
    creees.push(
      await prisma.simulationEspace.create({
        data: {
          espaceId: espace.id,
          dossierId,
          chemin: simulation.imageAfterPath!,
          photoAvant: simulation.imageBeforePath ?? simulation.imageOriginalPath,
          titre: "Votre simulation sur coverswap.fr",
          source: "SITE",
          statut: "PUBLIEE",
          publieeLe: simulation.createdAt,
          zones: zones.length ? JSON.stringify(zones) : null,
          simulationId: simulation.id,
          ordre,
        },
      })
    );
  }
  return creees;
}

/**
 * Une simulation que le client vient de refaire sur le site, alors qu'il a déjà
 * son espace : elle y apparaît tout de suite, un événement l'écrit au dossier
 * et Lucas est prévenu — un client qui refait une simulation est en train de se décider.
 */
export async function rangerSimulationsSiteDansLEspace(dossierId: string, options: { alerter?: boolean } = {}): Promise<number> {
  const { avecActeur } = await import("@/lib/journal/contexte");
  return avecActeur(ACTEUR_SITE, async () => {
    const creees = await synchroniserSimulationsSite(dossierId);
    if (creees.length === 0) return 0;
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true, clientTelephone: true } });
    await prisma.dossierEvenement.create({
      data: {
        dossierId,
        type: "ESPACE_SIMULATION_SITE",
        direction: "ENTRANT",
        contenu: `Le client a refait ${creees.length > 1 ? `${creees.length} simulations` : "une simulation"} sur le site : ${creees.length > 1 ? "elles apparaissent" : "elle apparaît"} dans son espace`,
        metadata: JSON.stringify({ simulations: creees.map((s) => s.id) }),
      },
    });
    if (options.alerter === false) return creees.length;
    await alerter(
      {
        titre: `Nouvelle simulation sur le site — ${dossier?.clientNom ?? "client"}`,
        texte: `${dossier?.clientNom ?? "Le client"} a refait ${creees.length > 1 ? `${creees.length} simulations` : "une simulation"} sur coverswap.fr : ${creees.length > 1 ? "elles sont" : "elle est"} dans son dossier et dans son espace.\nIl est en train de se décider : c'est le moment d'appeler.`,
        lien: `${appUrl()}/dossiers?dossier=${dossierId}`,
        libelleLien: "Ouvrir le dossier",
        telephone: dossier?.clientTelephone || undefined,
        urgence: 4,
        etiquette: `espace-${dossierId}`,
      },
      { origine: "espace-client", canaux: ["telegram", "ntfy", "pushweb"] }
    ).catch((erreur) => console.error("[simulations] alerte « simulation du site » non envoyée :", erreur));
    return creees.length;
  });
}

/* ── Vue du CRM ───────────────────────────────────────────────────── */

export type SimulationVue = {
  id: string;
  source: SourceSimulation;
  statut: StatutSimulation;
  titre: string | null;
  description: string | null;
  typeSurface: string | null;
  typeLibelle: string | null;
  zones: ZoneTeinte[];
  promptVersion: number | null;
  coutDollars: number | null;
  le: string;
  publieeLe: string | null;
  vueLe: string | null;
  choisie: boolean;
  commentaire: string | null;
  image: string;
  avant: string | null;
  /** Rangée dans le dossier sans espace client : elle rejoindra l'espace à son ouverture. */
  horsEspace?: boolean;
};

function versVue(dossierId: string, s: SimulationEspace): SimulationVue {
  return {
    id: s.id,
    source: (SOURCES_SIMULATION as readonly string[]).includes(s.source) ? (s.source as SourceSimulation) : "MANUEL",
    statut: (STATUTS_SIMULATION as readonly string[]).includes(s.statut) ? (s.statut as StatutSimulation) : "PUBLIEE",
    titre: s.titre,
    description: s.description,
    typeSurface: s.typeSurface,
    typeLibelle: typeSurface(s.typeSurface)?.libelle ?? null,
    zones: lireZones(s.zones),
    promptVersion: s.promptVersion,
    coutDollars: s.coutDollars,
    le: s.createdAt.toISOString(),
    publieeLe: s.publieeLe?.toISOString() ?? null,
    vueLe: s.vueLe?.toISOString() ?? null,
    choisie: Boolean(s.choisieLe),
    commentaire: s.commentaireClient,
    image: `/api/dossiers/${dossierId}/simulations/${s.id}/image`,
    avant: s.photoAvant ? `/api/dossiers/${dossierId}/simulations/${s.id}/avant` : null,
  };
}

export async function listerSimulationsDossier(dossierId: string): Promise<{ espace: { id: string; lien: string | null } | null; simulations: SimulationVue[] }> {
  const espace = await prisma.espaceClient.findFirst({ where: { dossierId }, select: { id: true, code: true, version: true, revoqueLe: true, permanentId: true } });
  if (espace) await synchroniserSimulationsSite(dossierId).catch((erreur) => console.error("[simulations] synchronisation du site :", erreur));
  const lignes = espace ? await prisma.simulationEspace.findMany({ where: { espaceId: espace.id }, orderBy: [{ createdAt: "desc" }] }) : [];
  const vues = lignes.map((s) => versVue(dossierId, s));
  if (!espace) {
    // Pas encore d'espace : les simulations du site se montrent quand même au dossier.
    const site = await prisma.simulation.findMany({ where: { dossierId, imageAfterPath: { not: null } }, orderBy: { createdAt: "desc" } });
    for (const s of site) {
      vues.push({
        id: `site-${s.id}`,
        source: "SITE",
        statut: "PUBLIEE",
        titre: "Simulation faite sur coverswap.fr",
        description: s.notes,
        typeSurface: null,
        typeLibelle: null,
        zones: await zonesDuSite(s.id, s.notes, s.referenceChoisie),
        promptVersion: null,
        coutDollars: null,
        le: s.createdAt.toISOString(),
        publieeLe: s.createdAt.toISOString(),
        vueLe: null,
        choisie: false,
        commentaire: null,
        image: `/api/uploads/${s.imageAfterPath}`,
        avant: s.imageBeforePath ? `/api/uploads/${s.imageBeforePath}` : null,
        horsEspace: true,
      });
    }
  }
  return { espace: espace ? { id: espace.id, lien: await lienPourLeProjet(espace) } : null, simulations: vues };
}

async function simulationDuDossier(dossierId: string, simulationId: string): Promise<SimulationEspace> {
  const simulation = await prisma.simulationEspace.findFirst({ where: { id: simulationId, dossierId } });
  if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
  return simulation;
}

export async function imageSimulationDossier(dossierId: string, simulationId: string, quoi: "image" | "avant"): Promise<{ contenu: Buffer; type: string }> {
  const simulation = await prisma.simulationEspace.findFirst({ where: { ...AVEC_ARCHIVES, id: simulationId, dossierId } });
  if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
  return lireImage(quoi === "image" ? simulation.chemin : simulation.photoAvant);
}

/* ── Dépôt d'une image (ChatGPT, ou autre) ────────────────────────── */

export type DepotSimulation = {
  titre?: string | null;
  description?: string | null;
  source?: "CHATGPT" | "MANUEL";
  /** Préparation d'où vient l'image ; « auto » : la dernière préparation ChatGPT du dossier (72 h). */
  preparationId?: string | "auto" | null;
};

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function deposerSimulationDossier(dossierId: string, fichier: File, depot: DepotSimulation = {}): Promise<SimulationVue> {
  const extension = EXTENSIONS[fichier.type];
  if (!extension) throw new ErreurMetier(FORMATS_PHOTO[fichier.type] ? "Format HEIC : exportez l'image en JPEG (ChatGPT rend du PNG ou du JPEG)." : "Format d'image non pris en charge : JPEG, PNG ou WebP.", 415);
  if (fichier.size === 0 || fichier.size > PHOTO_OCTETS_MAX) throw new ErreurMetier("Image vide ou trop lourde (9 Mo au plus).", 413);
  const { espace } = await ouvrirEspace(dossierId);

  const preparation =
    depot.preparationId === "auto" || depot.preparationId === undefined
      ? await prisma.preparationSimulation.findFirst({ where: { dossierId, mode: "CHATGPT", statut: "PREPAREE", createdAt: { gte: new Date(Date.now() - 72 * 3_600_000) } }, orderBy: { createdAt: "desc" } })
      : depot.preparationId
        ? await prisma.preparationSimulation.findFirst({ where: { id: depot.preparationId, dossierId } })
        : null;
  if (depot.preparationId && depot.preparationId !== "auto" && !preparation) throw new ErreurMetier("Préparation introuvable pour ce dossier.", 404);

  const chemin = await ecrireImageSimulation(dossierId, Buffer.from(await fichier.arrayBuffer()), extension);
  const type = typeSurface(preparation?.typeSurface);
  const zones = preparation ? lireZones(preparation.zones) : [];
  const ordre = await prisma.simulationEspace.count({ where: { ...AVEC_ARCHIVES, espaceId: espace.id } });
  const creee = await prisma.$transaction(async (tx) => {
    const simulation = await tx.simulationEspace.create({
      data: {
        espaceId: espace.id,
        dossierId,
        chemin,
        titre: depot.titre?.trim().slice(0, 80) || (type ? `${type.libelle}${zones.length ? ` — ${zones.map((z) => z.nom).join(", ")}` : ""}`.slice(0, 80) : null),
        description: depot.description?.trim().slice(0, 400) || null,
        ordre,
        source: preparation ? "CHATGPT" : (depot.source ?? "MANUEL"),
        statut: "BROUILLON",
        photoAvant: preparation?.photoAvant ?? preparation?.photoSource ?? null,
        typeSurface: preparation?.typeSurface ?? null,
        zones: zones.length ? JSON.stringify(zones.map(({ zone, libelle, ref, nom }) => ({ zone, libelle, ref, nom }))) : null,
        promptId: preparation?.promptId ?? null,
        promptVersion: preparation?.promptVersion ?? null,
        promptTexte: preparation?.promptTexte ?? null,
        preparationId: preparation?.id ?? null,
      },
    });
    if (preparation) await tx.preparationSimulation.update({ where: { id: preparation.id }, data: { statut: "TERMINEE", resultatId: simulation.id } });
    await tx.dossierEvenement.create({
      data: {
        dossierId,
        type: "SIMULATION_BROUILLON",
        direction: "INTERNE",
        contenu: `Simulation ${preparation ? "ChatGPT" : "déposée"} en brouillon${simulation.titre ? ` : ${simulation.titre}` : ""}${preparation?.promptVersion ? ` (prompt v${preparation.promptVersion})` : ""}`,
        metadata: JSON.stringify({ simulationId: simulation.id, preparationId: preparation?.id ?? null }),
      },
    });
    return simulation;
  });
  await recalculerMain(dossierId);
  return versVue(dossierId, creee);
}

/* ── Publier, masquer, retirer ────────────────────────────────────── */

export type ResultatPublication = { publiees: number; sms: { envoye: boolean; raison?: string; texte?: string } };

/** Texte du SMS « simulations prêtes », tel que Lucas le verra avant de publier. */
export async function texteSmsPublication(dossierId: string): Promise<{ texte: string | null; raison?: string; dejaPrevenuLe?: string; attente?: string }> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true, clientTelephone: true, leadId: true, clientId: true, lead: { select: { prenom: true } } } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const espace = await prisma.espaceClient.findFirst({ where: { dossierId } });
  if (!espace || espace.revoqueLe) return { texte: null, raison: "Le lien de l'espace est désactivé : émettez un nouveau lien pour prévenir le client." };
  const numero = normaliserTelephone(dossier.clientTelephone);
  if (!estMobileFrancais(numero)) return { texte: null, raison: "Pas de numéro de mobile : prévenez le client autrement (lien à copier)." };
  const conversation = await prisma.conversationSms.findUnique({ where: { numero: numero! } });
  if (conversation?.stopLe) return { texte: null, raison: "Ce numéro a répondu STOP : aucun SMS ne peut plus lui être envoyé." };
  const recent = conversation ? await prisma.sms.findFirst({ where: { conversationId: conversation.id, sens: "SORTANT", modele: "SIMULATION_PRETE", statut: { not: "ECHEC" }, createdAt: { gte: new Date(Date.now() - 2 * 3_600_000) } }, orderBy: { createdAt: "desc" } }) : null;
  const modele = await lireModele("SIMULATION_PRETE");
  if (!modele?.actif) return { texte: null, raison: "Le message type « Simulation déposée » est désactivé (Paramètres → Messagerie SMS)." };
  const prenom = (dossier.lead?.prenom ?? dossier.clientNom.split(/\s+/)[0] ?? "").trim();
  const lien = await lienPourLeProjet(espace);
  if (!lien) return { texte: null, raison: "Le lien de l'espace est désactivé : émettez un nouveau lien pour prévenir le client." };
  const texte = remplirModele(modele.texte, { prenom: /^(inconnu|client)$/i.test(prenom) ? "" : prenom.split(/\s+/)[0], lien });
  // Sans fournisseur, le SMS est écrit mais reste en attente : Lucas le sait avant de cliquer.
  const fournisseur = etatFournisseur();
  return { texte, ...(recent ? { dejaPrevenuLe: recent.createdAt.toISOString() } : {}), ...(fournisseur.nom ? {} : { attente: fournisseur.remarque ?? "Aucun fournisseur de SMS configuré." }) };
}

export async function publierSimulations(dossierId: string, ids: string[], options: { prevenir: boolean; texte?: string | null }): Promise<ResultatPublication> {
  const lignes = await prisma.simulationEspace.findMany({ where: { dossierId, id: { in: [...new Set(ids)] } } });
  if (lignes.length === 0) throw new ErreurMetier("Aucune simulation à publier.", 404);
  const maintenant = new Date();
  const aPublier = lignes.filter((s) => s.statut !== "PUBLIEE");
  if (aPublier.length > 0) {
    await prisma.$transaction([
      ...aPublier.map((s) => prisma.simulationEspace.update({ where: { id: s.id }, data: { statut: "PUBLIEE", publieeLe: s.publieeLe ?? maintenant, masqueeLe: null } })),
      prisma.dossierEvenement.create({
        data: {
          dossierId,
          type: "ESPACE_SIMULATION_DEPOSEE",
          direction: "SORTANT",
          contenu: `${aPublier.length > 1 ? `${aPublier.length} simulations publiées` : "Simulation publiée"} dans l'espace du client${aPublier.length === 1 && aPublier[0].titre ? ` : ${aPublier[0].titre}` : ""}`,
          metadata: JSON.stringify({ simulations: aPublier.map((s) => s.id) }),
        },
      }),
      prisma.dossier.update({ where: { id: dossierId }, data: { prochaineAction: "Attendre le retour du client sur la simulation", prochaineActionDate: null } }),
    ]);
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
    if (dossier?.etape === "QUALIFICATION") await changerEtape(dossierId, { vers: "SIMULATION" }).catch((erreur) => console.error("[simulations] passage en Simulation (non bloquant) :", erreur));
    // Publiée : la main passe au client, partout (dossiers/main.ts).
    await recalculerMain(dossierId);
  }

  if (!options.prevenir) return { publiees: aPublier.length, sms: { envoye: false, raison: "Client non prévenu (case décochée)." } };
  const propose = await texteSmsPublication(dossierId);
  if (!propose.texte) return { publiees: aPublier.length, sms: { envoye: false, raison: propose.raison } };
  const texte = options.texte?.trim() || propose.texte;
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientTelephone: true, leadId: true, clientId: true } });
  try {
    const conversation = await conversationDuNumero(normaliserTelephone(dossier!.clientTelephone)!, { leadId: dossier!.leadId, clientId: dossier!.clientId });
    const sms = await envoyerSms({ conversationId: conversation.id, texte, origine: "MODELE", modele: "SIMULATION_PRETE", textePropose: propose.texte, cleEnvoi: `publication:${dossierId}:${aPublier.map((s) => s.id).sort().join(",") || maintenant.getTime()}` });
    return { publiees: aPublier.length, sms: { envoye: sms.statut !== "ECHEC", texte, ...(sms.statut === "ECHEC" ? { raison: sms.erreur ?? "Échec de l'envoi." } : {}) } };
  } catch (erreur) {
    return { publiees: aPublier.length, sms: { envoye: false, raison: erreur instanceof Error ? erreur.message : "SMS non envoyé." } };
  }
}

export async function changerStatutSimulation(dossierId: string, simulationId: string, action: "masquer" | "afficher" | "brouillon" | "retirer", motif?: string | null): Promise<SimulationVue | null> {
  const simulation = await simulationDuDossier(dossierId, simulationId);
  const maintenant = new Date();
  // La simulation que le client a validée ne peut pas disparaître de sa galerie en restant « validée » :
  // la masquer, la retirer ou la repasser en brouillon dévalide son choix (tracé, et le dossier le sait).
  if (action !== "afficher" && simulation.choisieLe) {
    const espace = await prisma.espaceClient.findUnique({ where: { id: simulation.espaceId } });
    if (espace?.choixLe) {
      const { devaliderChoix } = await import("@/lib/espace/validations");
      await devaliderChoix(espace, "LUCAS");
    }
  }
  if (action === "retirer") {
    await prisma.simulationEspace.update({ where: { id: simulation.id }, data: { archiveLe: maintenant, archiveMotif: motif?.trim().slice(0, 200) || "Retirée du dossier" } });
    return null;
  }
  const data =
    action === "masquer"
      ? { statut: "MASQUEE", masqueeLe: maintenant }
      : action === "afficher"
        ? { statut: "PUBLIEE", masqueeLe: null, publieeLe: simulation.publieeLe ?? maintenant }
        : { statut: "BROUILLON", masqueeLe: null };
  const modifiee = await prisma.simulationEspace.update({ where: { id: simulation.id }, data });
  if (action === "masquer" && simulation.statut === "PUBLIEE") {
    await prisma.dossierEvenement.create({ data: { dossierId, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: `Simulation masquée au client${simulation.titre ? ` : ${simulation.titre}` : ""}`, metadata: JSON.stringify({ simulationId }) } });
  }
  return versVue(dossierId, modifiee);
}

export async function modifierSimulation(dossierId: string, simulationId: string, entree: { titre?: string | null; description?: string | null }): Promise<SimulationVue> {
  await simulationDuDossier(dossierId, simulationId);
  const modifiee = await prisma.simulationEspace.update({
    where: { id: simulationId },
    data: {
      ...(entree.titre !== undefined ? { titre: entree.titre?.trim().slice(0, 80) || null } : {}),
      ...(entree.description !== undefined ? { description: entree.description?.trim().slice(0, 400) || null } : {}),
    },
  });
  return versVue(dossierId, modifiee);
}
