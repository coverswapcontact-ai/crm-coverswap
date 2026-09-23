import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ajouterCoordonnee, modifierClient } from "@/lib/clients/fiches";
import { noterRapidement } from "@/lib/commercial/appels";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { estJourValide } from "@/lib/dossiers/dates";
import { modifierDossier } from "@/lib/dossiers/dossiers";
import { recalculerMain } from "@/lib/dossiers/main";
import { DELAIS_CLIENT } from "@/lib/espace/projet";
import { STYLES_CLIENT } from "@/lib/simulateur/types-surface";
import { enregistrerProjet } from "@/lib/espace/service";
import { enregistrerPrestations } from "@/lib/prestations/dossier";
import { TYPES_PROJET } from "@/lib/prospects/constantes";
import { modifierEntrant } from "@/lib/prospects/entrants";
import { definirProposition } from "@/lib/validation/definitions";
import { rangerPiecesDansDossier } from "./rattachement";

/**
 * Propositions nées d'un mail (mission 9). Claude lit le mail par le MCP et
 * DÉPOSE des cartes : « le client change de teinte », « il donne une date »,
 * « il joint deux photos » — chacune avec le passage du mail qui la justifie.
 * Rien n'est modifié tant que Lucas ne valide pas ; une carte validée passe
 * par le même code que la fiche ou l'espace client (`modifierDossier`,
 * `modifierClient`, `enregistrerPrestations`, `enregistrerProjet`,
 * `modifierEntrant`) : mêmes règles, même journal, même « qui a la main ».
 * Sensible (montant, adresse, date de chantier) : jamais sans confirmation.
 */

export const TYPE_MAJ_DEPUIS_MAIL = "MAJ_DEPUIS_MAIL";
export const TYPE_REGLE_TRI = "REGLE_TRI";

export const CIBLES_MAJ = ["DOSSIER", "CLIENT", "LEAD", "PROJET"] as const;
export type CibleMaj = (typeof CIBLES_MAJ)[number];

export type DefinitionChamp = { libelle: string; nature: "texte" | "texteLong" | "jour" | "nombre" | "choix" | "liste"; sensible?: boolean; options?: readonly string[]; aide?: string };

/** Les champs qu'une carte peut viser, par cible : ce que la fiche ou l'espace permettent déjà de changer. */
export const CHAMPS_MAJ: Record<CibleMaj, Record<string, DefinitionChamp>> = {
  DOSSIER: {
    objet: { libelle: "Objet du dossier", nature: "texte" },
    montantEstime: { libelle: "Montant estimé", nature: "nombre", sensible: true },
    dateChantier: { libelle: "Date du chantier", nature: "jour", sensible: true },
    prochaineAction: { libelle: "Prochaine action", nature: "texte" },
    prochaineActionDate: { libelle: "Date de la prochaine action", nature: "jour" },
    clientAdresse: { libelle: "Adresse du chantier", nature: "texte", sensible: true },
    clientCp: { libelle: "Code postal du chantier", nature: "texte", sensible: true },
    clientVille: { libelle: "Ville du chantier", nature: "texte", sensible: true },
    clientEmail: { libelle: "E-mail sur le dossier", nature: "texte" },
    clientTelephone: { libelle: "Téléphone sur le dossier", nature: "texte" },
    prestations: { libelle: "Familles et sous-parties", nature: "liste", aide: "JSON { CUISINE: [\"facades-hautes\"], SDB: [] }, comme l'onglet Projet." },
    note: { libelle: "Note dans le dossier", nature: "texteLong" },
    photos: { libelle: "Photos et documents du mail", nature: "liste", aide: "« toutes » : les pièces jointes du mail sont rangées dans le dossier (et dans Drive)." },
  },
  CLIENT: {
    prenom: { libelle: "Prénom", nature: "texte" },
    nomFamille: { libelle: "Nom", nature: "texte" },
    raisonSociale: { libelle: "Raison sociale", nature: "texte" },
    adresse: { libelle: "Adresse", nature: "texte", sensible: true },
    codePostal: { libelle: "Code postal", nature: "texte", sensible: true },
    ville: { libelle: "Ville", nature: "texte", sensible: true },
    notes: { libelle: "Passif (notes de la fiche)", nature: "texteLong" },
    email: { libelle: "Nouvelle adresse e-mail", nature: "texte" },
    telephone: { libelle: "Nouveau téléphone", nature: "texte" },
  },
  LEAD: {
    prenom: { libelle: "Prénom", nature: "texte" },
    nomFamille: { libelle: "Nom", nature: "texte" },
    ville: { libelle: "Ville", nature: "texte" },
    codePostal: { libelle: "Code postal", nature: "texte" },
    typeProjet: { libelle: "Type de projet", nature: "choix", options: TYPES_PROJET },
    notes: { libelle: "Notes du lead", nature: "texteLong" },
    email: { libelle: "E-mail", nature: "texte" },
    telephone: { libelle: "Téléphone", nature: "texte" },
  },
  PROJET: {
    styles: { libelle: "Teintes et styles souhaités", nature: "liste", options: STYLES_CLIENT, aide: "Liste de styles de l'espace client (bois-clair, marbre…)." },
    precisions: { libelle: "Précisions du client", nature: "texteLong" },
    delai: { libelle: "Délai souhaité", nature: "choix", options: DELAIS_CLIENT.map((d) => d.id) },
    metres: { libelle: "Mètres linéaires", nature: "nombre" },
  },
};

export const schemaMaj = z.object({
  messageId: z.string().max(40),
  cible: z.enum(CIBLES_MAJ),
  dossierId: z.string().max(40).nullable().optional().transform((v) => v || null),
  clientId: z.string().max(40).nullable().optional().transform((v) => v || null),
  leadId: z.string().max(40).nullable().optional().transform((v) => v || null),
  champ: z.string().min(1).max(40),
  /** Toujours une chaîne : un nombre en chiffres, une liste en JSON. */
  valeur: z.string().max(4000),
  libelle: z.string().max(160).nullable().optional().transform((v) => v || null),
  /** Le passage du mail qui justifie la carte : sans lui, pas de carte. */
  passage: z.string().min(3).max(600),
});
export type ContenuMaj = z.output<typeof schemaMaj>;

export function champDe(cible: CibleMaj, champ: string): DefinitionChamp | null {
  return CHAMPS_MAJ[cible][champ] ?? null;
}

export function estSensibleMaj(contenu: Pick<ContenuMaj, "cible" | "champ">): boolean {
  return champDe(contenu.cible, contenu.champ)?.sensible === true;
}

function lireListe(valeur: string): string[] {
  try {
    const lu: unknown = JSON.parse(valeur);
    if (Array.isArray(lu)) return lu.filter((x): x is string => typeof x === "string");
  } catch {
    // liste séparée par des virgules
  }
  return valeur.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
}

function lireNombre(valeur: string, libelle: string): number {
  const n = Number(valeur.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new ErreurMetier(`${libelle} : « ${valeur} » n'est pas un nombre.`, 400);
  return n;
}

function lireJour(valeur: string, libelle: string): string {
  if (!estJourValide(valeur)) throw new ErreurMetier(`${libelle} : « ${valeur} » n'est pas une date AAAA-MM-JJ.`, 400);
  return valeur;
}

/** Valide la forme de la valeur pour ce champ (avant de créer la carte) : refuse tôt, pas à la validation. */
export function verifierValeur(contenu: ContenuMaj): void {
  const champ = champDe(contenu.cible, contenu.champ);
  if (!champ) throw new ErreurMetier(`Champ inconnu pour ${contenu.cible} : « ${contenu.champ} » (permis : ${Object.keys(CHAMPS_MAJ[contenu.cible]).join(", ")}).`, 400);
  if (champ.nature === "nombre") lireNombre(contenu.valeur, champ.libelle);
  if (champ.nature === "jour") lireJour(contenu.valeur, champ.libelle);
  if (champ.nature === "choix" && champ.options && !champ.options.includes(contenu.valeur)) throw new ErreurMetier(`${champ.libelle} : « ${contenu.valeur} » n'est pas parmi ${champ.options.join(", ")}.`, 400);
  if (champ.nature === "liste" && champ.options) {
    const hors = lireListe(contenu.valeur).filter((v) => !champ.options!.includes(v));
    if (hors.length) throw new ErreurMetier(`${champ.libelle} : ${hors.join(", ")} n'est pas parmi ${champ.options.join(", ")}.`, 400);
  }
  if (contenu.cible === "DOSSIER" && !contenu.dossierId) throw new ErreurMetier("Une carte sur un dossier demande dossierId.", 400);
  if (contenu.cible === "PROJET" && !contenu.dossierId) throw new ErreurMetier("Une carte sur le projet demande dossierId (l'espace de ce dossier).", 400);
  if (contenu.cible === "CLIENT" && !contenu.clientId) throw new ErreurMetier("Une carte sur une fiche client demande clientId.", 400);
  if (contenu.cible === "LEAD" && !contenu.leadId) throw new ErreurMetier("Une carte sur un lead demande leadId.", 400);
}

export const propositionMajDepuisMail = definirProposition({
  type: TYPE_MAJ_DEPUIS_MAIL,
  libelle: "Mettre à jour depuis un mail",
  schema: schemaMaj,
  sensible: (contenu) => estSensibleMaj(contenu),
  validationGroupee: true,
  champs: [{ cle: "valeur", libelle: "Valeur", nature: "texte", obligatoire: true }],
  motifsRejet: [
    { code: "MAL_LU", libelle: "Mal lu : ce n'est pas ce que dit le mail" },
    { code: "DEJA_A_JOUR", libelle: "Déjà à jour" },
    { code: "PAS_MAINTENANT", libelle: "Pas maintenant" },
  ],
  // En file : l'application passe par le code de la fiche (ses propres transactions), hors de celle de la validation.
  execution: "FILE",
  liens: (contenu) => [
    { libelle: "Le mail", href: `/mail?mail=${contenu.messageId}` },
    ...(contenu.dossierId ? [{ libelle: "Dossier", href: `/dossiers?dossier=${contenu.dossierId}` }] : []),
    ...(contenu.clientId ? [{ libelle: "Fiche client", href: `/clients/${contenu.clientId}` }] : []),
    ...(contenu.leadId ? [{ libelle: "Lead", href: `/leads?lead=${contenu.leadId}` }] : []),
  ],
  async pertinente(contenu) {
    if (contenu.dossierId) {
      const d = await prisma.dossier.findUnique({ where: { id: contenu.dossierId }, select: { archiveLe: true, etape: true } });
      if (!d || d.archiveLe) return "le dossier n'existe plus (archivé)";
      if (contenu.cible === "PROJET" && !(await prisma.espaceClient.findFirst({ where: { dossierId: contenu.dossierId, archiveLe: null } }))) return `le dossier (${LIBELLES_ETAPE[d.etape as EtapeDossier] ?? d.etape}) n'a pas d'espace client : ouvre-le d'abord depuis le dossier`;
    }
    if (contenu.clientId) {
      const c = await prisma.client.findUnique({ where: { id: contenu.clientId }, select: { archiveLe: true, anonymiseLe: true } });
      if (!c || c.archiveLe || c.anonymiseLe) return "la fiche client n'est plus modifiable";
    }
    if (contenu.leadId) {
      const l = await prisma.lead.findUnique({ where: { id: contenu.leadId }, select: { archiveLe: true } });
      if (!l || l.archiveLe) return "le lead est archivé";
    }
    return null;
  },
  async executer(contenu) {
    const champ = champDe(contenu.cible, contenu.champ);
    if (!champ) throw new ErreurMetier(`Champ inconnu : ${contenu.champ}.`, 400);
    const libelle = contenu.libelle ?? champ.libelle;
    if (contenu.cible === "DOSSIER") {
      const dossierId = contenu.dossierId!;
      if (contenu.champ === "note") await noterRapidement({ dossierId, contenu: `${contenu.valeur}\n(mail : « ${contenu.passage.slice(0, 200)} »)` });
      else if (contenu.champ === "prestations") await enregistrerPrestations(dossierId, JSON.parse(contenu.valeur), "LUCAS");
      else if (contenu.champ === "photos") {
        const rangees = await rangerPiecesDansDossier(contenu.messageId);
        return { resultat: { photos: rangees.photos, documents: rangees.documents } };
      } else {
        const valeur = champ.nature === "nombre" ? lireNombre(contenu.valeur, libelle) : champ.nature === "jour" ? lireJour(contenu.valeur, libelle) : contenu.valeur;
        await modifierDossier(dossierId, { [contenu.champ]: valeur } as Parameters<typeof modifierDossier>[1]);
      }
      await recalculerMain(dossierId);
      return { resultat: { dossierId, champ: contenu.champ } };
    }
    if (contenu.cible === "PROJET") {
      const dossierId = contenu.dossierId!;
      const espace = await prisma.espaceClient.findFirst({ where: { dossierId, archiveLe: null }, orderBy: { createdAt: "desc" } });
      if (!espace) throw new ErreurMetier("Ce dossier n'a pas d'espace client : ouvre-le d'abord depuis le dossier.", 409);
      const entree = contenu.champ === "styles" ? { styles: lireListe(contenu.valeur) } : contenu.champ === "precisions" ? { precisions: contenu.valeur } : contenu.champ === "delai" ? { delai: contenu.valeur } : { metres: lireNombre(contenu.valeur, libelle) };
      await enregistrerProjet(espace, entree as Parameters<typeof enregistrerProjet>[1]);
      await recalculerMain(dossierId);
      return { resultat: { dossierId, champ: contenu.champ } };
    }
    if (contenu.cible === "CLIENT") {
      const clientId = contenu.clientId!;
      if (contenu.champ === "email" || contenu.champ === "telephone") await ajouterCoordonnee(clientId, contenu.champ, contenu.valeur, "Depuis un mail");
      else await modifierClient(clientId, { [contenu.champ]: contenu.valeur } as Parameters<typeof modifierClient>[1]);
      return { resultat: { clientId, champ: contenu.champ } };
    }
    const leadId = contenu.leadId!;
    await modifierEntrant(leadId, { [contenu.champ]: contenu.valeur } as Parameters<typeof modifierEntrant>[1]);
    return { resultat: { leadId, champ: contenu.champ } };
  },
});

/* ── Règle de tri proposée (gestes répétés, ou Claude) ─────────────── */

export const schemaRegle = z.object({
  cible: z.string().min(3).max(160).transform((v) => v.trim().toLowerCase()),
  action: z.enum(["RANGER", "NE_JAMAIS_RANGER", "ADMINISTRATIF"]),
  motif: z.string().min(2).max(300),
  gestes: z.number().int().min(0).max(1000).optional(),
  origine: z.enum(["GESTES", "ASSISTANT", "LUCAS"]).default("GESTES"),
});

export const propositionRegleTri = definirProposition({
  type: TYPE_REGLE_TRI,
  libelle: "Règle de tri des mails",
  schema: schemaRegle,
  sensible: false,
  validationGroupee: true,
  champs: [
    { cle: "action", libelle: "Décision", nature: "choix", options: [{ valeur: "RANGER", libelle: "Toujours ranger" }, { valeur: "ADMINISTRATIF", libelle: "Toujours en administratif" }, { valeur: "NE_JAMAIS_RANGER", libelle: "Ne jamais ranger" }] },
  ],
  motifsRejet: [{ code: "PAS_DE_REGLE", libelle: "Pas de règle pour cette adresse" }],
  execution: "FILE",
  liens: () => [{ libelle: "Règles (Paramètres → Mail)", href: "/parametres#mail" }],
  async pertinente(contenu) {
    const deja = await prisma.regleExpediteur.findFirst({ where: { cible: contenu.cible, action: contenu.action, archiveLe: null } });
    return deja ? "cette règle existe déjà" : null;
  },
  async executer(contenu, { decidePar }) {
    const { poserRegle } = await import("./boite");
    await poserRegle(contenu.cible, contenu.action, `${contenu.motif} (règle validée)`, decidePar.startsWith("ASSISTANT") ? "ASSISTANT" : "LUCAS", contenu.cible.startsWith("@"));
    return { resultat: { cible: contenu.cible, action: contenu.action } };
  },
});
