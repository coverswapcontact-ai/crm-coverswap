import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { EspaceClient, EspacePermanent } from "@prisma/client";
import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ouvrirDossierDuLead } from "@/lib/dossiers/depuis-lead";
import { rattacherDossier } from "@/lib/clients/identification";

/**
 * Le lien de l'espace client : https://coverswap.fr/e/<code>-<signature>
 *
 *  - `code` : huit caractères tirés au hasard ;
 *  - `signature` : HMAC-SHA256(secret, code + version), 12 octets en base64url
 *    (16 caractères : le lien doit tenir dans un SMS). Sans le secret du serveur,
 *    un lien ne se fabrique pas et ne se devine pas (2^96 essais, et chaque essai
 *    est une requête au serveur) ; le code seul ne donne accès à rien.
 *
 * Mission 5 (22/09/2026) : UN CLIENT = UN ESPACE, POUR TOUJOURS. Le lien est
 * celui de son espace permanent (EspacePermanent) : il n'expire plus. Il se
 * révoque (`revoqueLe`) ou se régénère (la version monte : tous les liens déjà
 * envoyés meurent d'un coup). Chaque projet (EspaceClient, un par dossier) garde
 * son propre code : un lien envoyé avant le 22/09 reste valable et ouvre l'espace
 * du client sur ce projet. Après 90 jours sans visite, l'espace demande les
 * quatre derniers chiffres du téléphone du client avant de s'ouvrir.
 *
 * Le jeton n'est jamais stocké : le CRM le recalcule quand il doit l'écrire
 * dans un SMS. Secret : ESPACE_CLIENT_SECRET, à défaut une clé dérivée de
 * NEXTAUTH_SECRET (rien de nouveau à poser pour que l'espace fonctionne).
 */
/** Sans visite depuis ce délai, l'espace demande de confirmer le téléphone. */
export const JOURS_AVANT_CONFIRMATION = 90;
/** Essais manqués permis par 24 heures (10 000 combinaisons : des années d'essais). */
export const ESSAIS_CONFIRMATION = 5;
/** Colonne historique des projets : un projet d'un espace permanent n'expire plus. */
export const JAMAIS = new Date("2100-01-01T00:00:00.000Z");
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // sans 0/o, 1/l/i : un lien se dicte parfois au téléphone

function secretEspace(): string {
  const propre = process.env.ESPACE_CLIENT_SECRET?.trim();
  if (propre) return propre;
  const racine = process.env.NEXTAUTH_SECRET?.trim();
  if (!racine) throw new Error("Espace client : ni ESPACE_CLIENT_SECRET ni NEXTAUTH_SECRET ne sont posées, aucun lien ne peut être signé.");
  return createHmac("sha256", racine).update("espace-client/v1").digest("hex");
}

function signer(code: string, version: number): string {
  return createHmac("sha256", secretEspace()).update(`${code}.${version}`).digest().subarray(0, 12).toString("base64url");
}

function tirerCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** Un code libre dans les deux tables : un lien ne peut jamais désigner deux espaces. */
export async function codeLibre(client: Transaction | typeof prisma = prisma): Promise<string> {
  for (let essai = 0; essai < 8; essai++) {
    const code = tirerCode();
    const [permanent, projet] = await Promise.all([client.espacePermanent.findUnique({ where: { code }, select: { id: true } }), client.espaceClient.findUnique({ where: { code }, select: { id: true } })]);
    if (!permanent && !projet) return code;
  }
  throw new Error("Espace client : aucun code libre trouvé (tirage malchanceux), réessayer.");
}

export function adresseDuSite(): string {
  return (process.env.SITE_URL || "https://coverswap.fr").replace(/\/$/, "");
}

type Signable = Pick<EspacePermanent, "code" | "version">;

export function jetonEspace(espace: Signable): string {
  return `${espace.code}-${signer(espace.code, espace.version)}`;
}

/** Le lien de l'espace du client (le permanent). */
export function lienEspace(espace: Signable): string {
  return `${adresseDuSite()}/e/${jetonEspace(espace)}`;
}

/** Le même lien, ouvert sur un projet précis (SMS « vos simulations sont prêtes »…). */
export function lienDuProjet(permanent: Signable, projet: Pick<EspaceClient, "code"> | null | undefined): string {
  return projet ? `${lienEspace(permanent)}?p=${projet.code}` : lienEspace(permanent);
}

/**
 * Le lien à envoyer pour un projet : celui du CLIENT (son espace permanent),
 * ouvert sur ce projet quand il en a plusieurs ; le code du projet seul pour un
 * projet qui n'a pas encore d'espace permanent. Désactivé : null.
 */
export async function lienPourLeProjet(espace: Pick<EspaceClient, "code" | "version" | "permanentId" | "revoqueLe">): Promise<string | null> {
  const permanent = espace.permanentId ? await prisma.espacePermanent.findUnique({ where: { id: espace.permanentId } }) : null;
  if (!permanent) return espace.revoqueLe ? null : lienEspace(espace);
  if (permanent.revoqueLe) return null;
  const projets = await prisma.espaceClient.count({ where: { permanentId: permanent.id, archiveLe: null, revoqueLe: null, dossier: { archiveLe: null } } });
  return projets > 1 ? lienDuProjet(permanent, espace) : lienEspace(permanent);
}

/*
 * Aperçu : Lucas ouvre l'espace tel que le client le voit, depuis le CRM, sans
 * que sa visite compte et sans pouvoir rien y écrire (pas de faux « devis
 * consulté », pas d'accord donné par erreur). La marque d'aperçu est signée
 * avec le même secret et ne vaut que deux jours.
 */
function signerApercu(espace: Signable, jour: number): string {
  return createHmac("sha256", secretEspace()).update(`apercu.${espace.code}.${espace.version}.${jour}`).digest().subarray(0, 12).toString("base64url");
}

export function lienApercu(espace: Signable, maintenant = Date.now(), projet?: Pick<EspaceClient, "code"> | null): string {
  const lien = lienDuProjet(espace, projet);
  return `${lien}${lien.includes("?") ? "&" : "?"}apercu=${signerApercu(espace, Math.floor(maintenant / 86_400_000))}`;
}

export function apercuValide(espace: Signable, marque: string | null | undefined, maintenant = Date.now()): boolean {
  if (!marque || !/^[A-Za-z0-9_-]{16}$/.test(marque)) return false;
  const jour = Math.floor(maintenant / 86_400_000);
  return [jour, jour - 1].some((j) => {
    const attendue = Buffer.from(signerApercu(espace, j));
    const recue = Buffer.from(marque);
    return attendue.length === recue.length && timingSafeEqual(attendue, recue);
  });
}

export class LienEspaceInvalide extends ErreurMetier {
  constructor(message: string, status: number, readonly raison: "inconnu" | "expire" | "revoque") {
    super(message, status, { raison });
  }
}

const signatureValide = (code: string, version: number | undefined, signature: string) => {
  const attendue = Buffer.from(signer(code, version ?? 0));
  const recue = Buffer.from(signature);
  return attendue.length === recue.length && timingSafeEqual(attendue, recue);
};

/** Ce qu'ouvre un jeton : l'espace permanent du client, et le projet du lien si c'était un lien de projet. */
export type AccesEspace = { permanent: EspacePermanent; projetDuLien: EspaceClient | null };

/**
 * Vérifie un jeton présenté par un visiteur. Un lien inconnu, mal signé ou d'une
 * version passée rend la même réponse : on ne dit pas à un curieux si un code
 * existe. Les signatures sont calculées même quand le code n'existe pas : temps
 * de réponse identique.
 */
export async function accesDuJeton(jeton: string): Promise<AccesEspace> {
  const inconnu = () => new LienEspaceInvalide("Ce lien n'est pas valide. Demandez-en un nouveau à CoverSwap.", 404, "inconnu");
  const correspondance = /^([a-z0-9]{8})-([A-Za-z0-9_-]{16})$/.exec(jeton.trim());
  if (!correspondance) throw inconnu();
  const [, code, signature] = correspondance;
  const [permanentDuCode, projetDuCode] = await Promise.all([prisma.espacePermanent.findUnique({ where: { code } }), prisma.espaceClient.findUnique({ where: { code } })]);
  const parPermanent = signatureValide(code, permanentDuCode?.version, signature) && Boolean(permanentDuCode);
  const parProjet = signatureValide(code, projetDuCode?.version, signature) && Boolean(projetDuCode);
  let permanent: EspacePermanent | null = null;
  let projetDuLien: EspaceClient | null = null;
  if (parPermanent) permanent = permanentDuCode;
  else if (parProjet && projetDuCode) {
    projetDuLien = projetDuCode;
    // Un projet sans espace permanent (écrit par un code d'avant le 22/09, entre deux déploiements) : rangé au passage.
    permanent = projetDuCode.permanentId ? await prisma.espacePermanent.findUnique({ where: { id: projetDuCode.permanentId } }) : await rangerProjetOrphelin(projetDuCode);
  }
  if (!permanent) throw inconnu();
  // Deux clients fusionnés : l'ancien lien mène à l'espace conservé.
  for (let saut = 0; saut < 3 && permanent.fusionneDansId; saut++) {
    const suite: EspacePermanent | null = await prisma.espacePermanent.findUnique({ where: { id: permanent.fusionneDansId } });
    if (!suite) break;
    permanent = suite;
  }
  if (permanent.archiveLe) throw inconnu();
  if (permanent.revoqueLe) throw new LienEspaceInvalide("Ce lien a été désactivé. Demandez-en un nouveau à CoverSwap.", 410, "revoque");
  // Un lien de projet n'ouvre jamais que l'espace de SON client (les projets d'un client fusionné ont suivi).
  if (projetDuLien && projetDuLien.permanentId !== permanent.id) projetDuLien = null;
  return { permanent, projetDuLien };
}

/* ── Confirmation du téléphone ──────────────────────────────────────── */

/** Plus de 90 jours sans visite (ou depuis l'envoi du lien, s'il n'a jamais été ouvert) : l'espace demande le téléphone. */
export function confirmationRequise(permanent: Pick<EspacePermanent, "dernierAccesLe" | "lienEmisLe" | "confirmeLe">, maintenant = new Date()): boolean {
  const reperes = [permanent.dernierAccesLe, permanent.confirmeLe, permanent.lienEmisLe].filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  const dernier = reperes.length ? Math.max(...reperes) : 0;
  return maintenant.getTime() - dernier > JOURS_AVANT_CONFIRMATION * 86_400_000;
}

/** Les numéros du client : ceux de sa fiche, de ses dossiers, de ses demandes. Chiffres seulement. */
export async function numerosDuClient(clientId: string): Promise<string[]> {
  const [client, dossiers, leads] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { telephones: { where: { archiveLe: null }, select: { numero: true, saisi: true } } } }),
    prisma.dossier.findMany({ where: { clientId }, select: { clientTelephone: true } }),
    prisma.lead.findMany({ where: { clientId }, select: { telephone: true } }),
  ]);
  const bruts = [...(client?.telephones ?? []).flatMap((t) => [t.numero, t.saisi]), ...dossiers.map((d) => d.clientTelephone), ...leads.map((l) => l.telephone)];
  return [...new Set(bruts.map((n) => (n ?? "").replace(/\D/g, "")).filter((n) => n.length >= 6))];
}

export type ResultatConfirmation = { ok: true } | { ok: false; restants: number; bloque: boolean };

/**
 * Le client tape les quatre derniers chiffres de son téléphone. Réussi : l'espace
 * s'ouvre (et ne redemandera rien avant 90 jours sans visite). Manqué : compté ;
 * au cinquième en 24 heures, bloqué jusqu'au lendemain et Lucas est prévenu.
 */
export async function confirmerTelephone(permanent: EspacePermanent, chiffres: string, maintenant = new Date()): Promise<ResultatConfirmation> {
  const saisis = chiffres.replace(/\D/g, "");
  const fenetre = permanent.confirmationEchecLe && maintenant.getTime() - permanent.confirmationEchecLe.getTime() < 24 * 3_600_000;
  const echecs = fenetre ? permanent.confirmationEchecs : 0;
  if (echecs >= ESSAIS_CONFIRMATION) return { ok: false, restants: 0, bloque: true };
  const numeros = await numerosDuClient(permanent.clientId);
  // Aucun numéro connu : rien à vérifier, on ne bloque pas le client dehors (et Lucas le verra au journal).
  const bon = saisis.length === 4 && (numeros.length === 0 || numeros.some((n) => n.endsWith(saisis)));
  if (bon) {
    await prisma.espacePermanent.update({ where: { id: permanent.id }, data: { confirmeLe: maintenant, confirmationEchecs: 0, confirmationEchecLe: null } });
    return { ok: true };
  }
  const total = echecs + 1;
  await prisma.espacePermanent.update({ where: { id: permanent.id }, data: { confirmationEchecs: total, confirmationEchecLe: maintenant } });
  return { ok: false, restants: Math.max(0, ESSAIS_CONFIRMATION - total), bloque: total >= ESSAIS_CONFIRMATION };
}

/* ── Ouvrir, révoquer, régénérer ─────────────────────────────────────── */

/** Le dossier vivant d'un contact ; ouvert (avec tout ce qu'on sait de lui) s'il n'en a pas encore. */
export async function dossierDuContact(leadId: string): Promise<string> {
  return (await ouvrirDossierDuLead(leadId, { motif: "ESPACE", prochaineAction: "Attendre les photos du client" })).dossierId;
}

export type EspaceOuvert = { espace: EspaceClient; permanent: EspacePermanent; lien: string; nouveau: boolean };

/** L'espace permanent d'un client : créé au besoin, avec le code donné (celui de son premier projet) s'il est libre. */
export async function assurerPermanent(tx: Transaction, clientId: string, code?: string, version = 1): Promise<EspacePermanent> {
  const existant = await tx.espacePermanent.findUnique({ where: { clientId } });
  if (existant) return existant;
  const libre = code && !(await tx.espacePermanent.findUnique({ where: { code }, select: { id: true } })) ? code : await codeLibre(tx);
  return tx.espacePermanent.create({ data: { code: libre, version: libre === code ? version : 1, clientId } });
}

/** Un projet écrit sans espace permanent (code d'avant la mission 5 encore en service) : rattaché à celui de son client. */
async function rangerProjetOrphelin(projet: EspaceClient): Promise<EspacePermanent | null> {
  const dossier = await prisma.dossier.findUnique({ where: { id: projet.dossierId } });
  if (!dossier) return null;
  return prisma.$transaction(async (tx) => {
    const clientId = dossier.clientId ?? (await rattacherDossier(tx, dossier));
    const permanent = await assurerPermanent(tx, clientId, projet.code, projet.version);
    await tx.espaceClient.update({ where: { id: projet.id }, data: { permanentId: permanent.id, expireLe: JAMAIS } });
    return permanent;
  });
}

/**
 * L'espace d'un dossier : c'est un projet de l'espace permanent de son client.
 * Le client est retrouvé (ou créé) d'après le dossier ; son espace permanent
 * est créé au premier projet, avec le même code. Ouvert par Lucas au-delà de
 * deux projets en cours : c'est son accord, noté sur l'espace.
 */
export async function ouvrirEspace(dossierId: string): Promise<EspaceOuvert> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId } });
  if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
  let existant = await prisma.espaceClient.findUnique({ where: { dossierId } });
  if (existant?.archiveLe) throw new ErreurMetier("L'espace de ce projet est archivé.", 409);
  // Un projet masqué (son dossier avait été archivé, puis restauré) d'un espace permanent : Lucas le rouvre.
  if (existant?.revoqueLe && existant.permanentId) existant = await prisma.espaceClient.update({ where: { id: existant.id }, data: { revoqueLe: null } });
  if (existant?.revoqueLe) throw new ErreurMetier("L'espace de ce projet est désactivé : régénérer le lien du client pour le rouvrir.", 409);
  let nouveau = false;
  const { espace, permanent } = await prisma.$transaction(async (tx) => {
    const clientId = dossier.clientId ?? (await rattacherDossier(tx, dossier));
    if (existant?.permanentId) {
      const permanent = await tx.espacePermanent.findUniqueOrThrow({ where: { id: existant.permanentId } });
      return { espace: existant, permanent };
    }
    const code = existant?.code ?? (await codeLibre(tx));
    const permanent = await assurerPermanent(tx, clientId, code, existant?.version ?? 1);
    if (permanent.revoqueLe) throw new ErreurMetier("Le lien de ce client est désactivé : le régénérer pour lui rouvrir son espace.", 409);
    if (existant) {
      const espace = await tx.espaceClient.update({ where: { id: existant.id }, data: { permanentId: permanent.id, expireLe: JAMAIS } });
      return { espace, permanent };
    }
    const espace = await tx.espaceClient.create({ data: { code, dossierId, expireLe: JAMAIS, permanentId: permanent.id } });
    await tx.dossierEvenement.create({ data: { dossierId, type: "ESPACE_LIEN_CREE", direction: "INTERNE", contenu: "Projet ouvert dans l'espace client (le lien du client, sans expiration)", metadata: JSON.stringify({ espaceId: espace.id, permanentId: permanent.id }) } });
    // Au-delà de deux projets en cours, c'est Lucas qui ouvre : son accord est noté (le contrôle de cohérence n'y voit pas d'excès).
    const { projetsEnCours } = await import("./projets");
    const enCours = await projetsEnCours(tx, permanent.id);
    const limite = 2 + permanent.projetsAccordes;
    if (enCours > limite) await tx.espacePermanent.update({ where: { id: permanent.id }, data: { projetsAccordes: enCours - 2 } });
    nouveau = true;
    return { espace, permanent };
  });
  if (nouveau) {
    // Les simulations que le client a déjà faites sur le site l'attendent dans son espace.
    const { synchroniserSimulationsSite } = await import("@/lib/simulations/dossier");
    await synchroniserSimulationsSite(dossierId).catch((erreur) => console.error("[espace] simulations du site non rangées à l'ouverture :", erreur));
  }
  return { espace, permanent, lien: lienEspace(permanent), nouveau };
}

/** Depuis la fiche d'un contact : ouvre le dossier s'il le faut, puis l'espace. */
export async function ouvrirEspaceDuContact(leadId: string): Promise<EspaceOuvert & { dossierId: string }> {
  const dossierId = await dossierDuContact(leadId);
  return { ...(await ouvrirEspace(dossierId)), dossierId };
}

/** L'espace permanent auquel appartient un projet (ou un identifiant d'espace permanent). */
async function permanentDe(id: string): Promise<EspacePermanent> {
  const direct = await prisma.espacePermanent.findUnique({ where: { id } });
  if (direct) return direct;
  const projet = await prisma.espaceClient.findUnique({ where: { id }, select: { permanentId: true } });
  if (!projet?.permanentId) throw new ErreurMetier("Espace introuvable.", 404);
  return prisma.espacePermanent.findUniqueOrThrow({ where: { id: projet.permanentId } });
}

/** Désactive le lien du client : il lit « lien désactivé ». Rien n'est effacé. */
export async function revoquerEspace(id: string): Promise<EspacePermanent> {
  const permanent = await permanentDe(id);
  return prisma.espacePermanent.update({ where: { id: permanent.id }, data: { revoqueLe: new Date() } });
}

/**
 * Nouveau lien : la version monte sur l'espace ET sur chacun de ses projets —
 * tous les liens déjà envoyés meurent d'un coup, y compris ceux d'avant le 22/09.
 * La confirmation du téléphone repart de zéro (le lien est neuf).
 */
export async function renouvelerEspace(id: string): Promise<EspaceOuvert> {
  const avant = await permanentDe(id);
  const permanent = await prisma.$transaction(async (tx) => {
    await tx.espaceClient.updateMany({ where: { permanentId: avant.id }, data: { version: { increment: 1 } } });
    return tx.espacePermanent.update({ where: { id: avant.id }, data: { version: { increment: 1 }, revoqueLe: null, lienEmisLe: new Date(), confirmationEchecs: 0, confirmationEchecLe: null } });
  });
  const espace = await prisma.espaceClient.findFirst({ where: { permanentId: permanent.id }, orderBy: { createdAt: "desc" } });
  if (!espace) throw new ErreurMetier("Cet espace n'a aucun projet.", 409);
  return { espace, permanent, lien: lienEspace(permanent), nouveau: false };
}
