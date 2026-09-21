import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { EspaceClient } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { alerter } from "@/lib/alertes/canaux";
import { mettreEnFile } from "@/lib/taches/file";
import { EMETTEUR, FORMATS_PHOTO, PHOTO_OCTETS_MAX, type EtapeDossier } from "@/lib/dossiers/constants";
import { ajouterPhoto } from "@/lib/dossiers/dossiers";
import { calculerMontants } from "@/lib/dossiers/montants";
import { idPhoto, lireLignes, lirePhotos, estPhotoApres } from "@/lib/dossiers/stockage";
import { changerEtape } from "@/lib/dossiers/transitions";
import { normaliserEmail } from "@/lib/clients/normalisation";
import { resolveUploadsDir } from "@/lib/uploads";
import { ouvrirEspace } from "./liens";

/**
 * L'espace client : ce que le client voit de SON projet, et ce qu'il peut y faire.
 *
 * Tout ce qui sort d'ici est filtré pour lui : jamais une note interne, jamais
 * un autre dossier, jamais une photo qui ne soit pas la sienne. Chaque geste
 * écrit un événement dans son dossier (acteur « EXTERNE:espace-client » au journal) et
 * prévient Lucas quand il compte : photos déposées, simulation choisie, devis
 * accepté.
 */
// Le client n'a pas de session : ses écritures sont celles d'un appel externe, nommé (le journal sait que c'est lui).
const ACTEUR = { acteur: "EXTERNE:espace-client", origine: "espace-client" } as const;
const PHOTOS_MAX_PAR_DOSSIER = 40;
export const TACHE_ALERTE_PHOTOS = "ESPACE_PHOTOS_ALERTE";

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");

/* ── Ce que voit le client ─────────────────────────────────────────── */

export const TEINTES = ["Bois clair", "Bois foncé", "Blanc", "Noir", "Gris", "Beige", "Effet marbre", "Effet béton", "Une couleur"] as const;
export const STYLES = ["Moderne", "Chaleureux", "Épuré", "Classique", "Industriel"] as const;

export const schemaSouhaits = z.object({
  teintes: z.array(z.string().max(40)).max(9).default([]),
  style: z.string().max(40).nullable().default(null),
  /** « Je préfère que vous me proposiez. » */
  propositions: z.boolean().default(false),
  precisions: z.string().trim().max(1000, "Précisions trop longues (1 000 caractères au plus).").default(""),
});
export type Souhaits = z.output<typeof schemaSouhaits>;

export type EtatEspace = {
  prenom: string;
  projet: string;
  /** Où en est le projet, en mots du client. */
  avancement: "PHOTOS" | "SIMULATION" | "DEVIS" | "ACCORD" | "CHANTIER";
  photos: { id: string; le: string | null }[];
  souhaits: Souhaits | null;
  simulations: { id: string; titre: string | null; description: string | null; choisie: boolean; commentaire: string | null; le: string }[];
  coordonnees: { nom: string; adresse: string; codePostal: string; ville: string; email: string | null; completes: boolean };
  devis: { id: string; numero: string; objet: string; total: number; acompte: number; acomptePct: number | null; emisLe: string; accepte: { le: string; nom: string } | null } | null;
  virement: { titulaire: string; iban: string; bic: string; reference: string } | null;
  /** Paiement de l'acompte par carte : proposé seulement quand il est activé côté CRM. */
  paiementCarte: boolean;
  contact: { nom: string; telephone: string; telephoneLien: string };
  expireLe: string;
};

function lireSouhaits(json: string | null): Souhaits | null {
  if (!json) return null;
  const lu = schemaSouhaits.safeParse(JSON.parse(json));
  return lu.success ? lu.data : null;
}

function avancementDe(etape: string, aDevis: boolean, aSimulations: boolean, accepte: boolean): EtatEspace["avancement"] {
  if (accepte || ["SIGNE"].includes(etape)) return "ACCORD";
  if (["PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"].includes(etape)) return "CHANTIER";
  if (aDevis) return "DEVIS";
  if (aSimulations) return "SIMULATION";
  return "PHOTOS";
}

export async function etatEspace(espace: EspaceClient): Promise<EtatEspace> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: espace.dossierId },
    select: {
      id: true,
      clientNom: true,
      clientAdresse: true,
      clientCp: true,
      clientVille: true,
      clientEmail: true,
      objet: true,
      etape: true,
      photos: true,
      lead: { select: { prenom: true } },
      documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      accords: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const simulations = await prisma.simulationEspace.findMany({ where: { espaceId: espace.id }, orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] });
  const devis = dossier.documents[0] ?? null;
  const accord = devis ? (dossier.accords.find((a) => a.documentId === devis.id) ?? null) : null;
  const montants = devis ? calculerMontants(lireLignes(devis.lignes), devis.acomptePct) : null;
  const prenom = (dossier.lead?.prenom ?? dossier.clientNom.split(/\s+/)[0] ?? "").trim();
  const ribLu = /RIB : ([A-Z0-9 ]+?) –.*?: ([A-Z0-9]+)$/.exec(EMETTEUR.ligneRib);

  return {
    prenom: /^(inconnu|client)$/i.test(prenom) ? "" : prenom,
    projet: dossier.objet || "Votre projet de rénovation",
    avancement: avancementDe(dossier.etape, Boolean(devis), simulations.length > 0, Boolean(accord)),
    photos: lirePhotos(dossier.photos)
      .filter((chemin) => !estPhotoApres(chemin))
      .map((chemin) => ({ id: idPhoto(chemin), le: null })),
    souhaits: lireSouhaits(espace.souhaits),
    simulations: simulations.map((s) => ({ id: s.id, titre: s.titre, description: s.description, choisie: Boolean(s.choisieLe), commentaire: s.commentaireClient, le: s.createdAt.toISOString() })),
    coordonnees: {
      nom: dossier.clientNom,
      adresse: dossier.clientAdresse,
      codePostal: dossier.clientCp,
      ville: dossier.clientVille,
      email: dossier.clientEmail,
      completes: Boolean(dossier.clientAdresse.trim() && dossier.clientCp.trim() && dossier.clientVille.trim()),
    },
    devis:
      devis && montants
        ? {
            id: devis.id,
            numero: devis.numero!,
            objet: devis.objet,
            total: montants.totalTtcCentimes / 100,
            acompte: montants.acompteCentimes / 100,
            acomptePct: devis.acomptePct,
            emisLe: (devis.dateEmission ?? devis.createdAt).toISOString(),
            accepte: accord ? { le: accord.createdAt.toISOString(), nom: accord.nomSignataire } : null,
          }
        : null,
    virement: ribLu && devis ? { titulaire: EMETTEUR.raisonSociale, iban: ribLu[1].trim(), bic: ribLu[2], reference: `Devis ${devis.numero}` } : null,
    paiementCarte: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    contact: { nom: "Lucas, CoverSwap", telephone: EMETTEUR.telephone, telephoneLien: `+33${EMETTEUR.telephone.replace(/\D/g, "").slice(1)}` },
    expireLe: espace.expireLe.toISOString(),
  };
}

/** Une visite : comptée, datée ; la première est notée dans le dossier (Lucas sait que le lien a été ouvert). */
export async function noterVisite(espace: EspaceClient): Promise<void> {
  const maintenant = new Date();
  // Une rafale de requêtes de la même page ne compte que pour une visite.
  if (espace.dernierAccesLe && maintenant.getTime() - espace.dernierAccesLe.getTime() < 10 * 60_000) return;
  await avecActeur(ACTEUR, async () => {
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { dernierAccesLe: maintenant, nbAcces: { increment: 1 }, ...(espace.premierAccesLe ? {} : { premierAccesLe: maintenant }) } });
    if (!espace.premierAccesLe) {
      await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_VISITE", direction: "ENTRANT", contenu: "Le client a ouvert son espace pour la première fois", metadata: JSON.stringify({ espaceId: espace.id }) } });
    }
  });
}

/* ── Photos ────────────────────────────────────────────────────────── */

export async function deposerPhotos(espace: EspaceClient, fichiers: File[]): Promise<{ deposees: number; refusees: string[] }> {
  if (fichiers.length === 0) throw new ErreurMetier("Aucune photo reçue.", 400);
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { photos: true, etape: true, prochaineAction: true } });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const dejaLa = lirePhotos(dossier.photos).length;
  if (dejaLa + fichiers.length > PHOTOS_MAX_PAR_DOSSIER) throw new ErreurMetier(`Vous avez déjà déposé beaucoup de photos (${dejaLa}). Quelques-unes suffisent : appelez-nous si besoin.`, 413);

  const refusees: string[] = [];
  let deposees = 0;
  await avecActeur(ACTEUR, async () => {
    for (const fichier of fichiers) {
      try {
        if (!FORMATS_PHOTO[fichier.type]) throw new ErreurMetier("format non pris en charge (JPEG, PNG, WebP ou HEIC)");
        if (fichier.size > PHOTO_OCTETS_MAX) throw new ErreurMetier("photo trop lourde (9 Mo au plus)");
        await ajouterPhoto(espace.dossierId, fichier);
        deposees++;
      } catch (erreur) {
        refusees.push(`${fichier.name || "photo"} : ${erreur instanceof Error ? erreur.message : "erreur"}`);
      }
    }
    if (deposees > 0) {
      await prisma.dossierEvenement.create({
        data: { dossierId: espace.dossierId, type: "ESPACE_PHOTOS", direction: "ENTRANT", contenu: `${deposees} photo${deposees > 1 ? "s" : ""} déposée${deposees > 1 ? "s" : ""} par le client dans son espace`, metadata: JSON.stringify({ nombre: deposees }) },
      });
      // La balle passe dans le camp de Lucas.
      if (!dossier.prochaineAction || /attendre les photos/i.test(dossier.prochaineAction)) {
        await prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Préparer la simulation (photos reçues)", prochaineActionDate: new Date() } });
      }
      // Une seule alerte pour un dépôt en plusieurs envois : elle part deux minutes après le premier.
      await mettreEnFile({ type: TACHE_ALERTE_PHOTOS, cle: `espace-photos:${espace.id}:${Math.floor(Date.now() / 300_000)}`, charge: { espaceId: espace.id, dossierId: espace.dossierId }, apres: new Date(Date.now() + 120_000), priorite: 6 });
    }
  });
  if (deposees === 0) throw new ErreurMetier(`Aucune photo n'a pu être enregistrée. ${refusees[0] ?? ""}`.trim(), 400);
  return { deposees, refusees };
}

export async function alerterPhotosDeposees(dossierId: string): Promise<{ photos: number }> {
  const depuis = new Date(Date.now() - 8 * 60_000);
  const [dossier, evenements] = await Promise.all([
    prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true, clientTelephone: true, photos: true } }),
    prisma.dossierEvenement.findMany({ where: { dossierId, type: "ESPACE_PHOTOS", createdAt: { gte: depuis } }, select: { metadata: true } }),
  ]);
  if (!dossier) return { photos: 0 };
  const nombre = evenements.reduce((n, e) => n + (Number((JSON.parse(e.metadata) as { nombre?: number }).nombre) || 0), 0);
  if (nombre === 0) return { photos: 0 };
  await alerter(
    {
      titre: `Photos reçues — ${dossier.clientNom}`,
      texte: `${nombre} photo${nombre > 1 ? "s" : ""} déposée${nombre > 1 ? "s" : ""} dans son espace (${lirePhotos(dossier.photos).length} au total).\nÀ vous : préparer la simulation.`,
      lien: `${appUrl()}/dossiers?dossier=${dossierId}`,
      libelleLien: "Ouvrir le dossier",
      telephone: dossier.clientTelephone || undefined,
      urgence: 4,
      etiquette: `espace-${dossierId}`,
    },
    { origine: "espace-client", canaux: ["telegram", "ntfy", "pushweb"] }
  );
  return { photos: nombre };
}

/** Chemin et type d'une photo du dossier, servie au client par son lien (jamais celle d'un autre dossier). */
export async function photoDeLEspace(espace: EspaceClient, photoId: string): Promise<{ contenu: Buffer; type: string }> {
  const { lirePhoto } = await import("@/lib/dossiers/dossiers");
  return lirePhoto(espace.dossierId, photoId);
}

/* ── Souhaits, coordonnées ─────────────────────────────────────────── */

export async function enregistrerSouhaits(espace: EspaceClient, souhaits: Souhaits): Promise<void> {
  const resume = [souhaits.propositions ? "veut des propositions" : null, souhaits.teintes.length ? `teintes : ${souhaits.teintes.join(", ")}` : null, souhaits.style ? `style : ${souhaits.style}` : null, souhaits.precisions ? `« ${souhaits.precisions} »` : null].filter(Boolean).join(" · ");
  await avecActeur(ACTEUR, async () => {
    const premier = !espace.souhaits;
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { souhaits: JSON.stringify(souhaits), souhaitsLe: new Date() } });
    // Un événement à la première saisie, puis au plus un par heure : le client coche et décoche.
    const recent = await prisma.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_SOUHAITS", createdAt: { gte: new Date(Date.now() - 3_600_000) } }, orderBy: { createdAt: "desc" } });
    if (premier || !recent) await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SOUHAITS", direction: "ENTRANT", contenu: resume || "Souhaits effacés", metadata: "{}" } });
    else await prisma.dossierEvenement.update({ where: { id: recent.id }, data: { contenu: resume || "Souhaits effacés" } });
  });
}

export const schemaCoordonnees = z.object({
  nom: z.string().trim().min(2, "Indiquez votre nom.").max(120),
  adresse: z.string().trim().min(3, "Indiquez votre adresse.").max(200),
  codePostal: z.string().trim().regex(/^\d{5}$/, "Code postal : cinq chiffres."),
  ville: z.string().trim().min(1, "Indiquez votre ville.").max(80),
  email: z.string().trim().max(160).refine((v) => v === "" || normaliserEmail(v) !== null, "Adresse e-mail invalide.").default(""),
});

export async function completerCoordonnees(espace: EspaceClient, entree: z.output<typeof schemaCoordonnees>): Promise<void> {
  await avecActeur(ACTEUR, async () => {
    await prisma.dossier.update({
      where: { id: espace.dossierId },
      data: { clientNom: entree.nom, clientAdresse: entree.adresse, clientCp: entree.codePostal, clientVille: entree.ville, ...(entree.email ? { clientEmail: normaliserEmail(entree.email) } : {}) },
    });
    await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_COORDONNEES", direction: "ENTRANT", contenu: "Le client a complété ses coordonnées (adresse du chantier)", metadata: "{}" } });
  });
}

/* ── Simulations ───────────────────────────────────────────────────── */

const RACINE_SIMULATIONS = "dossiers";

function cheminAbsolu(relatif: string): string {
  const base = path.resolve(resolveUploadsDir());
  const complet = path.resolve(base, relatif);
  if (!complet.startsWith(base + path.sep)) throw new ErreurMetier("Chemin de fichier invalide.", 400);
  return complet;
}

/** Lucas dépose une simulation dans l'espace du client (l'espace s'ouvre s'il n'existait pas). */
export async function deposerSimulation(dossierId: string, fichier: File, details: { titre?: string | null; description?: string | null }): Promise<{ id: string; espaceId: string }> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(fichier.type)) throw new ErreurMetier("Format d'image non pris en charge : JPEG, PNG ou WebP.", 415);
  if (fichier.size === 0 || fichier.size > PHOTO_OCTETS_MAX) throw new ErreurMetier("Image vide ou trop lourde (9 Mo au plus).", 413);
  const { espace } = await ouvrirEspace(dossierId);
  const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const relatif = path.posix.join(RACINE_SIMULATIONS, dossierId, "simulations", `${id}.${FORMATS_PHOTO[fichier.type]}`);
  const absolu = cheminAbsolu(relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  await fs.writeFile(absolu, Buffer.from(await fichier.arrayBuffer()));
  const ordre = await prisma.simulationEspace.count({ where: { espaceId: espace.id } });
  const simulation = await prisma.$transaction(async (tx) => {
    const creee = await tx.simulationEspace.create({ data: { espaceId: espace.id, dossierId, chemin: relatif, titre: details.titre?.trim().slice(0, 80) || null, description: details.description?.trim().slice(0, 400) || null, ordre } });
    await tx.dossierEvenement.create({ data: { dossierId, type: "ESPACE_SIMULATION_DEPOSEE", direction: "SORTANT", contenu: `Simulation déposée dans l'espace du client${creee.titre ? ` : ${creee.titre}` : ""}`, metadata: JSON.stringify({ simulationId: creee.id }) } });
    await tx.dossier.update({ where: { id: dossierId }, data: { prochaineAction: "Attendre le retour du client sur la simulation", prochaineActionDate: null } });
    return creee;
  });
  // La simulation existe : le dossier n'est plus en qualification.
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (dossier?.etape === "QUALIFICATION") await changerEtape(dossierId, { vers: "SIMULATION" }).catch((erreur) => console.error("[espace] passage en Simulation (non bloquant) :", erreur));
  return { id: simulation.id, espaceId: espace.id };
}

export async function retirerSimulation(simulationId: string, motif = "Retirée de l'espace client"): Promise<void> {
  await prisma.simulationEspace.update({ where: { id: simulationId }, data: { archiveLe: new Date(), archiveMotif: motif } });
}

export async function imageDeSimulation(filtre: { espaceId?: string; dossierId?: string }, simulationId: string): Promise<{ contenu: Buffer; type: string }> {
  const simulation = await prisma.simulationEspace.findFirst({ where: { id: simulationId, ...filtre } });
  if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
  try {
    const contenu = await fs.readFile(cheminAbsolu(simulation.chemin));
    const extension = path.posix.extname(simulation.chemin).slice(1).toLowerCase();
    return { contenu, type: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg" };
  } catch {
    throw new ErreurMetier("Image introuvable.", 404);
  }
}

export const schemaChoix = z.object({ commentaire: z.string().trim().max(1000, "Commentaire trop long.").default("") });

export async function choisirSimulation(espace: EspaceClient, simulationId: string, commentaire: string): Promise<void> {
  const simulation = await prisma.simulationEspace.findFirst({ where: { id: simulationId, espaceId: espace.id } });
  if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true } });
  await avecActeur(ACTEUR, async () => {
    await prisma.$transaction([
      prisma.simulationEspace.updateMany({ where: { espaceId: espace.id, id: { not: simulationId }, choisieLe: { not: null } }, data: { choisieLe: null } }),
      prisma.simulationEspace.update({ where: { id: simulationId }, data: { choisieLe: new Date(), ...(commentaire ? { commentaireClient: commentaire, commenteeLe: new Date() } : {}) } }),
      prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SIMULATION_CHOISIE", direction: "ENTRANT", contenu: `Le client a choisi la simulation${simulation.titre ? ` « ${simulation.titre} »` : ""}${commentaire ? ` : « ${commentaire} »` : ""}`, metadata: JSON.stringify({ simulationId }) } }),
      prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)", prochaineActionDate: new Date() } }),
    ]);
  });
  await alerter(
    {
      titre: `Simulation choisie — ${dossier?.clientNom ?? "client"}`,
      texte: `${simulation.titre ? `« ${simulation.titre} »` : "Une simulation"} a été choisie.${commentaire ? `\n« ${commentaire} »` : ""}\nÀ vous : préparer le devis.`,
      lien: `${appUrl()}/dossiers?dossier=${espace.dossierId}`,
      libelleLien: "Ouvrir le dossier",
      telephone: dossier?.clientTelephone || undefined,
      urgence: 5,
      etiquette: `espace-${espace.dossierId}`,
    },
    { origine: "espace-client", canaux: ["telegram", "ntfy", "pushweb"] }
  );
}

export async function commenterSimulation(espace: EspaceClient, simulationId: string, commentaire: string): Promise<void> {
  if (!commentaire) throw new ErreurMetier("Le commentaire est vide.", 400);
  const simulation = await prisma.simulationEspace.findFirst({ where: { id: simulationId, espaceId: espace.id } });
  if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true } });
  await avecActeur(ACTEUR, async () => {
    await prisma.$transaction([
      prisma.simulationEspace.update({ where: { id: simulationId }, data: { commentaireClient: commentaire, commenteeLe: new Date() } }),
      prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_COMMENTAIRE", direction: "ENTRANT", contenu: `Commentaire du client${simulation.titre ? ` sur « ${simulation.titre} »` : ""} : « ${commentaire} »`, metadata: JSON.stringify({ simulationId }) } }),
    ]);
  });
  await alerter(
    { titre: `Commentaire — ${dossier?.clientNom ?? "client"}`, texte: `« ${commentaire} »`, lien: `${appUrl()}/dossiers?dossier=${espace.dossierId}`, libelleLien: "Ouvrir le dossier", telephone: dossier?.clientTelephone || undefined, urgence: 4, etiquette: `espace-${espace.dossierId}` },
    { origine: "espace-client", canaux: ["telegram", "ntfy", "pushweb"] }
  );
}

/* ── Devis : bon pour accord ───────────────────────────────────────── */

export const schemaAccord = z.object({
  documentId: z.string().min(1).max(40),
  nom: z.string("Indiquez votre nom.").trim().min(2, "Indiquez votre nom.").max(120),
  /** La case « j'ai lu et j'accepte le devis » : sans elle, pas d'accord. */
  accepte: z.literal(true, "Cochez la case pour donner votre accord."),
});

/**
 * Bon pour accord : UN clic du client. L'accord est écrit une fois pour toutes
 * (ligne jamais modifiée, avec la date, le montant figé, l'adresse IP et le
 * navigateur), le devis passe « accepté », le dossier passe « Signé » et Lucas
 * est prévenu sur son téléphone. Vaut signature même sans paiement immédiat.
 */
export async function accepterDevis(espace: EspaceClient, entree: z.output<typeof schemaAccord>, origine: { ip: string | null; navigateur: string | null }): Promise<{ dejaAccepte: boolean }> {
  const devis = await prisma.document.findFirst({ where: { id: entree.documentId, dossierId: espace.dossierId, type: "DEVIS", archiveLe: null, numero: { not: null } } });
  if (!devis) throw new ErreurMetier("Devis introuvable.", 404);
  if (["REMPLACE", "ANNULEE", "REFUSE"].includes(devis.statut)) throw new ErreurMetier("Ce devis n'est plus en vigueur : un nouveau devis vous sera proposé.", 409);
  const existant = await prisma.accordDevis.findFirst({ where: { documentId: devis.id } });
  if (existant) return { dejaAccepte: true };

  const montants = calculerMontants(lireLignes(devis.lignes), devis.acomptePct);
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true, etape: true } });
  await avecActeur(ACTEUR, async () => {
    await prisma.$transaction([
      prisma.accordDevis.create({
        data: { dossierId: espace.dossierId, documentId: devis.id, numeroDevis: devis.numero, totalHt: montants.totalHtCentimes / 100, acomptePct: devis.acomptePct, nomSignataire: entree.nom, mention: "Bon pour accord", ip: origine.ip, navigateur: origine.navigateur?.slice(0, 300) ?? null },
      }),
      prisma.dossierEvenement.create({
        data: { dossierId: espace.dossierId, type: "ESPACE_DEVIS_ACCEPTE", direction: "ENTRANT", contenu: `Bon pour accord donné par ${entree.nom} sur le devis ${devis.numero} (${(montants.totalTtcCentimes / 100).toLocaleString("fr-FR")} €)`, metadata: JSON.stringify({ documentId: devis.id }) },
      }),
    ]);
    // Le dossier passe « Signé » : c'est le client qui signe, pas un agent. L'acompte reste à enregistrer par Lucas.
    const etapesAvantSignature: EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE", "EN_PAUSE", "PERDU"];
    if (dossier && etapesAvantSignature.includes(dossier.etape as EtapeDossier)) {
      await changerEtape(espace.dossierId, { vers: "SIGNE", devisAccepteId: devis.id, confirmations: { BON_POUR_ACCORD: true } });
    } else if (devis.statut !== "ACCEPTE") {
      await prisma.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
    }
    await prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Appeler le client : fixer la date du chantier, suivre l'acompte", prochaineActionDate: new Date() } });
  });

  await alerter(
    {
      titre: `DEVIS SIGNÉ — ${dossier?.clientNom ?? entree.nom}`,
      texte: `Bon pour accord sur le devis ${devis.numero} : ${(montants.totalTtcCentimes / 100).toLocaleString("fr-FR")} €${montants.acompteCentimes ? ` (acompte ${(montants.acompteCentimes / 100).toLocaleString("fr-FR")} €)` : ""}.\nÀ vous : appeler pour fixer la date du chantier.`,
      lien: `${appUrl()}/dossiers?dossier=${espace.dossierId}`,
      libelleLien: "Ouvrir le dossier",
      telephone: dossier?.clientTelephone || undefined,
      urgence: 5,
      etiquette: `accord-${espace.dossierId}`,
    },
    { origine: "espace-accord" }
  );
  return { dejaAccepte: false };
}
