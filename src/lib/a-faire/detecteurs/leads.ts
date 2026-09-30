import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { aHeureParis } from "@/lib/commercial/quand";
import { dateCourte, heure, pluriel, quand } from "@/lib/commun/format";
import { JOURS_A_TRAITER, libelleSourceLead } from "@/lib/prospects/constantes";
import { LEAD_SANS_DOSSIER, nomDuLead } from "@/lib/prospects/leads";
import { jourMois } from "../achevement";
import type { Detection, NiveauTache, Raccourci, TypeTache } from "../types";
import { pilotageDuPassage } from "./pilotage-partage";
import { cleTache, type ContexteDetection, type Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur LEADS — les contacts sans dossier (règle des deux listes, `prospects/leads.ts`),
 * lus dans `pilotageCommercial(maintenant)` (affaires « contact » dont la main est à Lucas) :
 * - REPONDRE : un SMS reçu sans réponse (niveau 1) ;
 * - ECARTER : « à écarter » jamais appelé, « Classer · Nom (hors zone) » (niveau 5) ;
 * - APPELER : jamais appelé ni contacté par écrit (niveau 2 s'il est arrivé il y a moins de 24 h, sinon 3) ;
 * - RAPPELER : rappel dû ce soir au plus tard (niveau 2) ;
 * - DECIDER : appelé ou contacté par écrit, sans rappel daté (niveau 3).
 * Et, hors de la fenêtre du pilotage (60 jours), les anciens leads actifs : arrivés il y a plus de 60 jours, ni appelés
 * ni contactés depuis, sans rappel daté → CLASSER_LEAD en lot « anciens-leads » (niveau 5), tous, sans limite ; un
 * ancien qui vient d'écrire un SMS reçoit plutôt REPONDRE.
 * Clés : `APPELER:lead:<id>`… Lecture seule ; ne jamais appeler `proposerSms` ici (il ouvre dossier et espace).
 */

const JOUR_MS = 86_400_000;
const LOT_ANCIENS = { cle: "anciens-leads", libelle: "ancien lead contacté sans suite|anciens leads contactés sans suite" };

const SELECTION = { id: true, prenom: true, nom: true, telephone: true, source: true, createdAt: true, rappelLe: true, tentatives: true, dernierAppelLe: true, dernierContactLe: true, clientId: true, prioriteMotif: true } as const;

type LeadLu = { id: string; prenom: string; nom: string; telephone: string; source: string; createdAt: Date; rappelLe: Date | null; tentatives: number; dernierAppelLe: Date | null; dernierContactLe: Date | null; clientId: string | null; prioriteMotif: string | null };

/** « 14 h », « 9 h 30 » (heure de Paris). */
function heureLisible(date: Date): string {
  const [h, m] = heure(date).split(":");
  return `${Number(h)} h${m && m !== "00" ? ` ${m}` : ""}`;
}

/** « arrivé il y a 3 h », « arrivé hier », « arrivé le 12/09 ». */
function arrivee(createdAt: Date, maintenant: Date): string {
  const relatif = quand(createdAt, maintenant);
  return /^(il y a|à l'instant|hier)/.test(relatif) ? `arrivé ${relatif}` : `arrivé le ${jourMois(createdAt)}`;
}

const lienLead = (id: string) => `/leads?lead=${id}`;

function surLeLead(lead: LeadLu, type: TypeTache, champs: { titre: string; raison: string; niveau: NiveauTache; depuis: Date; raccourci: Raccourci; echeance?: Date | null; donnees?: Record<string, unknown>; lot?: Detection["lot"] }): Detection {
  return { cle: cleTache(type, { type: "LEAD", id: lead.id }), type, source: "LEADS", sujet: { type: "LEAD", id: lead.id }, leadId: lead.id, clientId: lead.clientId, montant: null, ...champs };
}

function appel(lead: LeadLu, telephone: string | null, libelle: string): Raccourci {
  return { genre: "APPEL", libelle, telephone, leadId: lead.id, href: telephone ? `tel:${telephone}` : null };
}

function repondre(lead: LeadLu, nom: string, recuLe: Date, conversationId: string | null, telephone: string | null): Detection {
  return surLeLead(lead, "REPONDRE", {
    titre: `Répondre · ${nom}`,
    raison: `SMS reçu le ${jourMois(recuLe)}`,
    niveau: 1,
    depuis: recuLe,
    raccourci: { genre: "LEAD", libelle: "Répondre", leadId: lead.id, telephone, href: lienLead(lead.id) },
    donnees: { canal: "SMS", ...(conversationId ? { conversationId } : {}) },
  });
}

async function detecter(contexte: ContexteDetection): Promise<Detection[]> {
  const { maintenant } = contexte;
  const limite = new Date(maintenant.getTime() - JOURS_A_TRAITER * JOUR_MS);
  const [pilotage, anciens] = await Promise.all([
    pilotageDuPassage(maintenant),
    // Le complément exact de la fenêtre du pilotage (commercial/pilotage.ts) parmi les leads sans dossier, non archivés.
    prisma.lead.findMany({
      where: {
        AND: [
          LEAD_SANS_DOSSIER,
          { archiveLe: null, rappelLe: null, createdAt: { lt: limite } },
          { OR: [{ dernierAppelLe: null }, { dernierAppelLe: { lt: limite } }] },
          { OR: [{ dernierContactLe: null }, { dernierContactLe: { lt: limite } }] },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: SELECTION,
    }),
  ]);
  const contacts = pilotage.affaires.filter((a) => a.genre === "CONTACT" && a.main === "MOI" && a.leadId);
  const leads = new Map((await prisma.lead.findMany({ where: { id: { in: contacts.map((a) => a.leadId!) } }, select: SELECTION })).map((l) => [l.id, l]));
  const detections: Detection[] = [];
  const ceSoir = new Date(aHeureParis(maintenant, 1, 0).getTime() - 1);
  const debutDuJour = aHeureParis(maintenant, 0, 0);

  for (const a of contacts) {
    const lead = leads.get(a.leadId!);
    if (!lead) continue;
    const nom = nomDuLead(lead);
    const telephone = a.telephone ?? normaliserTelephone(lead.telephone);
    // La même règle que les listes de Leads et le pilotage : jamais appelé ni contacté par écrit, sans rappel daté.
    const jamaisContacte = !lead.dernierAppelLe && !lead.dernierContactLe && !lead.rappelLe;
    switch (a.groupe) {
      case "REPONDRE":
        detections.push(repondre(lead, nom, a.dernier?.type === "SMS reçu" ? new Date(a.dernier.le) : lead.createdAt, a.conversationId, telephone));
        break;
      case "ECARTER":
        detections.push(
          surLeLead(lead, "ECARTER", {
            titre: `Classer · ${nom} (hors zone)`,
            raison: lead.prioriteMotif?.trim() ? lead.prioriteMotif.trim().slice(0, 80) : "hors zone",
            niveau: 5,
            depuis: lead.createdAt,
            raccourci: { genre: "LEAD", libelle: "Ouvrir la fiche", leadId: lead.id, href: lienLead(lead.id) },
          })
        );
        break;
      case "RAPPELER":
        if (jamaisContacte) {
          const recent = maintenant.getTime() - lead.createdAt.getTime() < JOUR_MS;
          detections.push(
            surLeLead(lead, "APPELER", {
              titre: `Appeler · ${nom}`,
              raison: `${arrivee(lead.createdAt, maintenant)} · ${libelleSourceLead(lead.source)}`,
              niveau: recent ? 2 : 3,
              depuis: lead.createdAt,
              raccourci: appel(lead, telephone, "Appeler"),
            })
          );
        } else if (lead.rappelLe && lead.rappelLe.getTime() <= ceSoir.getTime()) {
          const rappel = lead.rappelLe;
          const prevu = rappel.getTime() >= debutDuJour.getTime() ? `rappel prévu à ${heureLisible(rappel)}` : `rappel prévu le ${jourMois(rappel)} à ${heureLisible(rappel)}`;
          detections.push(
            surLeLead(lead, "RAPPELER", {
              titre: `Rappeler · ${nom}`,
              raison: lead.tentatives > 0 ? `${pluriel(lead.tentatives, "appel")} sans réponse` : prevu,
              niveau: 2,
              depuis: rappel,
              echeance: rappel,
              raccourci: appel(lead, telephone, "Rappeler"),
            })
          );
        }
        break;
      case "DECIDER": {
        const ecrit = lead.dernierContactLe && (!lead.dernierAppelLe || lead.dernierContactLe > lead.dernierAppelLe);
        const le = (ecrit ? lead.dernierContactLe : lead.dernierAppelLe) ?? lead.createdAt;
        detections.push(
          surLeLead(lead, "DECIDER", {
            titre: `Décider · ${nom}`,
            raison: `${ecrit ? "contacté par écrit" : "appelé"} le ${jourMois(le)}, sans rappel daté`,
            niveau: 3,
            depuis: le,
            raccourci: { genre: "LEAD", libelle: "Ouvrir la fiche", leadId: lead.id, href: lienLead(lead.id) },
          })
        );
        break;
      }
      default:
        break;
    }
  }

  // Les anciens leads : un lot à classer ; celui qui vient d'écrire un SMS sans réponse est d'abord à répondre.
  const smsEnAttente = anciens.length
    ? new Map(
        (await prisma.conversationSms.findMany({ where: { leadId: { in: anciens.map((l) => l.id) }, dernierSens: "ENTRANT", stopLe: null }, select: { id: true, leadId: true, dernierMessageLe: true } })).map((c) => [c.leadId!, c])
      )
    : new Map<string, { id: string; leadId: string | null; dernierMessageLe: Date | null }>();
  for (const lead of anciens) {
    const nom = nomDuLead(lead);
    const sms = smsEnAttente.get(lead.id);
    if (sms) {
      detections.push(repondre(lead, nom, sms.dernierMessageLe ?? lead.createdAt, sms.id, normaliserTelephone(lead.telephone)));
      continue;
    }
    const dernier = lead.dernierAppelLe ? `dernier appel le ${dateCourte(lead.dernierAppelLe)}` : lead.dernierContactLe ? `contacté par écrit le ${dateCourte(lead.dernierContactLe)}` : "jamais appelé";
    detections.push(
      surLeLead(lead, "CLASSER_LEAD", {
        titre: `Classer · ${nom} (ancien contact)`,
        raison: `arrivé le ${dateCourte(lead.createdAt)}, ${dernier}`,
        niveau: 5,
        depuis: lead.createdAt,
        raccourci: { genre: "LEAD", libelle: "Ouvrir la fiche", leadId: lead.id, href: lienLead(lead.id) },
        lot: LOT_ANCIENS,
      })
    );
  }
  return detections;
}

export const detecteurLeads: Detecteur = { source: "LEADS", detecter };
