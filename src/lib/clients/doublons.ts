import prisma from "@/lib/prisma";
import { proposer } from "@/lib/validation/service";
import { cleNom, distanceEdition, formaterTelephone } from "./normalisation";

/**
 * Détection des fiches client en double. Elle ne fusionne jamais : chaque paire
 * suspecte devient une proposition FUSION_CLIENTS, à valider ou rejeter. Une
 * paire rejetée n'est plus jamais reproposée (clé d'unicité).
 */

type Fiche = {
  id: string;
  nom: string;
  ville: string | null;
  codePostal: string | null;
  siret: string | null;
  premierContactLe: Date;
  emails: string[];
  telephones: string[];
  dossiers: number;
};

/** Au-delà, une coordonnée partagée est un standard ou une valeur générique : pas de proposition. */
export const TAILLE_MAX_GROUPE_IDENTIQUE = 4;

export type PaireSuspecte = {
  a: Fiche;
  b: Fiche;
  confiance: number;
  raisons: string[];
};

function cleVille(fiche: Fiche): string | null {
  if (fiche.codePostal) return fiche.codePostal.trim();
  return fiche.ville ? cleNom(fiche.ville) : null;
}

export function pairesSuspectes(fiches: Fiche[]): PaireSuspecte[] {
  const paires = new Map<string, PaireSuspecte>();
  const noter = (a: Fiche, b: Fiche, confiance: number, raison: string) => {
    if (a.id === b.id) return;
    const [premiere, seconde] = a.id < b.id ? [a, b] : [b, a];
    const cle = `${premiere.id}:${seconde.id}`;
    const existante = paires.get(cle);
    if (existante) {
      if (!existante.raisons.includes(raison)) existante.raisons.push(raison);
      existante.confiance = Math.min(0.99, Math.max(existante.confiance, confiance) + 0.03);
    } else {
      paires.set(cle, { a: premiere, b: seconde, confiance, raisons: [raison] });
    }
  };

  const regrouper = (cles: (fiche: Fiche) => string[]) => {
    const groupes = new Map<string, Fiche[]>();
    for (const fiche of fiches) {
      for (const cle of cles(fiche)) groupes.set(cle, [...(groupes.get(cle) ?? []), fiche]);
    }
    return groupes;
  };

  // Coordonnée identique : chaque fiche du groupe est rapprochée de la fiche de
  // référence (plus de dossiers, puis plus ancienne), pas de toutes les autres :
  // trois fiches donnent deux propositions, pas trois. Au-delà de quelques
  // fiches, la coordonnée est un standard ou une valeur générique, pas un doublon.
  const rapprocherDeLaReference = (groupe: Fiche[], confiance: number, raison: string) => {
    if (groupe.length < 2 || groupe.length > TAILLE_MAX_GROUPE_IDENTIQUE) return;
    const [reference, ...autres] = [...groupe].sort(
      (x, y) => y.dossiers - x.dossiers || x.premierContactLe.getTime() - y.premierContactLe.getTime()
    );
    for (const autre of autres) noter(reference, autre, confiance, raison);
  };
  for (const [adresse, groupe] of regrouper((fiche) => fiche.emails)) {
    rapprocherDeLaReference(groupe, 0.95, `même adresse e-mail (${adresse})`);
  }
  for (const [numero, groupe] of regrouper((fiche) => fiche.telephones)) {
    rapprocherDeLaReference(groupe, 0.9, `même numéro (${formaterTelephone(numero)})`);
  }
  for (const [siret, groupe] of regrouper((fiche) => (fiche.siret ? [fiche.siret.replace(/\s/g, "")] : []))) {
    rapprocherDeLaReference(groupe, 0.95, `même SIRET (${siret})`);
  }
  // Noms proches dans la même ville : comparaison limitée à chaque ville.
  for (const groupe of regrouper((fiche) => {
    const ville = cleVille(fiche);
    return ville ? [ville] : [];
  }).values()) {
    // Même nom exact : même logique de fiche de référence.
    const parNom = new Map<string, Fiche[]>();
    for (const fiche of groupe) {
      const nom = cleNom(fiche.nom);
      if (nom) parNom.set(nom, [...(parNom.get(nom) ?? []), fiche]);
    }
    for (const memes of parNom.values()) rapprocherDeLaReference(memes, 0.7, "même nom dans la même ville");
    // Nom presque identique (faute de frappe) : une seule fiche par nom exact.
    const noms = [...parNom.entries()];
    for (let i = 0; i < noms.length; i++) {
      for (let j = i + 1; j < noms.length; j++) {
        const [nomA, fichesA] = noms[i];
        const [nomB, fichesB] = noms[j];
        // Pas de chiffres (« Lot 12 » et « Lot 13 » ne sont pas une faute de frappe) ;
        // une lettre d'écart pour un nom court, deux pour un nom long.
        if (/\d/.test(nomA) || /\d/.test(nomB)) continue;
        const plusCourt = Math.min(nomA.length, nomB.length);
        if (plusCourt >= 6 && distanceEdition(nomA, nomB) <= (plusCourt >= 12 ? 2 : 1)) {
          noter(fichesA[0], fichesB[0], 0.55, "nom presque identique dans la même ville");
        }
      }
    }
  }
  return [...paires.values()].sort((x, y) => y.confiance - x.confiance);
}

export async function chargerFichesPourDoublons(): Promise<Fiche[]> {
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      nom: true,
      ville: true,
      codePostal: true,
      siret: true,
      premierContactLe: true,
      emails: { where: { archiveLe: null }, select: { adresse: true } },
      telephones: { where: { archiveLe: null }, select: { numero: true } },
      _count: { select: { dossiers: true } },
    },
  });
  return clients.map((client) => ({
    id: client.id,
    nom: client.nom,
    ville: client.ville,
    codePostal: client.codePostal,
    siret: client.siret,
    premierContactLe: client.premierContactLe,
    emails: client.emails.map((email) => email.adresse),
    telephones: client.telephones.map((telephone) => telephone.numero),
    dossiers: client._count.dossiers,
  }));
}

function resumeFiche(lettre: string, fiche: Fiche): string {
  const lieu = [fiche.codePostal, fiche.ville].filter(Boolean).join(" ");
  return `${lettre} : ${fiche.nom}${lieu ? `, ${lieu}` : ""} — ${fiche.dossiers} dossier${fiche.dossiers > 1 ? "s" : ""}, premier contact le ${fiche.premierContactLe.toLocaleDateString("fr-FR")}`;
}

/** Propose la fusion de chaque paire suspecte encore jamais proposée. Rend le nombre de nouvelles propositions. */
export async function proposerFusions(): Promise<number> {
  const paires = pairesSuspectes(await chargerFichesPourDoublons());
  let nouvelles = 0;
  for (const paire of paires) {
    // Par défaut, on garde la fiche qui porte le plus de dossiers, puis la plus ancienne.
    const garderA =
      paire.a.dossiers !== paire.b.dossiers
        ? paire.a.dossiers > paire.b.dossiers
        : paire.a.premierContactLe <= paire.b.premierContactLe;
    const { creee } = await proposer({
      type: "FUSION_CLIENTS",
      titre: `Fusionner « ${paire.a.nom} » et « ${paire.b.nom} » ?`,
      resume: `${resumeFiche("A", paire.a)}\n${resumeFiche("B", paire.b)}`,
      raisonnement: `Indices : ${paire.raisons.join(" ; ")}.`,
      confiance: paire.confiance,
      contenu: { clientAId: paire.a.id, clientBId: paire.b.id, conserver: garderA ? "A" : "B" },
      cleUnicite: `fusion:${paire.a.id}:${paire.b.id}`,
      clientId: paire.a.id,
    });
    if (creee) nouvelles++;
  }
  return nouvelles;
}
