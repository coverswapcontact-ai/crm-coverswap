import { listerClientsEspaces, type ClientEspace, type LigneEspace, type Signal } from "@/lib/espace/suivi";
import type { CodeSignal } from "@/lib/espace/suivi-types";
import { jourMois } from "../achevement";
import type { Detection, NiveauTache, Raccourci, TypeTache } from "../types";
import { entreGuillemets, titreTache } from "./libelles";
import { cleDuSignal, occurrenceDesSignaux, occurrenceDuSignal } from "./signaux-cles";
import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur SIGNAUX — les signaux des espaces clients (espace/suivi.ts), lus UNE fois pour
 * tous (`listerClientsEspaces`, qui calcule lui-même `listerEspaces` une seule fois : ses projets portent les signaux
 * par dossier, le client ceux de son espace permanent), BRUTS (`signauxBruts` : la vue de l'écran Espaces masque les
 * signaux des tâches écartées, le détecteur doit les voir pour ne pas cocher ces tâches à tort).
 *
 * | Signal | Tâche (clé : signaux-cles.ts) | Titre | Niveau | Raccourci |
 * |---|---|---|---|---|
 * | PROPOSITION_DEMANDEE | DEMANDE_CLIENT dossier | Préparer une autre proposition · Nom | 1 | simulateur |
 * | SIMULATIONS_DEMANDEES | DEMANDE_CLIENT dossier | Accorder des simulations · Nom | 1 | dossier |
 * | PHOTOS_SANS_SIMULATION | SIMULATION dossier | Préparer la simulation · Nom | 3 | simulateur |
 * | BROUILLONS | PUBLIER dossier | Publier la simulation · Nom | 3 | dossier |
 * | HESITE | HESITE dossier | Appeler · Nom | 2 | tel: |
 * | DATE_A_FIXER | DATE_CHANTIER dossier | Fixer la date du chantier · Nom | 1 | créneaux |
 * | NON_ENVOYE | ENVOYER_LIEN dossier | Envoyer le lien · Nom | 3 | SMS ENVOYER_LIEN |
 * | JAMAIS_OUVERT | ENVOYER_LIEN dossier | Renvoyer le lien · Nom | 3 | SMS LIEN_ESPACE_RAPPEL |
 * | EXPIRE, EXPIRE_BIENTOT | ENVOYER_LIEN dossier | Renvoyer le lien · Nom | 5 | SMS ENVOYER_LIEN |
 * | NOUVEAU_PROJET, PROJET_DEMANDE | DEMANDE_CLIENT client | Regarder le nouveau projet / Ouvrir un nouveau projet · Nom | 1 | dossier / Espaces |
 *
 * Deux signaux de même clé (proposition et simulations demandées ; lien pas envoyé et lien expiré ; nouveau projet et
 * projet demandé) font UNE tâche : la plus urgente donne titre et raccourci, la raison dit les deux. Les projets figés
 * (terminés, non réalisés) ne rendent rien. CONFIRMATION_DEMANDEE n'est pas une tâche. Lecture seule.
 * Mission 17 (partie A, relecture) : les signaux du lien portent leur occurrence (signaux-cles.ts › occurrenceDuSignal) ;
 * la raison du lien jamais ouvert dit la date d'envoi (« envoyé le 26/09 »), pas un nombre de jours qui change.
 */

/** Une tâche vue sur un signal, avant le regroupement par clé ; `ordre` départage deux signaux de même niveau. */
type Vue = { detection: Detection; ordre: number; precision: string };

const ORDRE: CodeSignal[] = ["PROJET_DEMANDE", "NOUVEAU_PROJET", "PROPOSITION_DEMANDEE", "SIMULATIONS_DEMANDEES", "DATE_A_FIXER", "HESITE", "PHOTOS_SANS_SIMULATION", "BROUILLONS", "NON_ENVOYE", "JAMAIS_OUVERT", "EXPIRE", "EXPIRE_BIENTOT"];

/** « Lien jamais ouvert (envoyé il y a 4 j) » → « lien jamais ouvert (envoyé il y a 4 j) ». */
const minuscule = (texte: string) => (texte ? texte[0].toLocaleLowerCase("fr-FR") + texte.slice(1) : texte);
const dossierHref = (dossierId: string, rubrique?: string) => `/dossiers?dossier=${dossierId}${rubrique ? `&rubrique=${rubrique}` : ""}`;

type Gabarit = { type: TypeTache; verbe: string; niveau: NiveauTache; depuis: Date; raison: string; raccourci: Raccourci; montant?: number | null };

/** La tâche d'un signal de projet (null : pas de tâche). */
function gabaritDuProjet(signal: Signal, p: LigneEspace): Gabarit | null {
  const creeLe = new Date(p.creeLe);
  const dossierId = p.dossierId;
  const sms = (action: string): Raccourci => ({ genre: "SMS", libelle: "Copier le SMS", dossierId, telephone: p.telephone || null, sms: { action, dossierId } });
  switch (signal.code) {
    case "PROPOSITION_DEMANDEE": {
      const proposition = p.faits.proposition;
      return {
        type: "DEMANDE_CLIENT",
        verbe: "Préparer une autre proposition",
        niveau: 1,
        depuis: proposition ? new Date(proposition.le) : creeLe,
        raison: proposition?.message ? `autre proposition demandée : ${entreGuillemets(proposition.message, 50)}` : `autre proposition demandée${proposition ? ` le ${jourMois(new Date(proposition.le))}` : ""}`,
        raccourci: { genre: "SIMULATEUR", libelle: "Ouvrir le simulateur", dossierId, href: `/simulateur?dossier=${dossierId}` },
      };
    }
    case "SIMULATIONS_DEMANDEES":
      return {
        type: "DEMANDE_CLIENT",
        verbe: "Accorder des simulations",
        niveau: 1,
        depuis: p.faits.simulationsDemandeesLe ? new Date(p.faits.simulationsDemandeesLe) : creeLe,
        raison: minuscule(signal.libelle),
        raccourci: { genre: "DOSSIER", libelle: "Accorder des simulations", dossierId, rubrique: "photos", href: dossierHref(dossierId, "photos") },
      };
    case "PHOTOS_SANS_SIMULATION":
      return { type: "SIMULATION", verbe: "Préparer la simulation", niveau: 3, depuis: creeLe, raison: minuscule(signal.libelle), raccourci: { genre: "SIMULATEUR", libelle: "Préparer la simulation", dossierId, href: `/simulateur?dossier=${dossierId}` } };
    case "BROUILLONS":
      return { type: "PUBLIER", verbe: "Publier la simulation", niveau: 3, depuis: creeLe, raison: minuscule(signal.libelle), raccourci: { genre: "DOSSIER", libelle: "Publier", dossierId, rubrique: "photos", href: dossierHref(dossierId, "photos") } };
    case "HESITE": {
      const devis = p.faits.devis;
      return {
        type: "HESITE",
        verbe: "Appeler",
        niveau: 2,
        depuis: devis?.consulteLe ? new Date(devis.consulteLe) : creeLe,
        raison: devis ? `devis relu ${devis.consultations} fois sans signer` : minuscule(signal.libelle),
        raccourci: { genre: "APPEL", libelle: "Appeler", dossierId, telephone: p.telephone || null, href: p.telephone ? `tel:${p.telephone.replace(/\s+/g, "")}` : null },
      };
    }
    case "DATE_A_FIXER":
      return {
        type: "DATE_CHANTIER",
        verbe: "Fixer la date du chantier",
        niveau: 1,
        depuis: p.faits.accord ? new Date(p.faits.accord) : creeLe,
        raison: p.faits.accord ? `accord donné le ${jourMois(new Date(p.faits.accord))}, date à fixer` : "accord donné, date à fixer",
        montant: p.faits.paiement?.total ?? null,
        raccourci: { genre: "PLANIFIER", libelle: "Fixer la date", dossierId },
      };
    case "NON_ENVOYE":
      return { type: "ENVOYER_LIEN", verbe: "Envoyer le lien", niveau: 3, depuis: creeLe, raison: minuscule(signal.libelle), raccourci: sms("ENVOYER_LIEN") };
    case "JAMAIS_OUVERT":
      return {
        type: "ENVOYER_LIEN",
        verbe: "Renvoyer le lien",
        niveau: 3,
        depuis: p.lienEnvoyeLe ? new Date(p.lienEnvoyeLe) : creeLe,
        raison: p.lienEnvoyeLe ? `lien jamais ouvert (envoyé le ${jourMois(new Date(p.lienEnvoyeLe))})` : "lien jamais ouvert",
        raccourci: sms("LIEN_ESPACE_RAPPEL"),
      };
    case "EXPIRE":
    case "EXPIRE_BIENTOT":
      return { type: "ENVOYER_LIEN", verbe: "Renvoyer le lien", niveau: 5, depuis: creeLe, raison: minuscule(signal.libelle), raccourci: sms("ENVOYER_LIEN") };
    default:
      return null;
  }
}

/** La tâche d'un signal du client (espace permanent). */
function gabaritDuClient(signal: Signal, c: ClientEspace): Gabarit | null {
  switch (signal.code) {
    case "PROJET_DEMANDE":
      return { type: "DEMANDE_CLIENT", verbe: "Ouvrir un nouveau projet", niveau: 1, depuis: c.projetDemandeLe ? new Date(c.projetDemandeLe) : new Date(c.lienEmisLe), raison: "demande un projet de plus", raccourci: { genre: "PAGE", libelle: "Ouvrir les espaces", href: "/espaces" } };
    case "NOUVEAU_PROJET": {
      const projet = c.projets.find((p) => p.creeParLeClient && !p.fige && p.etape === "PHOTOS");
      return {
        type: "DEMANDE_CLIENT",
        verbe: "Regarder le nouveau projet",
        niveau: 1,
        depuis: projet ? new Date(projet.creeLe) : new Date(c.lienEmisLe),
        raison: projet ? `nouveau projet ouvert : ${entreGuillemets(projet.nomProjet, 40)}` : "nouveau projet ouvert par le client",
        raccourci: projet ? { genre: "DOSSIER", libelle: "Ouvrir le projet", dossierId: projet.dossierId, href: dossierHref(projet.dossierId) } : { genre: "PAGE", libelle: "Ouvrir les espaces", href: "/espaces" },
      };
    }
    default:
      return null;
  }
}

function vueDe(g: Gabarit, cle: string, nom: string, cible: { dossierId?: string; clientId?: string | null }, signal: Signal, occurrence: string | null = null): Vue {
  const sujet = cible.dossierId ? { type: "DOSSIER" as const, id: cible.dossierId } : { type: "CLIENT" as const, id: cible.clientId! };
  return {
    ordre: ORDRE.indexOf(signal.code),
    precision: g.raison,
    detection: {
      cle,
      type: g.type,
      source: "SIGNAUX",
      sujet,
      ...(cible.dossierId ? { dossierId: cible.dossierId } : {}),
      ...(cible.clientId ? { clientId: cible.clientId } : {}),
      titre: titreTache(g.verbe, nom),
      raison: g.raison,
      niveau: g.niveau,
      montant: g.montant ?? null,
      depuis: g.depuis,
      raccourci: g.raccourci,
      donnees: { signaux: [signal.code], ...(occurrence ? { occurrence } : {}) },
    },
  };
}

export const detecteurSignaux: Detecteur = {
  source: "SIGNAUX",
  async detecter({ maintenant }) {
    const clients = await listerClientsEspaces(maintenant, {}, { signauxBruts: true });
    const vues: Vue[] = [];
    for (const c of clients) {
      const clientId = c.clientId || null;
      for (const p of c.projets) {
        if (p.fige) continue;
        for (const signal of p.signaux) {
          const cle = cleDuSignal(signal.code, { dossierId: p.dossierId });
          const gabarit = cle ? gabaritDuProjet(signal, p) : null;
          if (cle && gabarit) vues.push(vueDe(gabarit, cle, p.clientNom, { dossierId: p.dossierId, clientId }, signal, occurrenceDuSignal(signal.code, p)));
        }
      }
      // Les signaux du client lui-même (ceux des projets, recopiés dans `c.signaux`, sont lus ci-dessus).
      for (const signal of c.signaux) {
        const cle = cleDuSignal(signal.code, { clientId });
        const gabarit = cle && (signal.code === "NOUVEAU_PROJET" || signal.code === "PROJET_DEMANDE") ? gabaritDuClient(signal, c) : null;
        if (cle && gabarit) vues.push(vueDe(gabarit, cle, c.clientNom, { clientId }, signal));
      }
    }
    return regrouper(vues);
  },
};

/** Une tâche par clé : la plus urgente (niveau, puis l'ordre des signaux) donne titre et raccourci ; la raison dit tout. */
function regrouper(vues: readonly Vue[]): Detection[] {
  const parCle = new Map<string, Vue[]>();
  for (const v of vues) parCle.set(v.detection.cle, [...(parCle.get(v.detection.cle) ?? []), v]);
  return [...parCle.values()].map((groupe) => {
    const tries = [...groupe].sort((a, b) => a.detection.niveau - b.detection.niveau || a.ordre - b.ordre);
    const tete = tries[0];
    if (tries.length === 1) return tete.detection;
    const precisions = [...new Set(tries.map((v) => v.precision))];
    const occurrence = occurrenceDesSignaux(tries.map((v) => v.detection.donnees?.occurrence as string | undefined));
    return {
      ...tete.detection,
      raison: precisions.join(" ; "),
      depuis: tries.map((v) => v.detection.depuis).reduce((a, b) => (b.getTime() < a.getTime() ? b : a)),
      donnees: { signaux: [...new Set(tries.flatMap((v) => (v.detection.donnees?.signaux as string[]) ?? []))], ...(occurrence ? { occurrence } : {}) },
    };
  });
}
