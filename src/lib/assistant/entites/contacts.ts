import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ajouterTache } from "@/lib/a-faire/reponses";
import { ajouterCoordonnee, archiverClient, archiverCoordonnee, creerClientManuel, definirPrincipale, enregistrerConsentement, modifierClient, modifierCoordonnee, restaurerClient, restaurerCoordonnee, schemaConsentement, schemaCreationClient, schemaModificationClient } from "@/lib/clients/fiches";
import { LIBELLES_STATUT_CONSENTEMENT } from "@/lib/clients/constantes";
import { creerNoteAppel, lireEtiquettes, modifierNoteAppel, schemaNoteAppel } from "@/lib/commercial/notes-appel";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { euros, pluriel } from "@/lib/commun/format";
import { archiverDossier, restaurerDossier } from "@/lib/dossiers/archivage";
import { CODES_COMPLETUDE, lireMasques, type CodeCompletude } from "@/lib/dossiers/completude";
import { ETAPES, LIBELLES_ETAPE, LIBELLES_MOTIF_PERTE, type EtapeDossier } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { ouvrirDossierDuLead } from "@/lib/dossiers/depuis-lead";
import { ajouterNote, creerDossier, masquerPointACompleter, modifierDateEvenement, modifierDossier, schemaCreation, schemaModification } from "@/lib/dossiers/dossiers";
import { schemaReprise, reprendreDossier } from "@/lib/dossiers/reprise";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { creerLeadDepuisMail } from "@/lib/mail/rattachement";
import { LIBELLES_STATUT_LEAD, TYPES_ECHANGE } from "@/lib/prospects/constantes";
import { creerContactAssistant, schemaCreationContact } from "@/lib/prospects/creation-assistant";
import { ajouterEchange, archiverEntrant, modifierEntrant, restaurerEntrant, schemaModificationEntrant } from "@/lib/prospects/entrants";
import { lireDateDictee } from "../agenda";
import { lien } from "../definition";
import { datesDictees, exigerId, resoudreContact, type DefinitionEntite, type Resolu, type Valeurs } from "./socle";

/**
 * Les contacts et leurs suites (mission 17, partie C) : lead, dossier (hors cœur, que porte `modifierDossierAssistant`),
 * client, coordonnée, consentement, note, note d'appel, tâche, reprise d'un dossier d'avant le CRM. Chaque écriture
 * passe par la fonction de service de l'écran, avec le schéma de sa route.
 */

type Objet = z.ZodObject<z.ZodRawShape>;
const objet = (schema: unknown) => schema as Objet;
const jour = (d: Date | null | undefined) => (d ? jourParis(d) : null);
const idDe = (cible: Resolu | null, cle: "dossierId" | "leadId" | "clientId") => (cible?.contexte[cle] as string | null | undefined) ?? null;

/* ── Lead ───────────────────────────────────────────────────────────── */

async function lireLead(cible: Resolu): Promise<Valeurs> {
  const l = await prisma.lead.findUniqueOrThrow({ where: { id: cible.id } });
  return {
    prenom: l.prenom,
    nomFamille: l.nom,
    telephone: l.telephone,
    email: l.email,
    ville: l.ville,
    codePostal: l.codePostal,
    typeProjet: l.typeProjet,
    notes: l.notes,
    statut: l.statut,
    motif: l.perteCommentaire,
    motifPerte: l.motifPerte,
    priorite: l.prioriteManuelle ? l.priorite : "AUTO",
    rappelLe: l.rappelLe?.toISOString() ?? null,
  };
}

export const LEAD: DefinitionEntite = {
  code: "LEAD",
  libelle: "le lead",
  designation: "id du lead, ou cible (leadId, nom)",
  resoudre: (r) => resoudreContact(r, "LEAD"),
  chemin: (c) => `/leads?lead=${c.id}`,
  modifier: {
    schema: objet(schemaModificationEntrant),
    libelles: { prenom: "le prénom", nomFamille: "le nom", telephone: "le téléphone", email: "l'e-mail", ville: "la ville", codePostal: "le code postal", typeProjet: "le type de projet", notes: "les notes", statut: "le statut", motif: "la précision de la perte", motifPerte: "le motif de perte", priorite: "la priorité de rappel", rappelLe: "le rappel" },
    texte: { statut: (v) => (typeof v === "string" ? (LIBELLES_STATUT_LEAD as Record<string, string>)[v] ?? v : "—"), motifPerte: (v) => (typeof v === "string" ? (LIBELLES_MOTIF_PERTE as Record<string, string>)[v] ?? v : "—"), priorite: (v) => (v === "AUTO" ? "calculée" : typeof v === "string" ? v.toLowerCase().replace(/_/g, " ") : "—") },
    // « Sans suite » : la perte compte (même règle que la tâche « client perdu »).
    sensible: (apres, avant) => apres.statut === "PERDU" && avant.statut !== "PERDU",
    pretraiter: (e, contexte) => {
      if (typeof e.rappelLe !== "string") return e;
      const texte = e.rappelLe.trim();
      const date = /^\d{4}-\d{2}-\d{2}T/.test(texte) ? new Date(texte) : lireDateDictee(texte, contexte.maintenant, 10);
      if (!date || Number.isNaN(date.getTime())) throw new ErreurMetier(`Date de rappel non comprise : « ${texte} ».`, 400);
      return { ...e, rappelLe: date.toISOString() };
    },
    lire: lireLead,
    appliquer: async (cible, valeurs) => modifierEntrant(cible.id, valeurs),
  },
  creer: {
    schema: schemaCreationContact.extend({ message_id: z.string().max(40).optional().describe("Un mail entrant : le lead est créé depuis son expéditeur (source mail).") }) as unknown as z.ZodType<Valeurs>,
    cles: "snake",
    apercu: async (e) => `Je vais créer le lead ${[e.prenom, e.nom].filter(Boolean).join(" ") || "(depuis le mail)"}.`,
    executer: async (e) => {
      if (typeof e.message_id === "string") {
        const r = await creerLeadDepuisMail(e.message_id, { notifier: false });
        return { texte: r.cree ? `Lead créé depuis le mail [lead:${r.leadId}].` : `Un lead existe déjà pour cette adresse : le mail lui est rattaché [lead:${r.leadId}].`, donnees: r, liens: [lien("Fiche du lead", `/leads?lead=${r.leadId}`)] };
      }
      const r = await creerContactAssistant(e as z.output<typeof schemaCreationContact>);
      if (!r.cree) {
        return {
          texte: `Rien n'a été créé : ${r.doublons.length > 1 ? "des fiches existent déjà" : "une fiche existe déjà"} pour ce contact.\n${r.doublons.map((d) => `- ${d.type === "CLIENT" ? "Client" : "Lead"} ${d.nom}${d.ville ? ` (${d.ville})` : ""} : ${d.motif} [${d.type.toLowerCase()}:${d.id}]`).join("\n")}\nSi Lucas confirme que c'est une autre personne, relance avec forcer: true.`,
          donnees: { cree: false, doublons: r.doublons },
        };
      }
      return { texte: `Lead créé : ${r.cree.nom || "sans nom"}${r.cree.dossierId ? ", dossier ouvert" : ", dans « À appeler »"} [lead:${r.cree.leadId}].`, donnees: { cree: true, ...r.cree }, liens: [lien("Fiche du lead", `/leads?lead=${r.cree.leadId}`)] };
    },
  },
  archiver: async (cible, motif) => archiverEntrant(cible.id, motif),
  restaurer: async (cible) => restaurerEntrant(cible.id),
};

/* ── Dossier (hors cœur : nom, source, ouverture, fiche client, points à compléter, date d'un passage) ── */

const schemaDossierSuite = objet(
  schemaModification
    .pick({ clientNom: true, source: true, ouvertLe: true, clientId: true })
    .extend({
      pointsMasques: z.array(z.enum(CODES_COMPLETUDE)).max(CODES_COMPLETUDE.length).optional(),
      pointsReaffiches: z.array(z.enum(CODES_COMPLETUDE)).max(CODES_COMPLETUDE.length).optional(),
      passage: z.object({ evenementId: z.string().min(1).max(40), survenuLe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.") }).optional(),
    })
);

export const DOSSIER: DefinitionEntite = {
  code: "DOSSIER",
  libelle: "le dossier",
  designation: "id du dossier, ou cible (dossierId, nom)",
  resoudre: (r) => resoudreContact(r, "DOSSIER"),
  chemin: (c) => `/dossiers?dossier=${c.id}`,
  modifier: {
    schema: schemaDossierSuite,
    libelles: { clientNom: "le nom du client", source: "la source", ouvertLe: "la date d'ouverture", clientId: "la fiche client", pointsMasques: "les points « à compléter » masqués", passage: "la date du passage d'étape" },
    texte: { passage: (v) => (v && typeof v === "object" ? `le ${(v as { survenuLe: string }).survenuLe}` : "—"), pointsMasques: (v) => (Array.isArray(v) && v.length ? v.join(", ") : "aucun") },
    sensible: ["clientId"],
    pretraiter: (e, contexte) => {
      const sortie = datesDictees(e, ["ouvertLe"], contexte.maintenant);
      if (sortie.passage && typeof sortie.passage === "object") sortie.passage = datesDictees(sortie.passage as Valeurs, ["survenuLe"], contexte.maintenant);
      return sortie;
    },
    lire: async (cible) => {
      const d = await prisma.dossier.findUniqueOrThrow({ where: { id: cible.id }, select: { clientNom: true, source: true, ouvertLe: true, createdAt: true, clientId: true, completudeMasquee: true } });
      return { clientNom: d.clientNom, source: d.source, ouvertLe: jour(d.ouvertLe ?? d.createdAt), clientId: d.clientId, pointsMasques: lireMasques(d.completudeMasquee).map((m) => m.code).sort() };
    },
    preparer: async (e, avant, cible) => {
      const apres: Valeurs = { ...e };
      if (e.pointsMasques || e.pointsReaffiches) {
        const set = new Set((avant.pointsMasques as string[]) ?? []);
        for (const c of (e.pointsMasques as string[]) ?? []) set.add(c);
        for (const c of (e.pointsReaffiches as string[]) ?? []) set.delete(c);
        apres.pointsMasques = [...set].sort();
        delete apres.pointsReaffiches;
      }
      if (e.passage) {
        const p = e.passage as { evenementId: string; survenuLe: string };
        const ev = await prisma.dossierEvenement.findFirst({ where: { id: p.evenementId, dossierId: cible.id }, select: { survenuLe: true, createdAt: true } });
        if (!ev) throw new ErreurMetier("Événement introuvable dans ce dossier.", 404);
        avant.passage = { evenementId: p.evenementId, survenuLe: jourParis(ev.survenuLe ?? ev.createdAt) };
      }
      if (e.clientId) {
        const c = await prisma.client.findUnique({ where: { id: e.clientId as string }, select: { nom: true } });
        if (!c) throw new ErreurMetier("Fiche client introuvable.", 404);
      }
      return apres;
    },
    appliquer: async (cible, valeurs) => {
      const { pointsMasques, passage, ...champs } = valeurs;
      if ("clientId" in champs && !champs.clientId) throw new ErreurMetier("Un dossier ne se détache pas de sa fiche client : rattache-le à la bonne fiche (client_id).", 409);
      if (Object.keys(champs).length) await modifierDossier(cible.id, champs);
      if (Array.isArray(pointsMasques)) {
        const d = await prisma.dossier.findUniqueOrThrow({ where: { id: cible.id }, select: { completudeMasquee: true } });
        const avant = new Set(lireMasques(d.completudeMasquee).map((m) => m.code));
        for (const code of CODES_COMPLETUDE) {
          const voulu = (pointsMasques as string[]).includes(code);
          if (voulu !== avant.has(code)) await masquerPointACompleter(cible.id, code as CodeCompletude, voulu);
        }
      }
      if (passage && typeof passage === "object") {
        const p = passage as { evenementId: string; survenuLe: string };
        await modifierDateEvenement(cible.id, p.evenementId, { survenuLe: p.survenuLe });
      }
    },
  },
  creer: {
    schema: objet(schemaCreation).partial({ clientNom: true }) as unknown as z.ZodType<Valeurs>,
    cible: "FACULTATIVE",
    pretraiter: (e, contexte) => datesDictees(e, ["prochaineActionDate", "dateChantier"], contexte.maintenant),
    sensible: (e) => typeof e.etape === "string" && ETAPES.indexOf(e.etape as EtapeDossier) >= ETAPES.indexOf("SIGNE") && e.etape !== "EN_PAUSE",
    apercu: async (e, cible) => `Je vais ouvrir un dossier${cible ? ` pour ${cible.nom}` : e.clientNom ? ` pour ${String(e.clientNom)}` : ""}${e.etape ? `, directement à l'étape « ${LIBELLES_ETAPE[e.etape as EtapeDossier]} »` : ""}${typeof e.montantEstime === "number" ? `, budget annoncé ${euros(e.montantEstime)}` : ""}.`,
    executer: async (e, cible) => {
      const leadId = (e.leadId as string | undefined) ?? idDe(cible, "leadId");
      const clientId = (e.clientId as string | undefined) ?? idDe(cible, "clientId");
      const autres = Object.keys(e).filter((k) => !["leadId", "clientId"].includes(k));
      // Depuis un lead, sans rien d'autre : l'ouverture qui reprend tout (coordonnées, projet, photos, simulations).
      if (leadId && autres.length === 0) {
        const o = await ouvrirDossierDuLead(leadId, { motif: "BOUTON" });
        return { texte: `Dossier ${o.cree ? "ouvert" : "retrouvé"}${cible ? ` pour ${cible.nom}` : ""}${o.photosRangees ? `, ${pluriel(o.photosRangees, "photo rangée", "photos rangées")}` : ""}${o.simulationsRangees ? `, ${pluriel(o.simulationsRangees, "simulation rangée", "simulations rangées")}` : ""} [dossier:${o.dossierId}]. Les photos s'ajoutent par « ajouter_fichier ».`, donnees: o, liens: [lien("Dossier", `/dossiers?dossier=${o.dossierId}`)] };
      }
      let clientNom = e.clientNom as string | undefined;
      if (!clientNom && leadId) {
        const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { prenom: true, nom: true } });
        clientNom = l ? `${l.prenom} ${l.nom}`.trim() : undefined;
      }
      if (!clientNom && clientId) clientNom = (await prisma.client.findUnique({ where: { id: clientId }, select: { nom: true } }))?.nom;
      const r = schemaCreation.safeParse({ ...e, clientNom, ...(leadId ? { leadId } : {}), ...(clientId && !leadId ? { clientId } : {}) });
      if (!r.success) throw new ErreurMetier(`Champs invalides : ${r.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; ")}.`, 400);
      const id = await creerDossier(r.data, []);
      return { texte: `Dossier ouvert pour ${r.data.clientNom}${r.data.etape ? ` à l'étape « ${LIBELLES_ETAPE[r.data.etape]} »` : ""} [dossier:${id}]. Les photos s'ajoutent par « ajouter_fichier ».`, donnees: { dossierId: id }, liens: [lien("Dossier", `/dossiers?dossier=${id}`)] };
    },
  },
  archiver: async (cible, motif) => {
    await archiverDossier(cible.id, motif);
  },
  restaurer: async (cible) => restaurerDossier(cible.id),
};

/* ── Client ─────────────────────────────────────────────────────────── */

const CHAMPS_CLIENT_VIDES = Object.fromEntries(Object.keys(schemaModificationClient.shape).filter((cle) => !["categorie", "premierContactLe"].includes(cle)).map((cle) => [cle, null]));

export const CLIENT: DefinitionEntite = {
  code: "CLIENT",
  libelle: "la fiche client",
  designation: "id du client, ou cible (clientId, nom)",
  resoudre: (r) => resoudreContact(r, "CLIENT"),
  chemin: (c) => `/clients/${c.id}`,
  modifier: {
    schema: objet(schemaModificationClient),
    libelles: { categorie: "la catégorie", prenom: "le prénom", nomFamille: "le nom", raisonSociale: "la raison sociale", siret: "le SIRET", adresse: "l'adresse", codePostal: "le code postal", ville: "la ville", source: "la source", sourceDetail: "la précision de la source", campagne: "la campagne", publicite: "la publicité", formulaire: "le formulaire", premierContactLe: "le premier contact", recommandeParId: "le client recommandeur", recommandeParTexte: "la recommandation", notes: "le passif" },
    pretraiter: (e, contexte) => datesDictees(e, ["premierContactLe"], contexte.maintenant),
    lire: async (cible) => {
      const c = await prisma.client.findUniqueOrThrow({ where: { id: cible.id } });
      return { categorie: c.categorie, prenom: c.prenom, nomFamille: c.nomFamille, raisonSociale: c.raisonSociale, siret: c.siret, adresse: c.adresse, codePostal: c.codePostal, ville: c.ville, source: c.source, sourceDetail: c.sourceDetail, campagne: c.campagne, publicite: c.publicite, formulaire: c.formulaire, premierContactLe: jour(c.premierContactLe), recommandeParId: c.recommandeParId, recommandeParTexte: c.recommandeParTexte, notes: c.notes };
    },
    appliquer: async (cible, valeurs) => modifierClient(cible.id, valeurs),
  },
  creer: {
    schema: schemaCreationClient as unknown as z.ZodType<Valeurs>,
    // L'écran envoie toujours la fiche entière (champs vides à null) ; la catégorie par défaut est celle de « Nouveau client ».
    pretraiter: (e, contexte) => datesDictees({ ...CHAMPS_CLIENT_VIDES, categorie: "PARTICULIER", ...e }, ["premierContactLe"], contexte.maintenant),
    apercu: async (e) => `Je vais créer la fiche client ${String(e.raisonSociale ?? [e.prenom, e.nomFamille].filter(Boolean).join(" "))}.`,
    executer: async (e) => {
      try {
        const r = await creerClientManuel(e as z.output<typeof schemaCreationClient>);
        return { texte: `Fiche client créée [client:${r.id}].${r.avertissements.length ? ` ${r.avertissements.join(" ")}` : ""}`, donnees: r, liens: [lien("Fiche client", `/clients/${r.id}`)] };
      } catch (erreur) {
        if (erreur instanceof ErreurMetier && erreur.status === 409 && erreur.details?.clientExistantId) {
          return { texte: `Rien n'a été créé : ${erreur.message} [client:${String(erreur.details.clientExistantId)}]. Si Lucas confirme que c'est une autre fiche, relance avec forcer: true.`, donnees: { cree: false, candidats: [{ id: erreur.details.clientExistantId }] } };
        }
        throw erreur;
      }
    },
  },
  archiver: async (cible, motif) => archiverClient(cible.id, motif),
  restaurer: async (cible) => restaurerClient(cible.id),
};

/* ── Coordonnée d'une fiche client ─────────────────────────────────── */

type Nature = "email" | "telephone";
type Principale = { id: string; valeur: string } | null;

async function principaleDe(clientId: string, nature: Nature): Promise<Principale> {
  if (nature === "email") {
    const p = await prisma.clientEmail.findFirst({ where: { clientId, principale: true }, select: { id: true, adresse: true } });
    return p ? { id: p.id, valeur: p.adresse } : null;
  }
  const p = await prisma.clientTelephone.findFirst({ where: { clientId, principal: true }, select: { id: true, numero: true } });
  return p ? { id: p.id, valeur: p.numero } : null;
}

export const COORDONNEE: DefinitionEntite = {
  code: "COORDONNEE",
  libelle: "la coordonnée",
  designation: "id de l'adresse e-mail ou du numéro (rendu par « lire_fiche » du client)",
  resoudre: async (r) => {
    const id = exigerId(r, "la coordonnée", "« lire_fiche » (coordonnées du client)");
    const email = await prisma.clientEmail.findFirst({ where: { ...AVEC_ARCHIVES, id }, include: { client: { select: { nom: true } } } });
    if (email) return { id, nom: `l'e-mail ${email.adresse} de ${email.client.nom}`, archive: Boolean(email.archiveLe), contexte: { clientId: email.clientId, nature: "email" } };
    const tel = await prisma.clientTelephone.findFirst({ where: { ...AVEC_ARCHIVES, id }, include: { client: { select: { nom: true } } } });
    if (tel) return { id, nom: `le numéro ${tel.numero} de ${tel.client.nom}`, archive: Boolean(tel.archiveLe), contexte: { clientId: tel.clientId, nature: "telephone" } };
    throw new ErreurMetier(`Coordonnée introuvable : ${id}.`, 404);
  },
  chemin: (c) => `/clients/${String(c.contexte.clientId)}`,
  modifier: {
    schema: objet(z.object({ valeur: z.string().trim().min(1, "Valeur manquante.").max(160).optional(), libelle: z.string().trim().max(40, "Libellé trop long.").nullable().optional(), principale: z.literal(true).optional() })),
    libelles: { valeur: "la valeur", libelle: "le libellé", principale: "la coordonnée principale" },
    texte: { principale: (v) => ((v as Principale)?.valeur ?? "aucune") },
    lire: async (cible) => {
      const nature = cible.contexte.nature as Nature;
      const ligne = nature === "email" ? await prisma.clientEmail.findFirstOrThrow({ where: { ...AVEC_ARCHIVES, id: cible.id } }).then((l) => ({ valeur: l.adresse, libelle: l.libelle })) : await prisma.clientTelephone.findFirstOrThrow({ where: { ...AVEC_ARCHIVES, id: cible.id } }).then((l) => ({ valeur: l.numero, libelle: l.libelle }));
      return { ...ligne, principale: await principaleDe(cible.contexte.clientId as string, nature) };
    },
    preparer: (e, avant, cible) => (e.principale === true ? { ...e, principale: { id: cible.id, valeur: (e.valeur as string | undefined) ?? (avant.valeur as string) } } : e),
    appliquer: async (cible, valeurs) => {
      const clientId = cible.contexte.clientId as string;
      const nature = cible.contexte.nature as Nature;
      if (valeurs.valeur !== undefined || valeurs.libelle !== undefined) await modifierCoordonnee(clientId, nature, cible.id, { ...(valeurs.valeur !== undefined ? { valeur: valeurs.valeur as string } : {}), ...(valeurs.libelle !== undefined ? { libelle: valeurs.libelle as string | null } : {}) });
      if (valeurs.principale && typeof valeurs.principale === "object") await definirPrincipale(clientId, nature, (valeurs.principale as { id: string }).id);
    },
  },
  creer: {
    schema: z.object({ nature: z.enum(["email", "telephone"], "Type de coordonnée invalide."), valeur: z.string("Valeur manquante.").trim().min(1, "Valeur manquante.").max(160), libelle: z.string().trim().max(40, "Libellé trop long.").nullable().optional() }) as unknown as z.ZodType<Valeurs>,
    cible: "EXIGEE",
    typeCible: "CLIENT",
    apercu: async (e, cible) => `Je vais ajouter ${e.nature === "email" ? "l'adresse" : "le numéro"} ${String(e.valeur)} à la fiche de ${cible?.nom}.`,
    executer: async (e, cible) => {
      const clientId = idDe(cible, "clientId");
      if (!clientId) throw new ErreurMetier(`${cible?.nom ?? "Ce contact"} n'a pas de fiche client.`, 409);
      await ajouterCoordonnee(clientId, e.nature as Nature, e.valeur as string, (e.libelle as string | null | undefined) || null);
      return { texte: `${e.nature === "email" ? "Adresse" : "Numéro"} ${String(e.valeur)} ajouté${e.nature === "email" ? "e" : ""} à la fiche de ${cible?.nom}.`, liens: [lien("Fiche client", `/clients/${clientId}`)] };
    },
  },
  archiver: async (cible, motif) => archiverCoordonnee(cible.contexte.clientId as string, cible.contexte.nature as Nature, cible.id, motif),
  restaurer: async (cible) => restaurerCoordonnee(cible.contexte.clientId as string, cible.contexte.nature as Nature, cible.id),
};

/* ── Consentement aux mails commerciaux ────────────────────────────── */

export const CONSENTEMENT: DefinitionEntite = {
  code: "CONSENTEMENT",
  libelle: "le consentement",
  designation: "cible : le client",
  creer: {
    schema: schemaConsentement as unknown as z.ZodType<Valeurs>,
    cible: "EXIGEE",
    typeCible: "CLIENT",
    pretraiter: (e, contexte) => datesDictees({ recueilliLe: jourParis(contexte.maintenant), ...e }, ["recueilliLe"], contexte.maintenant),
    apercu: async (e, cible) => `Je vais noter la réponse de ${cible?.nom} aux mails commerciaux : ${(LIBELLES_STATUT_CONSENTEMENT as Record<string, string>)[e.statut as string] ?? e.statut} (${String(e.moyen)}, le ${String(e.recueilliLe)}).`,
    executer: async (e, cible) => {
      const clientId = idDe(cible, "clientId");
      if (!clientId) throw new ErreurMetier(`${cible?.nom ?? "Ce contact"} n'a pas de fiche client.`, 409);
      await enregistrerConsentement(clientId, e as z.output<typeof schemaConsentement>);
      return { texte: `Consentement noté pour ${cible?.nom} : ${(LIBELLES_STATUT_CONSENTEMENT as Record<string, string>)[e.statut as string] ?? e.statut}, le ${String(e.recueilliLe)} (historisé ; la déclaration la plus récente fait foi).`, liens: [lien("Fiche client", `/clients/${clientId}`)] };
    },
  },
};

/* ── Note (dossier, ou échange typé d'un lead sans dossier) ─────────── */

export const NOTE: DefinitionEntite = {
  code: "NOTE",
  libelle: "la note",
  designation: "cible : le dossier (note à une étape) ou le lead sans dossier (échange typé)",
  creer: {
    schema: z.object({ texte: z.string().trim().min(1, "La note est vide.").max(4000), etape: z.enum(ETAPES).optional().describe("Dossier : l'étape de la note (l'étape courante par défaut)."), type: z.enum(TYPES_ECHANGE).optional().describe("Lead sans dossier : APPEL, SMS, EMAIL ou NOTE (défaut).") }) as unknown as z.ZodType<Valeurs>,
    cible: "EXIGEE",
    apercu: async (e, cible) => `Je vais noter sur ${cible?.nom} : « ${String(e.texte).slice(0, 120)} ».`,
    executer: async (e, cible) => {
      const dossierId = idDe(cible, "dossierId");
      if (dossierId) {
        const d = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { etape: true } });
        const etape = (e.etape as EtapeDossier | undefined) ?? (d.etape as EtapeDossier);
        const note = await ajouterNote(dossierId, { etape, contenu: e.texte as string });
        return { texte: `Note ajoutée au dossier de ${cible?.nom}, étape « ${LIBELLES_ETAPE[etape]} ».`, donnees: { note }, liens: [lien("Dossier", `/dossiers?dossier=${dossierId}`)] };
      }
      const leadId = idDe(cible, "leadId");
      if (!leadId) throw new ErreurMetier(`${cible?.nom ?? "Ce contact"} n'a ni dossier ni lead : une note se pose sur l'un ou l'autre.`, 409);
      const type = (e.type as (typeof TYPES_ECHANGE)[number] | undefined) ?? "NOTE";
      await ajouterEchange(leadId, { type, contenu: e.texte as string });
      return { texte: `${type === "NOTE" ? "Note" : `Échange (${type.toLowerCase()})`} noté sur la fiche de ${cible?.nom}.`, liens: [lien("Lead", `/leads?lead=${leadId}`)] };
    },
  },
};

/* ── Note d'appel ───────────────────────────────────────────────────── */

export const NOTE_APPEL: DefinitionEntite = {
  code: "NOTE_APPEL",
  libelle: "la note d'appel",
  designation: "id de la note d'appel (rendu par « lire_fiche » du lead)",
  resoudre: async (r) => {
    const id = exigerId(r, "la note d'appel", "« lire_fiche » (notes d'appel)");
    const note = await prisma.noteAppel.findUnique({ where: { id }, include: { lead: { select: { prenom: true, nom: true } } } });
    if (!note) throw new ErreurMetier(`Note d'appel introuvable : ${id}.`, 404);
    return { id, nom: `la note d'appel de ${`${note.lead.prenom} ${note.lead.nom}`.trim()}`, archive: Boolean(note.archiveLe), contexte: { leadId: note.leadId } };
  },
  chemin: (c) => `/leads?lead=${String(c.contexte.leadId)}`,
  modifier: {
    schema: objet(schemaNoteAppel.pick({ texte: true, etiquettes: true })),
    libelles: { texte: "le texte", etiquettes: "les étiquettes" },
    lire: async (cible) => {
      const n = await prisma.noteAppel.findUniqueOrThrow({ where: { id: cible.id } });
      return { texte: n.texte, etiquettes: lireEtiquettes(n.etiquettes) };
    },
    appliquer: async (cible, valeurs) => {
      await modifierNoteAppel(cible.contexte.leadId as string, cible.id, valeurs);
    },
  },
  creer: {
    schema: schemaNoteAppel as unknown as z.ZodType<Valeurs>,
    cible: "EXIGEE",
    typeCible: "LEAD",
    apercu: async (_e, cible) => `Je vais ajouter une note d'appel sur ${cible?.nom}.`,
    executer: async (e, cible) => {
      const leadId = idDe(cible, "leadId");
      if (!leadId) throw new ErreurMetier(`${cible?.nom ?? "Ce contact"} n'a pas de lead : une note d'appel vit sur le lead.`, 409);
      const note = await creerNoteAppel(leadId, e);
      return { texte: `Note d'appel ajoutée sur ${cible?.nom} (sans issue ; pour un appel avec issue : « noter_appel ») [note_appel:${note.id}].`, donnees: { note }, liens: [lien("Lead", `/leads?lead=${leadId}`)] };
    },
  },
};

/* ── Tâche de Lucas ─────────────────────────────────────────────────── */

export const TACHE: DefinitionEntite = {
  code: "TACHE",
  libelle: "la tâche",
  designation: "cible facultative : le dossier ou le contact concerné",
  creer: {
    schema: z.object({ titre: z.string().trim().min(2).max(200), quand: z.string().max(60).optional().describe("Échéance dictée : « jeudi », « le 12 »."), raison: z.string().max(300).optional() }) as unknown as z.ZodType<Valeurs>,
    cible: "FACULTATIVE",
    apercu: async (e, cible) => `Je vais ajouter la tâche « ${String(e.titre)} »${cible ? ` (${cible.nom})` : ""}.`,
    executer: async (e, cible, contexte) => {
      let echeance: Date | null = null;
      if (typeof e.quand === "string" && e.quand.trim()) {
        echeance = lireDateDictee(e.quand, contexte.maintenant, 9);
        if (!echeance) throw new ErreurMetier(`Je ne comprends pas la date « ${e.quand} ».`, 400);
      }
      const dossierId = idDe(cible, "dossierId");
      const leadId = idDe(cible, "leadId");
      const clientId = idDe(cible, "clientId");
      const v = await ajouterTache({ titre: e.titre as string, ...(echeance ? { echeance: echeance.toISOString() } : {}), ...(dossierId ? { dossierId } : leadId ? { leadId } : clientId ? { clientId } : {}), ...(typeof e.raison === "string" && e.raison.trim() ? { raison: e.raison.trim() } : {}) }, contexte.maintenant);
      return { texte: `Tâche ajoutée : « ${v.titre} »${cible ? ` (${cible.nom})` : ""} [tache:${v.id}].`, donnees: { tache: v }, liens: [lien("Tâches", "/taches")] };
    },
  },
};

/* ── Reprise d'un dossier commencé avant le CRM ─────────────────────── */

export const REPRISE: DefinitionEntite = {
  code: "REPRISE",
  libelle: "la reprise",
  designation: "champs : dossier {…}, etape, dates {ouvert_le, jalons, etape_depuis_le, date_chantier}, documents [...], paiements [...]",
  creer: {
    schema: schemaReprise as unknown as z.ZodType<Valeurs>,
    sensible: () => true,
    apercu: async (e) => {
      const d = e.dossier as { clientNom?: string };
      const documents = (e.documents as { type: string; numero: string; montant: number }[]) ?? [];
      const paiements = (e.paiements as { montant: number }[]) ?? [];
      return `Je vais reprendre le dossier de ${d.clientNom ?? "?"} à l'étape « ${LIBELLES_ETAPE[e.etape as EtapeDossier] ?? e.etape} »${documents.length ? `, avec ${documents.map((x) => `${x.type.toLowerCase()} ${x.numero} (${euros(x.montant)})`).join(", ")}` : ""}${paiements.length ? ` et ${pluriel(paiements.length, "paiement")} (${euros(paiements.reduce((s, p) => s + p.montant, 0))})` : ""}. Les PDF s'ajoutent ensuite par « ajouter_fichier ».`;
    },
    executer: async (e) => {
      const r = await reprendreDossier(e as z.output<typeof schemaReprise>);
      return { texte: `Dossier repris [dossier:${r.id}]${r.documents.length ? `, ${pluriel(r.documents.length, "document")} rattaché${r.documents.length > 1 ? "s" : ""}` : ""}.${r.avertissements.length ? ` ${r.avertissements.join(" ")}` : ""}`, donnees: r, liens: [lien("Dossier", `/dossiers?dossier=${r.id}`)] };
    },
  },
};

export const ENTITES_CONTACTS = [LEAD, DOSSIER, CLIENT, COORDONNEE, CONSENTEMENT, NOTE, NOTE_APPEL, TACHE, REPRISE];
