import type { Client, Lead, Prospect } from "@prisma/client";
import prisma, { type Transaction } from "@/lib/prisma";
import type { CategorieClient, MoyenConsentement, SourceClient } from "./constantes";
import {
  categorieDepuisDossier,
  categorieDepuisLead,
  lireNotesAcquisition,
  nomAffichage,
  normaliserEmail,
  normaliserTelephone,
  sourceDepuisDossier,
  sourceDepuisLead,
} from "./normalisation";

type Client_ = Transaction | typeof prisma;

/**
 * Retrouver un client, créer un client : un seul endroit pour les webhooks, la
 * création de dossier et la reprise des données.
 *
 * Règle : une adresse e-mail ou un numéro identiques (une fois normalisés)
 * désignent le même client — c'est déjà ainsi que les webhooks dédoublonnaient
 * les leads. Tout rapprochement plus flou (même nom, même ville…) n'est
 * jamais appliqué : il devient une proposition de fusion (src/lib/clients/doublons.ts).
 */
export async function trouverClientParCoordonnees(
  coordonnees: { emails?: (string | null | undefined)[]; telephones?: (string | null | undefined)[] },
  client: Client_ = prisma
): Promise<Client | null> {
  const adresses = [...new Set((coordonnees.emails ?? []).map(normaliserEmail).filter((valeur): valeur is string => !!valeur))];
  const numeros = [
    ...new Set((coordonnees.telephones ?? []).map(normaliserTelephone).filter((valeur): valeur is string => !!valeur)),
  ];
  if (adresses.length === 0 && numeros.length === 0) return null;

  const [parEmail, parTelephone] = await Promise.all([
    adresses.length ? client.clientEmail.findMany({ where: { adresse: { in: adresses } }, select: { clientId: true } }) : [],
    numeros.length ? client.clientTelephone.findMany({ where: { numero: { in: numeros } }, select: { clientId: true } }) : [],
  ]);
  const idsEmail = new Set(parEmail.map((ligne) => ligne.clientId));
  const idsTelephone = new Set(parTelephone.map((ligne) => ligne.clientId));
  const ids = [...new Set([...idsEmail, ...idsTelephone])];
  if (ids.length === 0) return null;

  const candidats = await client.client.findMany({ where: { id: { in: ids } }, orderBy: { updatedAt: "desc" } });
  if (candidats.length <= 1) return candidats[0] ?? null;
  // Plusieurs clients : celui qui a l'adresse ET le numéro, sinon le plus récent.
  // La paire reste signalée par la détection des doublons.
  return candidats.find((candidat) => idsEmail.has(candidat.id) && idsTelephone.has(candidat.id)) ?? candidats[0];
}

/** Ajoute au client les coordonnées qu'il n'a pas encore (jamais de retrait). */
export async function completerCoordonnees(
  client: Client_,
  clientId: string,
  coordonnees: { emails?: (string | null | undefined)[]; telephones?: (string | null | undefined)[] }
): Promise<void> {
  const [emails, telephones] = await Promise.all([
    client.clientEmail.findMany({ where: { clientId }, select: { adresse: true } }),
    client.clientTelephone.findMany({ where: { clientId }, select: { numero: true } }),
  ]);
  const adressesConnues = new Set(emails.map((ligne) => ligne.adresse));
  const numerosConnus = new Set(telephones.map((ligne) => ligne.numero));

  for (const saisie of coordonnees.emails ?? []) {
    const adresse = normaliserEmail(saisie);
    if (!adresse || adressesConnues.has(adresse)) continue;
    await client.clientEmail.create({ data: { clientId, adresse, principale: adressesConnues.size === 0 } });
    adressesConnues.add(adresse);
  }
  for (const saisie of coordonnees.telephones ?? []) {
    const numero = normaliserTelephone(saisie);
    if (!numero || numerosConnus.has(numero)) continue;
    await client.clientTelephone.create({
      data: { clientId, numero, saisi: (saisie ?? "").trim().slice(0, 40), principal: numerosConnus.size === 0 },
    });
    numerosConnus.add(numero);
  }
}

export type NouveauClient = {
  categorie: CategorieClient;
  prenom?: string | null;
  nomFamille?: string | null;
  raisonSociale?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  source: SourceClient;
  sourceDetail?: string | null;
  campagne?: string | null;
  publicite?: string | null;
  formulaire?: string | null;
  premierContactLe: Date;
  emails?: (string | null | undefined)[];
  telephones?: (string | null | undefined)[];
  /** Nom d'affichage de secours quand ni prénom, ni nom, ni raison sociale ne sont connus. */
  nomSecours?: string;
};

const VILLES_INCONNUES = new Set(["", "non renseignée", "non renseigne", "inconnue"]);

function villeUtile(ville: string | null | undefined): string | null {
  const nettoyee = (ville ?? "").trim();
  return VILLES_INCONNUES.has(nettoyee.toLowerCase()) ? null : nettoyee;
}

export async function creerClient(client: Client_, nouveau: NouveauClient): Promise<Client> {
  const nom =
    nomAffichage(nouveau) ??
    nouveau.nomSecours ??
    normaliserEmail(nouveau.emails?.find(Boolean)) ??
    (nouveau.telephones?.find(Boolean) ? `Contact ${nouveau.telephones.find(Boolean)}` : "Contact sans nom");
  const cree = await client.client.create({
    data: {
      categorie: nouveau.categorie,
      nom: nom.slice(0, 160),
      prenom: nouveau.prenom?.trim() || null,
      nomFamille: nouveau.nomFamille?.trim() || null,
      raisonSociale: nouveau.raisonSociale?.trim() || null,
      adresse: nouveau.adresse?.trim() || null,
      codePostal: nouveau.codePostal?.trim() || null,
      ville: villeUtile(nouveau.ville),
      source: nouveau.source,
      sourceDetail: nouveau.sourceDetail ?? null,
      campagne: nouveau.campagne ?? null,
      publicite: nouveau.publicite ?? null,
      formulaire: nouveau.formulaire ?? null,
      premierContactLe: nouveau.premierContactLe,
    },
  });
  await completerCoordonnees(client, cree.id, { emails: nouveau.emails, telephones: nouveau.telephones });
  return cree;
}

/** Acquisition d'un lead : ses champs, à défaut ce qu'en disaient ses notes. */
export function acquisitionDuLead(lead: Pick<Lead, "campagne" | "publicite" | "formulaire" | "metaLeadgenId" | "notes">) {
  const notes = lireNotesAcquisition(lead.notes);
  return {
    campagne: lead.campagne ?? notes.campagne ?? null,
    publicite: lead.publicite ?? notes.publicite ?? null,
    formulaire: lead.formulaire ?? notes.formulaire ?? null,
    metaLeadgenId: lead.metaLeadgenId ?? notes.metaLeadgenId ?? null,
  };
}

export type ConsentementRecu = {
  accorde: boolean;
  moyen: MoyenConsentement;
  recueilliLe: Date;
  preuve?: string | null;
};

export type OptionsRattachement = {
  /**
   * Chercher un client existant par e-mail ou téléphone (défaut : oui). La
   * reprise des données existantes ne cherche pas : elle crée une fiche par
   * lead et laisse la détection des doublons proposer les fusions.
   */
  rechercherExistant?: boolean;
};

/**
 * Rattache un lead à son client (retrouvé par e-mail ou téléphone, sinon créé)
 * et rend l'identifiant du client. Sans effet si le lead est déjà rattaché.
 */
export async function rattacherLead(
  client: Client_,
  leadId: string,
  consentement?: ConsentementRecu | null,
  options: OptionsRattachement = {}
): Promise<string> {
  const lead = await client.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error(`Lead ${leadId} introuvable`);
  const acquisition = acquisitionDuLead(lead);

  let clientId = lead.clientId;
  if (!clientId) {
    const existant =
      options.rechercherExistant === false
        ? null
        : await trouverClientParCoordonnees({ emails: [lead.email], telephones: [lead.telephone] }, client);
    if (existant) {
      clientId = existant.id;
      await completerCoordonnees(client, clientId, { emails: [lead.email], telephones: [lead.telephone] });
    } else {
      const { source, sourceDetail } = sourceDepuisLead(lead.source);
      const cree = await creerClient(client, {
        categorie: categorieDepuisLead(lead.typeProjet),
        prenom: lead.prenom,
        nomFamille: lead.nom,
        ville: lead.ville,
        codePostal: lead.codePostal,
        source,
        sourceDetail,
        campagne: acquisition.campagne,
        publicite: acquisition.publicite,
        formulaire: acquisition.formulaire,
        premierContactLe: lead.createdAt,
        emails: [lead.email],
        telephones: [lead.telephone],
      });
      clientId = cree.id;
    }
  }

  await client.lead.update({
    where: { id: lead.id },
    data: {
      clientId,
      campagne: acquisition.campagne,
      publicite: acquisition.publicite,
      formulaire: acquisition.formulaire,
      metaLeadgenId: acquisition.metaLeadgenId,
    },
  });
  if (consentement) {
    await client.consentementMail.create({
      data: {
        clientId,
        statut: consentement.accorde ? "ACCORDE" : "REFUSE",
        moyen: consentement.moyen,
        recueilliLe: consentement.recueilliLe,
        preuve: consentement.preuve?.slice(0, 1000) ?? null,
      },
    });
  }
  return clientId;
}

/** Client d'un prospect B2B converti (créé à la conversion seulement). */
export async function rattacherProspect(
  client: Client_,
  prospect: Prospect,
  options: OptionsRattachement = {}
): Promise<string> {
  if (prospect.clientId) return prospect.clientId;
  const existant =
    options.rechercherExistant === false
      ? null
      : await trouverClientParCoordonnees({ emails: [prospect.email], telephones: [prospect.telephone] }, client);
  const clientId =
    existant?.id ??
    (
      await creerClient(client, {
        categorie: "PROFESSIONNEL",
        raisonSociale: prospect.nom,
        adresse: prospect.adresse,
        codePostal: prospect.codePostal,
        ville: prospect.ville,
        source: "PROSPECTION",
        premierContactLe: prospect.createdAt,
        emails: [prospect.email],
        telephones: [prospect.telephone],
      })
    ).id;
  if (existant) await completerCoordonnees(client, clientId, { emails: [prospect.email], telephones: [prospect.telephone] });
  if (prospect.siret) {
    await client.client.updateMany({ where: { id: clientId, siret: null }, data: { siret: prospect.siret } });
  }
  await client.prospect.update({ where: { id: prospect.id }, data: { clientId } });
  return clientId;
}

type DossierPourClient = {
  id: string;
  leadId: string | null;
  prospectId: string | null;
  clientId: string | null;
  clientNom: string;
  clientAdresse: string;
  clientCp: string;
  clientVille: string;
  clientEmail: string | null;
  clientTelephone: string;
  source: string;
  createdAt: Date;
};

/** Client d'un dossier : celui de son lead ou de son prospect, sinon retrouvé ou créé depuis ses coordonnées. */
export async function rattacherDossier(
  client: Client_,
  dossier: DossierPourClient,
  options: OptionsRattachement = {}
): Promise<string> {
  if (dossier.clientId) return dossier.clientId;
  let clientId: string | null = null;
  if (dossier.leadId) {
    clientId = await rattacherLead(client, dossier.leadId, null, options);
  } else if (dossier.prospectId) {
    const prospect = await client.prospect.findUnique({ where: { id: dossier.prospectId } });
    if (prospect) clientId = await rattacherProspect(client, prospect, options);
  }
  const coordonnees = { emails: [dossier.clientEmail], telephones: [dossier.clientTelephone] };
  if (!clientId && options.rechercherExistant !== false) {
    const existant = await trouverClientParCoordonnees(coordonnees, client);
    clientId = existant?.id ?? null;
  }
  if (!clientId) {
    const { source, sourceDetail } = sourceDepuisDossier(dossier.source);
    const categorie = categorieDepuisDossier(dossier.source);
    const cree = await creerClient(client, {
      categorie,
      raisonSociale: categorie === "PARTICULIER" ? null : dossier.clientNom,
      nomSecours: dossier.clientNom,
      adresse: dossier.clientAdresse,
      codePostal: dossier.clientCp,
      ville: dossier.clientVille,
      source,
      sourceDetail,
      premierContactLe: dossier.createdAt,
      ...coordonnees,
    });
    clientId = cree.id;
  } else {
    await completerCoordonnees(client, clientId, coordonnees);
    // L'adresse du premier chantier sert d'adresse au client qui n'en a pas.
    await client.client.updateMany({
      where: { id: clientId, adresse: null },
      data: { adresse: dossier.clientAdresse, codePostal: dossier.clientCp, ville: dossier.clientVille },
    });
  }
  await client.dossier.update({ where: { id: dossier.id }, data: { clientId } });
  return clientId;
}
