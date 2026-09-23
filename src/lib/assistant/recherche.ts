import prisma from "@/lib/prisma";
import { cleNom, distanceEdition, normaliserEmail, normaliserTelephone } from "@/lib/clients/normalisation";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { LIBELLES_STATUT_LEAD, type StatutLead } from "@/lib/prospects/constantes";

/**
 * Chercher un client, un lead ou un dossier comme on le dirait à voix haute :
 * « Rousse », « le dossier Forestier », « 06 12 34 56 78 », « Montpellier ».
 * Tolérant à l'orthographe (accents ignorés, une ou deux lettres de travers),
 * et honnête sur l'ambiguïté : deux « Rousse » rendent deux candidats, jamais
 * un choix fait à la place de Lucas.
 */

export type TypeContact = "CLIENT" | "LEAD" | "DOSSIER";

export type Candidat = {
  type: TypeContact;
  id: string;
  nom: string;
  ville: string | null;
  /** Étape du dossier, statut du lead, ou ce que la fiche client porte (nombre de dossiers). */
  etat: string;
  /** Pourquoi il correspond (« nom proche », « téléphone », « e-mail », « adresse », « numéro de devis »). */
  motif: string;
  /** 1 = exact, 0,5 = approché. */
  score: number;
  clientId: string | null;
  leadId: string | null;
  dossierId: string | null;
  chemin: string;
};

const sansAccents = (texte: string) => texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const mots = (texte: string) => sansAccents(texte).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((m) => m.length >= 2);
const MOTS_VIDES = new Set(["le", "la", "les", "de", "du", "des", "un", "une", "et", "monsieur", "madame", "mme", "mr", "m", "dossier", "client", "lead", "fiche", "chez"]);

/** Un mot de la recherche correspond-il à un mot du nom (exact, préfixe, ou à une faute près) ? */
function motProche(cherche: string, candidat: string): "exact" | "proche" | null {
  if (cherche === candidat) return "exact";
  if (candidat.startsWith(cherche) && cherche.length >= 3) return "exact";
  const tolerance = cherche.length >= 12 ? 2 : cherche.length >= 5 ? 1 : 0;
  return tolerance > 0 && distanceEdition(cherche, candidat) <= tolerance ? "proche" : null;
}

function scoreNom(recherche: string[], nom: string): { score: number; motif: string } | null {
  const cible = mots(nom);
  if (recherche.length === 0 || cible.length === 0) return null;
  let exacts = 0;
  let proches = 0;
  for (const mot of recherche) {
    const meilleur = cible.map((c) => motProche(mot, c)).find((r) => r === "exact") ?? cible.map((c) => motProche(mot, c)).find((r) => r === "proche") ?? null;
    if (meilleur === "exact") exacts++;
    else if (meilleur === "proche") proches++;
  }
  if (exacts + proches === 0) return null;
  // Tous les mots cherchés trouvés : exact ; sinon proportionnel, une faute compte moitié.
  const score = (exacts + proches * 0.5) / recherche.length;
  return score >= 0.5 ? { score: Math.min(1, score), motif: proches > 0 ? "nom proche" : "nom" } : null;
}

export async function chercherContacts(texte: string, options: { limite?: number } = {}): Promise<Candidat[]> {
  const limite = options.limite ?? 8;
  const brut = texte.trim();
  if (!brut) return [];
  const telephone = normaliserTelephone(brut);
  const email = brut.includes("@") ? normaliserEmail(brut) : null;
  const recherche = mots(brut).filter((m) => !MOTS_VIDES.has(m));
  const cleRecherche = cleNom(brut);

  const [clients, leads, dossiers] = await Promise.all([
    prisma.client.findMany({
      where: { archiveLe: null, anonymiseLe: null, fusionneDansId: null },
      select: { id: true, nom: true, prenom: true, nomFamille: true, raisonSociale: true, ville: true, emails: { where: { archiveLe: null }, select: { adresse: true } }, telephones: { where: { archiveLe: null }, select: { numero: true } }, dossiers: { where: { archiveLe: null }, select: { id: true, etape: true, objet: true } } },
      take: 2000,
    }),
    prisma.lead.findMany({
      where: { archiveLe: null, createdAt: { gte: new Date(Date.now() - 400 * 86_400_000) } },
      select: { id: true, prenom: true, nom: true, ville: true, email: true, telephone: true, statut: true, clientId: true, dossiers: { where: { archiveLe: null }, select: { id: true }, take: 1 } },
      take: 3000,
    }),
    prisma.dossier.findMany({ where: { archiveLe: null }, select: { id: true, clientNom: true, clientVille: true, clientAdresse: true, clientCp: true, objet: true, etape: true, clientId: true, leadId: true, clientEmail: true, clientTelephone: true }, take: 3000 }),
  ]);
  // Un numéro de devis ou de facture (« 2026-037 », « F-2026-012 ») : le dossier du document (mission 10).
  const numero = /^[A-Z]{0,3}-?\d{4}-\d{2,6}$/i.test(brut) ? brut.toUpperCase() : null;
  const documents = numero ? await prisma.document.findMany({ where: { numero: { contains: numero.replace(/^[A-Z]+-/, "") }, archiveLe: null }, select: { id: true, type: true, numero: true, dossier: { select: { id: true, clientNom: true, clientVille: true, objet: true, etape: true, clientId: true, leadId: true } } }, take: 5 }) : [];

  const candidats: Candidat[] = [];
  const ajouter = (c: Candidat) => {
    const existant = candidats.find((x) => x.type === c.type && x.id === c.id);
    if (!existant) candidats.push(c);
    else if (c.score > existant.score) Object.assign(existant, c);
  };
  const memeTelephone = (numero: string | null | undefined) => Boolean(telephone && numero && normaliserTelephone(numero) === telephone);
  const memeEmail = (adresse: string | null | undefined) => Boolean(email && adresse && normaliserEmail(adresse) === email);

  for (const c of clients) {
    const nomComplet = [c.prenom, c.nomFamille ?? c.nom, c.raisonSociale].filter(Boolean).join(" ") || c.nom;
    const etat = c.dossiers.length ? `${c.dossiers.length} dossier${c.dossiers.length > 1 ? "s" : ""} : ${c.dossiers.map((d) => LIBELLES_ETAPE[d.etape as EtapeDossier] ?? d.etape).join(", ")}` : "client sans dossier";
    const base = { type: "CLIENT" as const, id: c.id, nom: nomComplet, ville: c.ville, etat, clientId: c.id, leadId: null, dossierId: c.dossiers.length === 1 ? c.dossiers[0].id : null, chemin: `/clients/${c.id}` };
    if (c.telephones.some((t) => memeTelephone(t.numero))) ajouter({ ...base, score: 1, motif: "téléphone" });
    else if (c.emails.some((e) => memeEmail(e.adresse))) ajouter({ ...base, score: 1, motif: "e-mail" });
    else {
      const s = scoreNom(recherche, `${nomComplet} ${c.nom}`) ?? (cleRecherche && cleNom(nomComplet) === cleRecherche ? { score: 1, motif: "nom" } : null);
      if (s) ajouter({ ...base, ...s });
    }
  }
  for (const l of leads) {
    const nomComplet = `${l.prenom} ${l.nom}`.replace(/Inconnu/gi, "").trim() || l.email || "Sans nom";
    const base = { type: "LEAD" as const, id: l.id, nom: nomComplet, ville: l.ville || null, etat: `lead ${(LIBELLES_STATUT_LEAD[l.statut as StatutLead] ?? l.statut).toLowerCase()}${l.dossiers.length ? " (dossier ouvert)" : ""}`, clientId: l.clientId, leadId: l.id, dossierId: l.dossiers[0]?.id ?? null, chemin: `/leads?lead=${l.id}` };
    if (memeTelephone(l.telephone)) ajouter({ ...base, score: 1, motif: "téléphone" });
    else if (memeEmail(l.email)) ajouter({ ...base, score: 1, motif: "e-mail" });
    else {
      const s = scoreNom(recherche, nomComplet);
      if (s) ajouter({ ...base, ...s });
    }
  }
  for (const doc of documents) {
    const d = doc.dossier;
    ajouter({ type: "DOSSIER", id: d.id, nom: `${d.clientNom} — ${d.objet}`, ville: d.clientVille || null, etat: `${LIBELLES_ETAPE[d.etape as EtapeDossier] ?? d.etape} · ${doc.type === "DEVIS" ? "devis" : doc.type === "FACTURE" ? "facture" : "avoir"} ${doc.numero}`, motif: `numéro de ${doc.type === "DEVIS" ? "devis" : doc.type === "FACTURE" ? "facture" : "document"}`, score: 1, clientId: d.clientId, leadId: d.leadId, dossierId: d.id, chemin: `/dossiers?dossier=${d.id}` });
  }
  // Une adresse (« 30 boulevard Joliot-Curie ») : tous les mots cherchés dans l'adresse du dossier (numéro compris).
  const motsAdresse = sansAccents(brut).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((m) => (m.length >= 2 || /^\d+$/.test(m)) && !MOTS_VIDES.has(m));
  const ressembleAUneAdresse = motsAdresse.length >= 2 && /\d/.test(brut) && !telephone;
  for (const d of dossiers) {
    const base = { type: "DOSSIER" as const, id: d.id, nom: `${d.clientNom} — ${d.objet}`, ville: d.clientVille || null, etat: LIBELLES_ETAPE[d.etape as EtapeDossier] ?? d.etape, clientId: d.clientId, leadId: d.leadId, dossierId: d.id, chemin: `/dossiers?dossier=${d.id}` };
    if (memeTelephone(d.clientTelephone)) ajouter({ ...base, score: 1, motif: "téléphone" });
    else if (memeEmail(d.clientEmail)) ajouter({ ...base, score: 1, motif: "e-mail" });
    else {
      const s = scoreNom(recherche, d.clientNom) ?? scoreNom(recherche, d.objet);
      if (s) ajouter({ ...base, ...s });
      else if (ressembleAUneAdresse) {
        const adresse = sansAccents(`${d.clientAdresse} ${d.clientCp} ${d.clientVille}`).replace(/[^a-z0-9]+/g, " ");
        const motsTrouves = motsAdresse.filter((m) => adresse.split(" ").some((x) => x === m || (m.length >= 4 && !/^\d+$/.test(m) && x.startsWith(m))));
        if (motsTrouves.length === motsAdresse.length) ajouter({ ...base, score: 0.9, motif: "adresse" });
      }
    }
  }
  // Une ville seule (« Montpellier ») : tout ce qui s'y trouve, si rien d'autre ne correspond.
  if (candidats.length === 0 && recherche.length === 1) {
    const ville = recherche[0];
    for (const d of dossiers) if (d.clientVille && sansAccents(d.clientVille).includes(ville)) ajouter({ type: "DOSSIER", id: d.id, nom: `${d.clientNom} — ${d.objet}`, ville: d.clientVille, etat: LIBELLES_ETAPE[d.etape as EtapeDossier] ?? d.etape, motif: "ville", score: 0.6, clientId: d.clientId, leadId: d.leadId, dossierId: d.id, chemin: `/dossiers?dossier=${d.id}` });
    for (const l of leads) if (l.ville && sansAccents(l.ville).includes(ville)) ajouter({ type: "LEAD", id: l.id, nom: `${l.prenom} ${l.nom}`.trim(), ville: l.ville, etat: `lead ${(LIBELLES_STATUT_LEAD[l.statut as StatutLead] ?? l.statut).toLowerCase()}`, motif: "ville", score: 0.6, clientId: l.clientId, leadId: l.id, dossierId: l.dossiers[0]?.id ?? null, chemin: `/leads?lead=${l.id}` });
  }
  const ordre: Record<TypeContact, number> = { DOSSIER: 0, CLIENT: 1, LEAD: 2 };
  return candidats.sort((a, b) => b.score - a.score || ordre[a.type] - ordre[b.type] || a.nom.localeCompare(b.nom)).slice(0, limite);
}

/**
 * Un seul contact attendu (« le dossier Rousse ») : rend le candidat s'il est
 * seul et net, sinon la liste des candidats — Claude demande alors à Lucas
 * lequel, au lieu de choisir.
 */
export async function trouverUnSeul(texte: string, type?: TypeContact): Promise<{ trouve: Candidat } | { ambigu: Candidat[] } | { aucun: true }> {
  const tous = await chercherContacts(texte, { limite: 12 });
  const candidats = type ? tous.filter((c) => c.type === type) : tous;
  if (candidats.length === 0) return { aucun: true };
  const [premier, second] = candidats;
  // Un dossier et son client, ou son lead, c'est la même personne : pas une ambiguïté.
  const memePersonne = (a: Candidat, b: Candidat) => (a.clientId && a.clientId === b.clientId) || (a.dossierId && a.dossierId === b.dossierId) || (a.leadId && a.leadId === b.leadId);
  const distincts = candidats.filter((c, i) => candidats.findIndex((x) => memePersonne(c, x)) === i);
  if (distincts.length === 1) return { trouve: premier };
  if (premier.score === 1 && (!second || second.score < 1 || memePersonne(premier, second))) return { trouve: premier };
  return { ambigu: distincts.slice(0, 6) };
}
