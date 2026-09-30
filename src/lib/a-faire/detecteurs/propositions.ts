import prisma from "@/lib/prisma";
import { TYPE_REGLE_TRI } from "@/lib/mail/propositions-maj";
import { listerPropositions } from "@/lib/validation/service";
import { TYPE_REGLE_TACHE } from "../propositions";
import type { Detection, NiveauTache, SujetTache } from "../types";
import { moment, paquets, raccourcir } from "./libelles";
import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur PROPOSITIONS — ce qui attend une validation (écran À valider, `listerPropositions`
 * EN_ATTENTE, toutes : relecture — une liste tronquée ferait cocher ce qui n'a pas été lu). Chaque proposition → VALIDER « Valider · (son titre, raccourci) », clé
 * `VALIDER:proposition:<id>` ; niveau 3 pour une carte de mise à jour (MAJ_DEPUIS_MAIL) et les autres, 5 pour une
 * règle (REGLE_TRI, REGLE_TACHE). Les mails de relance d'un devis (ENVOI_MAIL, motif RELANCE_DEVIS) ne sont PAS rendus
 * ici : le détecteur RELANCES les porte (RELANCER_DEVIS, raccourci « aperçu du mail »). Une proposition échue
 * (`expireLe` passé, en attente du travail d'expiration) non plus.
 * Sujet : le dossier (colonne, ou `contenu.dossierId`) s'il est vivant, sinon le client, sinon SYSTEME. Raccourci
 * « Valider / Ignorer » dans la ligne ; `donnees.propositionId` (l'effet valide ou rejette : reponses.ts) et
 * `donnees.sensible` (une proposition sensible ne se valide que depuis À valider, avec son aperçu).
 * Mission 17 (partie A, relecture) : une proposition SENSIBLE n'a pas « Valider » dans la ligne (reponses.ts le refuse) :
 * son raccourci est l'aperçu — « Relire et valider » : RELANCE_MAIL pour un mail (ENVOI_MAIL), sinon la page
 * /validation?proposition=<id>. Raison en date absolue (« proposée le 30/09 à 9 h »).
 * Achèvement : la proposition n'est plus EN_ATTENTE (le moteur coche « proposition validée / ignorée »). Lecture seule.
 */

const REGLES = [TYPE_REGLE_TRI, TYPE_REGLE_TACHE];

const texte = (valeur: unknown): string | null => (typeof valeur === "string" && valeur.trim() ? valeur : null);

export const detecteurPropositions: Detecteur = {
  source: "PROPOSITIONS",
  async detecter({ maintenant }) {
    const propositions = (await listerPropositions({ statuts: ["EN_ATTENTE"], limite: null })).filter(
      (p) => !(p.expireLe && new Date(p.expireLe).getTime() <= maintenant.getTime()) && !(p.type === "ENVOI_MAIL" && p.contenu.motif === "RELANCE_DEVIS")
    );
    if (propositions.length === 0) return [];
    const dossierDe = (p: (typeof propositions)[number]) => p.dossierId ?? texte(p.contenu.dossierId);
    const ids = [...new Set(propositions.map(dossierDe).filter((id): id is string => Boolean(id)))];
    const vivants = new Map<string, string | null>();
    for (const paquet of paquets(ids)) {
      for (const d of await prisma.dossier.findMany({ where: { id: { in: paquet } }, select: { id: true, clientId: true } })) vivants.set(d.id, d.clientId);
    }

    return propositions.map((p): Detection => {
      const candidat = dossierDe(p);
      const dossierId = candidat && vivants.has(candidat) ? candidat : null;
      const clientId = p.clientId ?? (dossierId ? (vivants.get(dossierId) ?? null) : null);
      const sujet: SujetTache = dossierId ? { type: "DOSSIER", id: dossierId } : clientId ? { type: "CLIENT", id: clientId } : { type: "SYSTEME", id: null };
      // Une carte de mise à jour (MAJ_DEPUIS_MAIL) et les autres : production ; une règle : ménage.
      const niveau: NiveauTache = REGLES.includes(p.type) ? 5 : 3;
      return {
        cle: `VALIDER:proposition:${p.id}`,
        type: "VALIDER",
        source: "PROPOSITIONS",
        sujet,
        dossierId,
        clientId,
        titre: `Valider · ${raccourcir(p.titre, 60) || p.libelleType}`,
        raison: `${raccourcir(p.libelleType, 40)} · proposée ${moment(new Date(p.createdAt))}`,
        niveau,
        depuis: new Date(p.createdAt),
        echeance: p.expireLe ? new Date(p.expireLe) : null,
        raccourci: p.sensible
          ? p.type === "ENVOI_MAIL"
            ? { genre: "RELANCE_MAIL", libelle: "Relire et valider", propositionId: p.id, dossierId }
            : { genre: "PAGE", libelle: "Relire et valider", propositionId: p.id, dossierId, href: `/validation?proposition=${p.id}` }
          : { genre: "VALIDER", libelle: "Valider", propositionId: p.id, dossierId, href: "/validation" },
        donnees: { propositionId: p.id, sensible: p.sensible },
      };
    });
  },
};
