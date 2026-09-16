import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { formatDate, sourceLabel } from "@/lib/utils";
import type { LeadTrouve } from "./types";

// Recherche « Ouvrir un dossier depuis un lead » : leads B2C (site, Meta,
// simulateur) et prospects B2B (/prospection). Chaque mot saisi doit se
// retrouver dans l'un des champs (nom, prénom, téléphone, e-mail, ville).

const OBJET_PAR_TYPE_PROJET: Record<string, string> = {
  CUISINE: "Recouvrement de cuisine",
  SDB: "Recouvrement de salle de bains",
  MEUBLES: "Recouvrement de mobilier",
  PRO: "Recouvrement de local professionnel",
};

const VILLES_INCONNUES = new Set(["", "non renseignée", "non renseigne", "inconnue"]);

function mots(recherche: string): string[] {
  return recherche.trim().split(/\s+/).filter(Boolean).slice(0, 5).map((mot) => mot.slice(0, 40));
}

/** « 12 Rue de la Loge, 34000 Montpellier, France » → « 12 Rue de la Loge ». */
function rueSeule(adresse: string | null): string {
  if (!adresse) return "";
  const [premier] = adresse.split(",");
  return /\b\d{5}\b/.test(premier) ? "" : premier.trim();
}

export async function rechercherLeads(recherche: string): Promise<LeadTrouve[]> {
  const termes = mots(recherche);
  const whereLead: Prisma.LeadWhereInput = {
    AND: termes.map((mot) => ({
      OR: [
        { nom: { contains: mot } },
        { prenom: { contains: mot } },
        { telephone: { contains: mot } },
        { email: { contains: mot } },
        { ville: { contains: mot } },
      ],
    })),
  };
  const whereProspect: Prisma.ProspectWhereInput = {
    AND: termes.map((mot) => ({
      OR: [
        { nom: { contains: mot } },
        { telephone: { contains: mot } },
        { email: { contains: mot } },
        { ville: { contains: mot } },
      ],
    })),
  };

  const [leads, prospects] = await Promise.all([
    prisma.lead.findMany({
      where: whereLead,
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { _count: { select: { dossiers: true } } },
    }),
    prisma.prospect.findMany({
      where: whereProspect,
      orderBy: { updatedAt: "desc" },
      take: 8,
      include: { _count: { select: { dossiers: true } } },
    }),
  ]);

  return [...leads.map(leadVersResultat), ...prospects.map(prospectVersResultat)];
}

type LeadAvecCompte = Prisma.LeadGetPayload<{ include: { _count: { select: { dossiers: true } } } }>;
type ProspectAvecCompte = Prisma.ProspectGetPayload<{ include: { _count: { select: { dossiers: true } } } }>;

function leadVersResultat(lead: LeadAvecCompte): LeadTrouve {
  const ville = VILLES_INCONNUES.has(lead.ville.trim().toLowerCase()) ? "" : lead.ville.trim();
  const nom = lead.prenom === lead.nom ? lead.nom : `${lead.prenom} ${lead.nom}`;
  return {
    origine: "LEAD",
    id: lead.id,
    libelle: nom,
    detail: [sourceLabel(lead.source), ville || null, `reçu le ${formatDate(lead.createdAt)}`]
      .filter(Boolean)
      .join(" · "),
    nbDossiers: lead._count.dossiers,
    preRemplissage: {
      clientNom: nom,
      clientAdresse: "",
      clientCp: lead.codePostal ?? "",
      clientVille: ville,
      clientTelephone: lead.telephone,
      clientEmail: lead.email ?? "",
      objet: OBJET_PAR_TYPE_PROJET[lead.typeProjet] ?? "",
      source: "ENTRANT",
    },
  };
}

function prospectVersResultat(prospect: ProspectAvecCompte): LeadTrouve {
  return {
    origine: "PROSPECT",
    id: prospect.id,
    libelle: prospect.nom,
    detail: ["Prospection", prospect.ville].filter(Boolean).join(" · "),
    nbDossiers: prospect._count.dossiers,
    preRemplissage: {
      clientNom: prospect.nom,
      clientAdresse: rueSeule(prospect.adresse),
      clientCp: prospect.codePostal ?? prospect.adresse?.match(/\b\d{5}\b/)?.[0] ?? "",
      clientVille: prospect.ville ?? "",
      clientTelephone: prospect.telephone ?? "",
      clientEmail: prospect.email ?? "",
      objet: "",
      source: "PROSPECTION",
    },
  };
}

/** Pré-remplissage d'un lead précis (lien « Ouvrir un dossier » de la fiche lead). */
export async function leadPourDossier(leadId: string): Promise<LeadTrouve | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { _count: { select: { dossiers: true } } },
  });
  return lead ? leadVersResultat(lead) : null;
}
