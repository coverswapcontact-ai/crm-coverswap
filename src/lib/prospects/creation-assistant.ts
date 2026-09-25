import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { trouverClientParCoordonnees } from "@/lib/clients/identification";
import { normaliserEmail, normaliserTelephone } from "@/lib/clients/normalisation";
import { ouvrirDossierDuLead } from "@/lib/dossiers/depuis-lead";
import { nomNormalise, villeNormalisee } from "./doublons";
import { creerEntrant, schemaCreationEntrant } from "./entrants";
import { SOURCES_LEAD, TYPES_PROJET } from "./constantes";

/**
 * « creer_contact » (mission 11) : un lead ou un client de zéro, dicté à
 * l'assistant — avec le rapprochement anti-doublon AVANT d'écrire : un numéro
 * ou une adresse déjà connus (client ou lead vivant), ou le même nom dans la
 * même ville, arrêtent la création et rendent la fiche existante. « forcer »
 * passe outre, en connaissance de cause.
 */

export const schemaCreationContact = z.object({
  prenom: z.string().trim().max(80).optional(),
  nom: z.string().trim().max(120).optional(),
  telephone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
  ville: z.string().trim().max(80).optional(),
  code_postal: z.string().trim().max(10).optional(),
  source: z.enum(SOURCES_LEAD).optional().describe("D'où vient le contact : SITE_DEVIS, META_ADS, BOUCHE_A_OREILLE, APPEL, AUTRE… (AUTRE par défaut)."),
  type_projet: z.enum(TYPES_PROJET).optional().describe("CUISINE par défaut."),
  projet: z.string().trim().max(5000).optional().describe("Le projet en quelques mots (notes de la fiche)."),
  ouvrir_dossier: z.boolean().optional().describe("Vrai : ouvre aussi le dossier du projet."),
  forcer: z.boolean().optional().describe("Vrai : créer malgré un doublon probable (après l'avoir dit à Lucas)."),
});
export type EntreeCreationContact = z.output<typeof schemaCreationContact>;

export type Doublon = { type: "CLIENT" | "LEAD"; id: string; nom: string; ville: string | null; motif: string; clientId: string | null };

const memeNom = (a: string, b: string) => a.length > 0 && a === b;

/** Les fiches qui ressemblent à ce contact : coordonnées identiques (sûr), ou même nom et même ville (probable). */
export async function reperDoublonsContact(entree: EntreeCreationContact): Promise<Doublon[]> {
  const doublons: Doublon[] = [];
  const telephone = normaliserTelephone(entree.telephone);
  const email = normaliserEmail(entree.email);
  const client = await trouverClientParCoordonnees({ emails: [email], telephones: [telephone] });
  if (client) doublons.push({ type: "CLIENT", id: client.id, nom: client.nom || "client", ville: client.ville ?? null, motif: telephone && email ? "même numéro ou même e-mail" : telephone ? "même numéro de téléphone" : "même adresse e-mail", clientId: client.id });
  const nom = nomNormalise(entree.prenom, entree.nom);
  const ville = villeNormalisee(entree.ville);
  // Une fiche client au même nom (et même ville, quand les deux sont connues) : probable, jamais appliqué seul.
  if (nom) {
    const clients = await prisma.client.findMany({ where: { archiveLe: null, ...(client ? { id: { not: client.id } } : {}) }, select: { id: true, nom: true, prenom: true, ville: true }, orderBy: { updatedAt: "desc" }, take: 2000 });
    for (const c of clients) {
      const nomClient = nomNormalise(c.prenom && !c.nom.toLowerCase().includes(c.prenom.toLowerCase()) ? c.prenom : "", c.nom);
      if (!memeNom(nom, nomClient) || (ville && c.ville && villeNormalisee(c.ville) !== ville)) continue;
      doublons.push({ type: "CLIENT", id: c.id, nom: c.nom, ville: c.ville ?? null, motif: ville && c.ville ? "même nom, même ville" : "même nom", clientId: c.id });
      if (doublons.length >= 5) break;
    }
  }
  const leads = await prisma.lead.findMany({ where: { archiveLe: null }, select: { id: true, prenom: true, nom: true, telephone: true, email: true, ville: true, clientId: true }, orderBy: { createdAt: "desc" }, take: 2000 });
  for (const lead of leads) {
    if (lead.clientId && doublons.some((d) => d.type === "CLIENT" && d.id === lead.clientId)) continue;
    const parTelephone = Boolean(telephone) && normaliserTelephone(lead.telephone) === telephone;
    const parEmail = Boolean(email) && normaliserEmail(lead.email) === email;
    const parNom = memeNom(nom, nomNormalise(lead.prenom, lead.nom)) && (!ville || !lead.ville || villeNormalisee(lead.ville) === ville);
    if (!parTelephone && !parEmail && !parNom) continue;
    doublons.push({ type: "LEAD", id: lead.id, nom: `${lead.prenom} ${lead.nom}`.trim(), ville: lead.ville || null, motif: parTelephone ? "même numéro de téléphone" : parEmail ? "même adresse e-mail" : ville ? "même nom, même ville" : "même nom", clientId: lead.clientId });
    if (doublons.length >= 5) break;
  }
  return doublons;
}

export type ContactCree = { leadId: string; clientId: string; dossierId: string | null; nom: string };

export async function creerContactAssistant(entree: EntreeCreationContact): Promise<{ doublons: Doublon[]; cree?: undefined } | { doublons: Doublon[]; cree: ContactCree }> {
  const doublons = await reperDoublonsContact(entree);
  if (doublons.length && !entree.forcer) return { doublons };
  const cree = await creerEntrant(
    schemaCreationEntrant.parse({
      prenom: entree.prenom ?? "",
      nomFamille: entree.nom ?? "",
      telephone: entree.telephone ?? "",
      email: entree.email ?? null,
      ville: entree.ville ?? "",
      codePostal: entree.code_postal ?? null,
      source: entree.source ?? "AUTRE",
      typeProjet: entree.type_projet ?? "CUISINE",
      notes: entree.projet ?? null,
    })
  );
  const dossierId = entree.ouvrir_dossier ? (await ouvrirDossierDuLead(cree.id, { motif: "BOUTON" })).dossierId : null;
  return { doublons, cree: { leadId: cree.id, clientId: cree.clientId, dossierId, nom: `${entree.prenom ?? ""} ${entree.nom ?? ""}`.trim() } };
}
