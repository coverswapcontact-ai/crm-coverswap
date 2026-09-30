import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { archiverRegle, poserRegle, restaurerRegle } from "@/lib/mail/boite";
import { changerStatutSimulation, modifierSimulation, restaurerSimulation } from "@/lib/simulations/dossier";
import { creerPublication, modifierPublication, schemaPublication } from "@/lib/site/publications";
import { lien } from "../definition";
import { ACTEUR_ASSISTANT } from "../execution";
import { ambiguite, datesDictees, exigerId, type DefinitionEntite, type Valeurs } from "./socle";

/**
 * Ce qui se montre (mission 17, partie C) : réalisations et avis du site, simulations de l'espace client, et les
 * règles d'expéditeur de la boîte mail. Chaque écriture passe par la fonction de service de l'écran.
 */

type Objet = z.ZodObject<z.ZodRawShape>;
const objet = (schema: unknown) => schema as Objet;

/* ── Publication du site ────────────────────────────────────────────── */

async function lirePublication(id: string): Promise<Valeurs> {
  const p = await prisma.publicationSite.findUniqueOrThrow({ where: { id } });
  return { type: p.type, titre: p.titre, texte: p.texte, ville: p.ville, typeProjet: p.typeProjet, note: p.note, auteur: p.auteur, dossierId: p.dossierId, clientId: p.clientId, photoAvant: p.photoAvant, photoApres: p.photoApres, accordClientLe: p.accordClientLe?.toISOString() ?? null, ordre: p.ordre };
}

export const PUBLICATION: DefinitionEntite = {
  code: "PUBLICATION",
  libelle: "la publication",
  designation: "id de la publication (réalisation ou avis), ou des mots de son titre",
  resoudre: async (r) => {
    const texte = exigerId(r, "la publication", "« lister » PUBLICATIONS (identifiant, ou des mots du titre)");
    const direct = await prisma.publicationSite.findUnique({ where: { id: texte } });
    const trouvees = direct ? [direct] : await prisma.publicationSite.findMany({ where: { titre: { contains: texte } }, take: 6 });
    if (trouvees.length === 0) throw new ErreurMetier(`Publication introuvable : « ${texte} ».`, 404);
    if (trouvees.length > 1) throw ambiguite(trouvees.map((p) => ({ id: p.id, nom: p.titre, detail: `${p.type.toLowerCase()}${p.publieLe && !p.retireLe ? ", publiée" : ", brouillon"}` })), "publications");
    const p = trouvees[0];
    return { id: p.id, nom: `la publication « ${p.titre} »`, archive: false, contexte: { publiee: Boolean(p.publieLe && !p.retireLe) } };
  },
  chemin: () => "/site",
  modifier: {
    schema: objet(schemaPublication.partial()),
    libelles: { type: "le type", titre: "le titre", texte: "le texte", ville: "la ville", typeProjet: "le type de projet", note: "la note", auteur: "l'auteur", dossierId: "le dossier", clientId: "le client", photoAvant: "la photo avant", photoApres: "la photo après", accordClientLe: "la date de l'accord du client", ordre: "l'ordre" },
    // Déjà en ligne : le changement se voit tout de suite sur coverswap.fr.
    sensible: (_apres, _avant, cible) => Boolean(cible.contexte.publiee),
    note: (_a, _b, cible) => (cible.contexte.publiee ? "Elle est en ligne : le changement se voit tout de suite sur coverswap.fr." : null),
    pretraiter: (e, contexte) => datesDictees(e, ["accordClientLe"], contexte.maintenant),
    lire: (cible) => lirePublication(cible.id),
    appliquer: async (cible, valeurs) => {
      // Le service réécrit la publication entière (schéma complet) : l'état relu, puis les champs donnés.
      await modifierPublication(cible.id, { ...(await lirePublication(cible.id)), ...valeurs });
    },
  },
  creer: {
    schema: schemaPublication as unknown as z.ZodType<Valeurs>,
    pretraiter: (e, contexte) => datesDictees(e, ["accordClientLe"], contexte.maintenant),
    apercu: async (e) => `Je vais créer ${e.type === "AVIS" ? "l'avis" : "la réalisation"} « ${String(e.titre)} » en brouillon (rien n'est publié).`,
    executer: async (e) => {
      const p = await creerPublication(e);
      return { texte: `${p.type === "AVIS" ? "Avis" : "Réalisation"} « ${p.titre} » créé${p.type === "AVIS" ? "" : "e"} en brouillon [publication:${p.id}]. Rien n'est en ligne : « publier » la met sur le site (accord écrit exigé). Photos : « ajouter_fichier ».`, donnees: { publication: p }, liens: [lien("Site", "/site")] };
    },
  },
};

/* ── Simulation de l'espace client ──────────────────────────────────── */

export const SIMULATION: DefinitionEntite = {
  code: "SIMULATION",
  libelle: "la simulation",
  designation: "id de la simulation (rendu par « voir_simulations »)",
  resoudre: async (r) => {
    const id = exigerId(r, "la simulation", "« voir_simulations »");
    const s = await prisma.simulationEspace.findFirst({ where: { ...AVEC_ARCHIVES, id }, select: { id: true, titre: true, dossierId: true, archiveLe: true } });
    if (!s) throw new ErreurMetier(`Simulation introuvable : ${id}.`, 404);
    const d = await prisma.dossier.findUnique({ where: { id: s.dossierId }, select: { clientNom: true } });
    return { id, nom: `la simulation${s.titre ? ` « ${s.titre} »` : ""} de ${d?.clientNom ?? "?"}`, archive: Boolean(s.archiveLe), contexte: { dossierId: s.dossierId } };
  },
  chemin: (c) => `/dossiers?dossier=${String(c.contexte.dossierId)}`,
  modifier: {
    // Le schéma de la route PATCH …/simulations/[sid] (titre, description) ; statut BROUILLON = « Repasser en brouillon ».
    schema: objet(z.object({ titre: z.string().max(80).nullable(), description: z.string().max(400).nullable(), statut: z.literal("BROUILLON") }).partial()),
    libelles: { titre: "le titre", description: "le mot au client", statut: "le statut" },
    texte: { statut: (v) => (v === "BROUILLON" ? "brouillon" : v === "PUBLIEE" ? "publiée" : v === "MASQUEE" ? "masquée" : "—") },
    lire: async (cible) => {
      const s = await prisma.simulationEspace.findFirstOrThrow({ where: { ...AVEC_ARCHIVES, id: cible.id } });
      return { titre: s.titre, description: s.description, statut: s.statut };
    },
    irreversibles: { statut: "Une simulation repassée en brouillon ne se republie pas par une annulation : « publier » (qui prévient le client) la remet." },
    appliquer: async (cible, valeurs) => {
      const dossierId = cible.contexte.dossierId as string;
      const { statut, ...texte } = valeurs;
      if (Object.keys(texte).length) await modifierSimulation(dossierId, cible.id, texte as { titre?: string | null; description?: string | null });
      if (statut === "BROUILLON") await changerStatutSimulation(dossierId, cible.id, "brouillon");
      else if (statut === "MASQUEE") await changerStatutSimulation(dossierId, cible.id, "masquer");
      else if (statut !== undefined) throw new ErreurMetier("Republier une simulation passe par « publier » (le client est prévenu).", 409);
    },
  },
  archiver: async (cible, motif) => {
    await changerStatutSimulation(cible.contexte.dossierId as string, cible.id, "retirer", motif);
  },
  restaurer: async (cible) => {
    await restaurerSimulation(cible.contexte.dossierId as string, cible.id);
  },
};

/* ── Règle d'expéditeur ─────────────────────────────────────────────── */

const ACTIONS_REGLE = ["RANGER", "NE_JAMAIS_RANGER", "ADMINISTRATIF"] as const;

export const REGLE_EXPEDITEUR: DefinitionEntite = {
  code: "REGLE_EXPEDITEUR",
  libelle: "la règle d'expéditeur",
  designation: "id de la règle, ou l'adresse / le « @domaine » qu'elle vise",
  resoudre: async (r) => {
    const texte = exigerId(r, "la règle", "« etat_crm » MAIL (règles posées)");
    const direct = await prisma.regleExpediteur.findFirst({ where: { ...AVEC_ARCHIVES, id: texte } });
    const trouvees = direct ? [direct] : await prisma.regleExpediteur.findMany({ where: { ...AVEC_ARCHIVES, cible: texte.trim().toLowerCase() }, orderBy: { createdAt: "desc" }, take: 6 });
    if (trouvees.length === 0) throw new ErreurMetier(`Règle introuvable : « ${texte} ».`, 404);
    if (trouvees.length > 1) throw ambiguite(trouvees.map((x) => ({ id: x.id, nom: `${x.action} ${x.cible}`, detail: x.archiveLe ? "retirée" : "en vigueur" })), "règles");
    const x = trouvees[0];
    return { id: x.id, nom: `la règle ${x.action} pour ${x.cible}`, archive: Boolean(x.archiveLe), contexte: {} };
  },
  chemin: () => "/parametres#mail",
  creer: {
    // Le schéma de la route PATCH /api/mail/reglages (regle), et le motif.
    schema: z.object({ cible: z.string().trim().min(3).max(160), action: z.enum(ACTIONS_REGLE), motif: z.string().trim().max(300).optional() }) as unknown as z.ZodType<Valeurs>,
    sensible: () => true,
    apercu: async (e) => `Je vais poser la règle ${String(e.action)} pour ${String(e.cible).toLowerCase()} : ${e.action === "RANGER" ? "ses mails seront rangés d'office" : e.action === "ADMINISTRATIF" ? "ses mails iront en administratif" : "ses mails ne seront jamais rangés"}. Une règle contraire est retirée.`,
    executer: async (e) => {
      const cible = String(e.cible).toLowerCase();
      if (!cible.includes("@")) throw new ErreurMetier("La cible est une adresse (« x@y.fr ») ou un domaine (« @y.fr »).", 400);
      await poserRegle(cible, e.action as (typeof ACTIONS_REGLE)[number], (e.motif as string | undefined) || "Posée par l'assistant", ACTEUR_ASSISTANT, cible.startsWith("@"));
      const regle = await prisma.regleExpediteur.findFirst({ where: { cible: cible.startsWith("@") ? cible : cible, action: e.action as string }, orderBy: { createdAt: "desc" }, select: { id: true, cible: true } });
      return { texte: `Règle posée : ${String(e.action)} pour ${regle?.cible ?? cible}${regle ? ` [regle:${regle.id}]` : ""}. « archiver » la retire.`, donnees: { regleId: regle?.id ?? null }, liens: [lien("Paramètres → Mail", "/parametres#mail")] };
    },
  },
  archiver: async (cible, motif) => archiverRegle(cible.id, motif),
  restaurer: async (cible) => restaurerRegle(cible.id),
};

export const ENTITES_SITE = [PUBLICATION, SIMULATION, REGLE_EXPEDITEUR];
