import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { formatDate, sourceLabel } from "@/lib/utils";
import { formaterTelephone } from "@/lib/clients/normalisation";
import type { SourceDossier } from "./constants";
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

  const [clients, leads, prospects] = await Promise.all([
    prisma.client.findMany({
      where: {
        AND: termes.map((mot) => {
          const chiffres = mot.replace(/\D/g, "").replace(/^0/, "");
          return {
            OR: [
              { nom: { contains: mot } },
              { ville: { contains: mot } },
              { emails: { some: { adresse: { contains: mot.toLowerCase() } } } },
              ...(chiffres.length >= 4 ? [{ telephones: { some: { numero: { contains: chiffres } } } }] : []),
            ],
          };
        }),
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: inclusionClient,
    }),
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

  // Un lead ou un prospect déjà rattaché à un client trouvé n'est pas proposé deux fois.
  const clientsTrouves = new Set(clients.map((client) => client.id));
  return [
    ...clients.map(clientVersResultat),
    ...leads.filter((lead) => !lead.clientId || !clientsTrouves.has(lead.clientId)).map(leadVersResultat),
    ...prospects.filter((prospect) => !prospect.clientId || !clientsTrouves.has(prospect.clientId)).map(prospectVersResultat),
  ];
}

const inclusionClient = {
  _count: { select: { dossiers: true } },
  emails: { where: { archiveLe: null }, orderBy: [{ principale: "desc" }, { createdAt: "asc" }], take: 1 },
  telephones: { where: { archiveLe: null }, orderBy: [{ principal: "desc" }, { createdAt: "asc" }], take: 1 },
  dossiers: { orderBy: { createdAt: "desc" }, take: 1, select: { clientAdresse: true, clientCp: true, clientVille: true } },
} satisfies Prisma.ClientInclude;

type ClientAvecCompte = Prisma.ClientGetPayload<{ include: typeof inclusionClient }>;

const SOURCE_DOSSIER_PAR_SOURCE_CLIENT: Record<string, SourceDossier> = {
  RECOMMANDATION: "RECOMMANDATION",
  BOUCHE_A_OREILLE: "RECOMMANDATION",
  SOUS_TRAITANCE: "SOUS_TRAITANCE",
  PROSPECTION: "PROSPECTION",
};

function clientVersResultat(client: ClientAvecCompte): LeadTrouve {
  const dernier = client.dossiers[0];
  const ville = client.ville ?? dernier?.clientVille ?? "";
  return {
    origine: "CLIENT",
    id: client.id,
    libelle: client.nom,
    detail: ["Client", ville || null, client._count.dossiers > 0 ? "déjà client" : null].filter(Boolean).join(" · "),
    nbDossiers: client._count.dossiers,
    preRemplissage: {
      clientNom: client.nom,
      // Adresse de la fiche, sinon celle du dernier chantier : à vérifier s'il s'agit d'un autre lieu.
      clientAdresse: client.adresse ?? dernier?.clientAdresse ?? "",
      clientCp: client.codePostal ?? dernier?.clientCp ?? "",
      clientVille: ville,
      clientTelephone: client.telephones[0] ? formaterTelephone(client.telephones[0].numero) : "",
      clientEmail: client.emails[0]?.adresse ?? "",
      objet: "",
      source: SOURCE_DOSSIER_PAR_SOURCE_CLIENT[client.source] ?? "ENTRANT",
    },
  };
}

/** Pré-remplissage depuis une fiche client (bouton « Ouvrir un dossier » de la fiche). */
export async function clientPourDossier(clientId: string): Promise<LeadTrouve | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, include: inclusionClient });
  return client && !client.archiveLe ? clientVersResultat(client) : null;
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
