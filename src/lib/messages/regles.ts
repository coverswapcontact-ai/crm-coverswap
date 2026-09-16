import { estAdresseAutomatique } from "./texte";

/**
 * Tri d'un message par les règles sûres, sans modèle d'IA. Fonction pure,
 * testée : c'est ici que se décide ce que l'agent fait SEUL.
 *
 * Seules deux actions se font sans validation, et seulement quand elles sont
 * certaines :
 * - archiver un mail publicitaire : catégorie « Promotions » ou « Réseaux
 *   sociaux » de Gmail ET en-tête de liste de diffusion, d'un expéditeur
 *   inconnu du CRM, hors d'une conversation où l'on a répondu, sans PDF joint ;
 * - rattacher un mail à la fiche du client dont c'est l'adresse exacte, et à
 *   son dossier quand il n'y en a qu'un en cours (ou que la conversation y est
 *   déjà rattachée).
 * Tout le reste est proposé, ou laissé dans la file « À trier ».
 */

/** Au-dessus, une action autorisée s'exécute sans validation ; en dessous, elle est proposée. */
export const SEUIL_AUTOMATIQUE = 0.95;

export type ClientReconnu = {
  id: string;
  nom: string;
  archive: boolean;
  dossiersEnCours: { id: string; objet: string }[];
};

export type EntreeTri = {
  sens: "ENTRANT" | "SORTANT";
  de: string;
  compte: string;
  entetes: Record<string, string>;
  libelles: string[];
  pieces: { typeMime: string }[];
  /** Clients dont une adresse est exactement l'expéditeur (entrant) ou un destinataire (sortant). */
  clients: ClientReconnu[];
  /** Ce que l'on sait déjà de la conversation (autres messages du même fil). */
  fil: { dossierIds: string[]; clientIds: string[]; reponduParNous: boolean };
};

export type Signal = { code: string; libelle: string };

export type DecisionTri =
  | { action: "ARCHIVER_BRUIT"; automatique: boolean; confiance: number; signaux: Signal[]; raison: string }
  | {
      action: "RATTACHER";
      automatique: boolean;
      confiance: number;
      clientId: string;
      dossierId: string | null;
      /** Dossiers en cours entre lesquels choisir (plusieurs : le choix est proposé). */
      candidats: { id: string; objet: string }[];
      raison: string;
    }
  | { action: "CLASSER"; automatique: boolean; confiance: number; categorie: "AUTRE"; raison: string }
  | { action: "A_TRIER"; signaux: Signal[]; raison: string; suggestion: { clientId: string; dossierId: string | null; confiance: number; raison: string } | null };

const CATEGORIES_MASSE = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"]);
const CATEGORIES_NOTIFICATION = new Set(["CATEGORY_UPDATES", "CATEGORY_FORUMS"]);

export function signauxDeBruit(entree: Pick<EntreeTri, "de" | "entetes" | "libelles">): { forts: Signal[]; faibles: Signal[] } {
  const entetes = entree.entetes;
  const liste = Boolean(entetes["list-unsubscribe"] || entetes["list-id"]);
  const precedence = /^(bulk|list|junk)$/i.test((entetes.precedence ?? "").trim());
  const automatique = Boolean(entetes["auto-submitted"] && !/^no$/i.test(entetes["auto-submitted"].trim())) || Boolean(entetes["x-autoreply"]);
  const masse = entree.libelles.some((libelle) => CATEGORIES_MASSE.has(libelle));
  const notification = entree.libelles.some((libelle) => CATEGORIES_NOTIFICATION.has(libelle));

  const faibles: Signal[] = [];
  if (liste) faibles.push({ code: "LISTE_DIFFUSION", libelle: "envoyé par une liste de diffusion (lien de désinscription)" });
  if (precedence) faibles.push({ code: "ENVOI_DE_MASSE", libelle: "marqué comme envoi de masse" });
  if (automatique) faibles.push({ code: "REPONSE_AUTOMATIQUE", libelle: "réponse ou envoi automatique" });
  if (estAdresseAutomatique(entree.de)) faibles.push({ code: "ADRESSE_AUTOMATIQUE", libelle: "adresse d'envoi automatique (noreply, notifications…)" });
  if (masse) faibles.push({ code: "CATEGORIE_PROMOTIONS", libelle: "classé par Gmail en Promotions ou Réseaux sociaux" });
  if (notification) faibles.push({ code: "CATEGORIE_NOTIFICATIONS", libelle: "classé par Gmail en Notifications ou Forums" });

  const forts = masse && (liste || precedence) ? faibles.filter((signal) => ["CATEGORIE_PROMOTIONS", "LISTE_DIFFUSION", "ENVOI_DE_MASSE"].includes(signal.code)) : [];
  return { forts, faibles };
}

const phrase = (signaux: Signal[]) => signaux.map((signal) => signal.libelle).join(" ; ");

export function trierParRegles(entree: EntreeTri): DecisionTri {
  const actifs = entree.clients.filter((client) => !client.archive);

  /* Envoyé depuis la boîte : rangé avec le client s'il est connu, sinon hors clients. */
  if (entree.sens === "SORTANT") {
    if (actifs.length === 1) {
      const client = actifs[0];
      const dossierDuFil = entree.fil.dossierIds.filter((id) => client.dossiersEnCours.some((dossier) => dossier.id === id));
      const dossierId = dossierDuFil.length === 1 ? dossierDuFil[0] : client.dossiersEnCours.length === 1 ? client.dossiersEnCours[0].id : null;
      return {
        action: "RATTACHER",
        automatique: true,
        confiance: 0.98,
        clientId: client.id,
        dossierId,
        candidats: dossierId ? [] : client.dossiersEnCours,
        raison: `Mail envoyé à ${client.nom}, dont c'est l'adresse${dossierId ? (dossierDuFil.length === 1 ? " ; conversation déjà rangée dans ce dossier" : " ; un seul dossier en cours") : ""}.`,
      };
    }
    if (actifs.length === 0) {
      return { action: "CLASSER", automatique: true, confiance: 0.99, categorie: "AUTRE", raison: "Mail envoyé à un destinataire qui n'est pas client." };
    }
    return { action: "A_TRIER", signaux: [], suggestion: null, raison: "Mail envoyé à plusieurs clients à la fois : à ranger à la main." };
  }

  if (entree.de === entree.compte) {
    return { action: "CLASSER", automatique: true, confiance: 0.99, categorie: "AUTRE", raison: "Mail de la boîte à elle-même." };
  }

  /* Expéditeur connu : son adresse exacte est sur une fiche client. */
  if (actifs.length === 1) {
    const client = actifs[0];
    const dossierDuFil = entree.fil.dossierIds.filter((id) => client.dossiersEnCours.some((dossier) => dossier.id === id));
    if (dossierDuFil.length === 1) {
      return {
        action: "RATTACHER",
        automatique: true,
        confiance: 0.98,
        clientId: client.id,
        dossierId: dossierDuFil[0],
        candidats: [],
        raison: `Adresse de ${client.nom}, et la conversation est déjà rangée dans ce dossier.`,
      };
    }
    if (client.dossiersEnCours.length <= 1) {
      const dossier = client.dossiersEnCours[0] ?? null;
      return {
        action: "RATTACHER",
        automatique: true,
        confiance: 0.97,
        clientId: client.id,
        dossierId: dossier?.id ?? null,
        candidats: [],
        raison: dossier
          ? `Adresse de ${client.nom}, qui a un seul dossier en cours (« ${dossier.objet} »).`
          : `Adresse de ${client.nom}, qui n'a pas de dossier en cours : rangé sur sa fiche.`,
      };
    }
    return {
      action: "RATTACHER",
      automatique: true,
      confiance: 0.98,
      clientId: client.id,
      dossierId: null,
      candidats: client.dossiersEnCours,
      raison: `Adresse de ${client.nom}, qui a ${client.dossiersEnCours.length} dossiers en cours : rangé sur sa fiche, le dossier est à choisir.`,
    };
  }
  if (actifs.length > 1) {
    return {
      action: "A_TRIER",
      signaux: [],
      suggestion: null,
      raison: `Adresse présente sur ${actifs.length} fiches clients (${actifs.map((client) => client.nom).join(", ")}) : à ranger à la main.`,
    };
  }
  const archive = entree.clients.find((client) => client.archive);
  if (archive) {
    return {
      action: "A_TRIER",
      signaux: [],
      suggestion: { clientId: archive.id, dossierId: null, confiance: 0.8, raison: `Adresse de ${archive.nom}, dont la fiche est archivée.` },
      raison: `Adresse de ${archive.nom}, dont la fiche est archivée : à confirmer.`,
    };
  }

  /* Expéditeur inconnu. */
  if (entree.fil.clientIds.length === 1) {
    return {
      action: "A_TRIER",
      signaux: [],
      suggestion: {
        clientId: entree.fil.clientIds[0],
        dossierId: entree.fil.dossierIds.length === 1 ? entree.fil.dossierIds[0] : null,
        confiance: 0.8,
        raison: "Adresse inconnue, mais la conversation est déjà rangée avec ce client (autre adresse de la même personne, ou d'un proche).",
      },
      raison: "Adresse inconnue dans une conversation déjà rangée avec un client.",
    };
  }

  const { forts, faibles } = signauxDeBruit(entree);
  const vetos: string[] = [];
  if (entree.fil.reponduParNous) vetos.push("nous avons déjà répondu dans cette conversation");
  if (entree.pieces.some((piece) => piece.typeMime === "application/pdf")) vetos.push("un PDF est joint (facture, document)");

  if (forts.length > 0 && vetos.length === 0) {
    return { action: "ARCHIVER_BRUIT", automatique: true, confiance: 0.99, signaux: faibles, raison: `Publicité : ${phrase(faibles)}.` };
  }
  if (faibles.length > 0 && vetos.length === 0) {
    return { action: "ARCHIVER_BRUIT", automatique: false, confiance: 0.8, signaux: faibles, raison: `Probablement du bruit : ${phrase(faibles)}.` };
  }
  return {
    action: "A_TRIER",
    signaux: faibles,
    suggestion: null,
    raison:
      faibles.length > 0
        ? `Expéditeur inconnu ; signes d'envoi automatique (${phrase(faibles)}) mais ${vetos.join(" et ")} : à trier.`
        : "Expéditeur inconnu du CRM : à trier.",
  };
}
