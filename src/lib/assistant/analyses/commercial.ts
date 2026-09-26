import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { LIBELLES_ETIQUETTE_APPEL, type EtiquetteAppel } from "@/lib/commercial/notes-constantes";
import { lireEtiquettes } from "@/lib/commercial/notes-appel";
import { LIBELLES_ETAPE, LIBELLES_MOTIF_PERTE, type EtapeDossier, type MotifPerte } from "@/lib/dossiers/constants";
import { dureeParEtape, parcoursEtapes } from "@/lib/dossiers/delais";
import { lireMetadataChangementEtape } from "@/lib/dossiers/regles";
import { libelleSourceLead } from "@/lib/prospects/constantes";
import { definirOutil, format, lien } from "../definition";
import { resoudrePeriode, schemaPeriode, type Periode } from "../periodes";
import { arrondi, avertissementMinces, evolution, familleDuDossier, heuresEntre, libelleFamille, mediane, moyenne, repartir, somme, taux } from "./commun";
import { accord, pluriel } from "@/lib/commun/format";

/**
 * Manager commercial (mission 8) : l'entonnoir, les taux et temps par étape,
 * les motifs de perte, l'effet du délai de rappel, les devis en attente, le
 * panier moyen. Cohorte = leads REÇUS dans la période, suivis jusqu'à
 * aujourd'hui ; devis en attente = état du jour, hors période.
 */

const ETAPES_ORDRE: EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE", "SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"];
const rang = (e: string) => ETAPES_ORDRE.indexOf(e as EtapeDossier);
const ISSUES_JOIGNABLE = ["INTERESSE", "A_RAPPELER", "PAS_INTERESSE"];

export type LeadCohorte = {
  id: string;
  recuLe: Date;
  source: string;
  campagne: string | null;
  publicite: string | null;
  famille: string;
  premierAppelLe: Date | null;
  joignable: boolean;
  photos: boolean;
  simulation: boolean;
  devis: boolean;
  signe: boolean;
  encaisse: boolean;
  montantSigne: number | null;
};

export type Entonnoir = { recus: number; appeles: number; joignables: number; photos: number; simulations: number; devis: number; signes: number; encaisses: number };

/** L'entonnoir d'une cohorte (pur). */
export function entonnoirDe(leads: LeadCohorte[]): Entonnoir {
  return {
    recus: leads.length,
    appeles: leads.filter((l) => l.premierAppelLe).length,
    joignables: leads.filter((l) => l.joignable).length,
    photos: leads.filter((l) => l.photos).length,
    simulations: leads.filter((l) => l.simulation).length,
    devis: leads.filter((l) => l.devis).length,
    signes: leads.filter((l) => l.signe).length,
    encaisses: leads.filter((l) => l.encaisse).length,
  };
}

/** Taux de passage d'une marche à la suivante (pur). */
export function tauxEntonnoir(e: Entonnoir) {
  return {
    appel: taux(e.appeles, e.recus),
    joignable: taux(e.joignables, e.appeles),
    photos: taux(e.photos, e.joignables),
    simulation: taux(e.simulations, e.photos),
    devis: taux(e.devis, e.simulations),
    signature: taux(e.signes, e.devis),
    encaissement: taux(e.encaisses, e.signes),
    signatureSurLeads: taux(e.signes, e.recus),
  };
}

/** Effet du délai de premier rappel sur la signature (pur) : quatre tranches. */
export function effetDelaiRappel(leads: LeadCohorte[]) {
  const tranche = (l: LeadCohorte) => (!l.premierAppelLe ? "jamais_appele" : heuresEntre(l.recuLe, l.premierAppelLe) <= 1 ? "moins_1h" : heuresEntre(l.recuLe, l.premierAppelLe) <= 24 ? "1_a_24h" : "plus_24h");
  const tranches = ["moins_1h", "1_a_24h", "plus_24h", "jamais_appele"] as const;
  const libelles: Record<(typeof tranches)[number], string> = { moins_1h: "rappelé en moins d'une heure", "1_a_24h": "rappelé entre 1 et 24 heures", plus_24h: "rappelé après plus de 24 heures", jamais_appele: "jamais appelé" };
  const delais = leads.filter((l) => l.premierAppelLe).map((l) => heuresEntre(l.recuLe, l.premierAppelLe!));
  return {
    delaiMoyenHeures: moyenne(delais),
    delaiMedianHeures: mediane(delais),
    tranches: tranches.map((t) => {
      const liste = leads.filter((l) => tranche(l) === t);
      return { tranche: t, libelle: libelles[t], leads: liste.length, signes: liste.filter((l) => l.signe).length, tauxSignature: taux(liste.filter((l) => l.signe).length, liste.length) };
    }),
  };
}

async function cohorte(periode: Periode): Promise<LeadCohorte[]> {
  const leads = await prisma.lead.findMany({
    where: { archiveLe: null, createdAt: { gte: periode.debut, lt: periode.fin } },
    select: {
      id: true, createdAt: true, source: true, campagne: true, publicite: true, typeProjet: true,
      notesAppel: { where: { archiveLe: null }, select: { appelLe: true, issue: true } },
      interactions: { where: { archiveLe: null, type: "APPEL" }, select: { createdAt: true } },
      simulations: { select: { id: true }, take: 1 },
      dossiers: { where: { archiveLe: null }, select: { id: true, etape: true, photos: true, prestations: true, documents: { where: { type: "DEVIS", numero: { not: null }, archiveLe: null }, select: { id: true } }, accords: { where: { retireLe: null }, select: { totalHt: true } }, espaces: { where: { archiveLe: null }, select: { simulations: { where: { statut: "PUBLIEE", archiveLe: null }, select: { id: true }, take: 1 } } }, evenements: { where: { type: "ESPACE_PHOTOS", archiveLe: null }, select: { id: true }, take: 1 } } },
    },
  });
  return leads.map((l) => {
    const appels = [...l.notesAppel.map((n) => n.appelLe), ...l.interactions.map((i) => i.createdAt)].sort((a, b) => a.getTime() - b.getTime());
    const d = l.dossiers[0] ?? null;
    let photos = false;
    try {
      photos = Boolean(d && ((JSON.parse(d.photos) as unknown[]).length > 0 || d.evenements.length > 0));
    } catch {
      photos = Boolean(d && d.evenements.length > 0);
    }
    const accord = l.dossiers.flatMap((x) => x.accords)[0] ?? null;
    const etapeMax = Math.max(-1, ...l.dossiers.map((x) => rang(x.etape)));
    return {
      id: l.id,
      recuLe: l.createdAt,
      source: l.source,
      campagne: l.campagne,
      publicite: l.publicite,
      famille: familleDuDossier(d?.prestations, l.typeProjet),
      premierAppelLe: appels[0] ?? null,
      joignable: l.notesAppel.some((n) => n.issue && ISSUES_JOIGNABLE.includes(n.issue)) || l.interactions.length > 0,
      photos,
      simulation: l.simulations.length > 0 || l.dossiers.some((x) => x.espaces.some((e) => e.simulations.length > 0)),
      devis: l.dossiers.some((x) => x.documents.length > 0),
      signe: Boolean(accord) || etapeMax >= rang("SIGNE"),
      encaisse: etapeMax >= rang("ENCAISSE"),
      montantSigne: accord?.totalHt ?? null,
    };
  });
}

async function tempsParEtape(periode: Periode, maintenant: Date) {
  const dossiers = await prisma.dossier.findMany({ where: { archiveLe: null, createdAt: { gte: periode.debut, lt: periode.fin } }, select: { id: true, createdAt: true, evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { createdAt: true, survenuLe: true, metadata: true }, orderBy: { createdAt: "asc" } } } });
  const cumul = new Map<string, number[]>();
  for (const d of dossiers) {
    const changements = d.evenements.flatMap((e) => {
      const metadata = lireMetadataChangementEtape(e.metadata);
      return metadata ? [{ createdAt: e.createdAt, survenuLe: e.survenuLe, vers: metadata.vers, ouverture: metadata.nature === "OUVERTURE", dateInconnue: metadata.dateInconnue === true }] : [];
    });
    const parcours = parcoursEtapes(changements, maintenant);
    for (const [etape, duree] of Object.entries(dureeParEtape(parcours))) if (typeof duree === "number" && duree > 0) cumul.set(etape, [...(cumul.get(etape) ?? []), duree / 86_400_000]);
  }
  return ETAPES_ORDRE.filter((e) => cumul.has(e)).map((e) => ({ etape: e, libelle: LIBELLES_ETAPE[e], dossiers: cumul.get(e)!.length, joursMoyens: moyenne(cumul.get(e)!), joursMedians: mediane(cumul.get(e)!) }));
}

async function motifsDePerte(periode: Periode) {
  const [notes, perdus, leadsPerdus] = await Promise.all([
    prisma.noteAppel.findMany({ where: { archiveLe: null, appelLe: { gte: periode.debut, lt: periode.fin } }, select: { etiquettes: true } }),
    prisma.dossier.findMany({ where: { etape: "PERDU", perteLe: { gte: periode.debut, lt: periode.fin } }, select: { motifPerte: true, perteEtape: true, perteConcurrent: true } }),
    // Mission 12 : les leads classés « sans suite » portent aussi leur motif.
    prisma.lead.findMany({ where: { statut: "PERDU", perteLe: { gte: periode.debut, lt: periode.fin } }, select: { motifPerte: true } }),
  ]);
  const etiquettes = notes.flatMap((n) => lireEtiquettes(n.etiquettes));
  const pertes = [...perdus.map((d) => ({ motif: d.motifPerte })), ...leadsPerdus.map((l) => ({ motif: l.motifPerte }))];
  return {
    etiquettesAppel: repartir(etiquettes, (e) => e, (c) => LIBELLES_ETIQUETTE_APPEL[c as EtiquetteAppel] ?? c),
    dossiersPerdus: perdus.length,
    leadsPerdus: leadsPerdus.length,
    parMotif: repartir(pertes, (p) => p.motif ?? "NON_RENSEIGNE", (c) => LIBELLES_MOTIF_PERTE[c as MotifPerte] ?? (c === "NON_RENSEIGNE" ? "Motif non renseigné" : c)),
    parEtape: repartir(perdus, (d) => d.perteEtape ?? "—", (c) => LIBELLES_ETAPE[c as EtapeDossier] ?? c),
    concurrents: repartir(perdus.filter((d) => d.perteConcurrent), (d) => d.perteConcurrent),
  };
}

async function devisEnAttente(maintenant: Date) {
  const devis = await prisma.document.findMany({
    where: { type: "DEVIS", numero: { not: null }, archiveLe: null, statut: { in: ["GENERE", "ENVOYE"] }, dossier: { archiveLe: null, etape: { in: ["DEVIS_ENVOYE", "RELANCE", "SIMULATION", "QUALIFICATION"] } } },
    select: { id: true, numero: true, totalHt: true, dateEmission: true, dossier: { select: { id: true, clientNom: true, etape: true, accords: { where: { retireLe: null }, select: { id: true } }, espaces: { where: { archiveLe: null }, select: { devisConsultations: true, devisConsulteId: true } } } } },
  });
  const lignes = devis
    .filter((d) => d.dossier.accords.length === 0)
    .map((d) => ({ documentId: d.id, dossierId: d.dossier.id, client: d.dossier.clientNom, numero: d.numero, montant: d.totalHt, emisLe: d.dateEmission?.toISOString() ?? null, ancienneteJours: d.dateEmission ? Math.floor((maintenant.getTime() - d.dateEmission.getTime()) / 86_400_000) : null, consultations: d.dossier.espaces.reduce((t, e) => t + (e.devisConsulteId === d.id ? e.devisConsultations : 0), 0) }))
    .sort((a, b) => (b.ancienneteJours ?? 0) - (a.ancienneteJours ?? 0));
  return { nombre: lignes.length, montantTotal: somme(lignes.map((l) => l.montant)), ancienneteMoyenneJours: moyenne(lignes.map((l) => l.ancienneteJours ?? 0)), relusSansSignature: lignes.filter((l) => l.consultations > 0).length, lignes: lignes.slice(0, 30) };
}

function panierMoyen(leads: LeadCohorte[]) {
  const signes = leads.filter((l) => l.montantSigne !== null);
  return {
    global: moyenne(signes.map((l) => l.montantSigne!)),
    signes: signes.length,
    parFamille: [...new Set(signes.map((l) => l.famille))].map((f) => ({ famille: f, libelle: libelleFamille(f), signes: signes.filter((l) => l.famille === f).length, panier: moyenne(signes.filter((l) => l.famille === f).map((l) => l.montantSigne!)) })),
    parSource: [...new Set(signes.map((l) => l.source))].map((s) => ({ source: s, libelle: libelleSourceLead(s), signes: signes.filter((l) => l.source === s).length, panier: moyenne(signes.filter((l) => l.source === s).map((l) => l.montantSigne!)) })),
  };
}

function entonnoirsPar(leads: LeadCohorte[], cle: (l: LeadCohorte) => string | null, libelle: (c: string) => string) {
  const groupes = new Map<string, LeadCohorte[]>();
  for (const l of leads) groupes.set(cle(l) ?? "—", [...(groupes.get(cle(l) ?? "—") ?? []), l]);
  return [...groupes.entries()].map(([c, liste]) => ({ cle: c, libelle: libelle(c), ...entonnoirDe(liste), tauxSignatureSurLeads: taux(liste.filter((l) => l.signe).length, liste.length) })).sort((a, b) => b.recus - a.recus);
}

export async function analyseCommerciale(entree: z.output<typeof schemaPeriode>, maintenant: Date = new Date()) {
  const { periode, precedente } = resoudrePeriode(entree, maintenant);
  const [leads, leadsAvant, temps, pertes, attente] = await Promise.all([cohorte(periode), cohorte(precedente), tempsParEtape(periode, maintenant), motifsDePerte(periode), devisEnAttente(maintenant)]);
  const entonnoir = entonnoirDe(leads);
  const entonnoirAvant = entonnoirDe(leadsAvant);
  return {
    calculeLe: maintenant.toISOString(),
    periode: { du: periode.du, au: periode.au, libelle: periode.libelle, jours: periode.jours },
    precedente: { du: precedente.du, au: precedente.au },
    definitions: {
      cohorte: "Leads reçus dans la période (non archivés), suivis jusqu'à aujourd'hui.",
      appeles: "Au moins une note d'appel ou un appel enregistré.",
      joignables: "Au moins un appel avec une issue autre que « pas de réponse ».",
      photos: "Des photos dans le dossier (déposées par le client ou par Lucas).",
      simulations: "Une simulation faite sur le site, ou publiée dans l'espace du client.",
      devis: "Un devis numéroté émis sur son dossier.",
      signes: "Un bon pour accord, ou un dossier arrivé à « Signé » ou plus loin.",
      encaisses: "Dossier arrivé à « Encaissé ».",
      tempsParEtape: "Dossiers ouverts dans la période : durée passée dans chaque étape (moyenne et médiane, en jours), d'après les changements d'étape.",
      delaiRappel: "Entre la réception du lead et son premier appel noté.",
      devisEnAttente: "État du jour : devis émis, non remplacés, sans accord, sur un dossier encore avant signature.",
      panierMoyen: "Montant HT des bons pour accord des leads de la cohorte (franchise de TVA : HT = TTC).",
    },
    avertissement: avertissementMinces(leads.length, "leads"),
    entonnoir: { actuel: entonnoir, precedent: entonnoirAvant, taux: tauxEntonnoir(entonnoir), tauxPrecedents: tauxEntonnoir(entonnoirAvant), evolutionLeads: evolution(entonnoir.recus, entonnoirAvant.recus), evolutionSignes: evolution(entonnoir.signes, entonnoirAvant.signes) },
    parSource: entonnoirsPar(leads, (l) => l.source, libelleSourceLead),
    parCampagne: entonnoirsPar(leads.filter((l) => l.campagne), (l) => l.campagne, (c) => c),
    parPublicite: entonnoirsPar(leads.filter((l) => l.publicite), (l) => l.publicite, (c) => c),
    parFamille: entonnoirsPar(leads, (l) => l.famille, libelleFamille),
    tempsParEtape: temps,
    pertes,
    delaiRappel: effetDelaiRappel(leads),
    devisEnAttente: attente,
    panierMoyen: panierMoyen(leads),
  };
}

export const outilManagerCommercial = definirOutil({
  nom: "manager_commercial",
  titre: "Manager commercial : entonnoir, pertes, devis en attente",
  description:
    "Chiffres commerciaux calculés sur la base pour une période (défaut 30 jours) et la période précédente : entonnoir leads → appelés → joignables → photos → simulations → devis → signés → encaissés (par source, campagne, publicité, famille), taux et temps par étape, motifs de perte (étiquettes d'appel et motifs des dossiers), délai de premier rappel et son effet sur la signature, devis en attente (montant, ancienneté, relus sans signature), panier moyen. Rend les définitions utilisées : cite-les. Sert à « pourquoi je perds des affaires ? ».",
  niveau: "LECTURE",
  schema: schemaPeriode,
  executer: async (entree, contexte) => {
    const a = await analyseCommerciale(entree, contexte.maintenant);
    const e = a.entonnoir.actuel;
    const t = a.entonnoir.taux;
    const texte = [
      `Commercial, ${a.periode.libelle} (${a.periode.du} → ${a.periode.au}).${a.avertissement ? ` ${a.avertissement}` : ""}`,
      `Entonnoir : ${e.recus} leads reçus (${a.entonnoir.precedent.recus} avant) → ${e.appeles} appelés (${format.pourcent(t.appel)}) → ${e.joignables} joignables → ${e.photos} avec photos → ${e.simulations} avec simulation → ${e.devis} devis → ${e.signes} signés (${format.pourcent(t.signature)} des devis, ${format.pourcent(t.signatureSurLeads)} des leads ; ${a.entonnoir.precedent.signes} avant) → ${e.encaisses} encaissés.`,
      a.parSource.length ? `Par source : ${a.parSource.map((s) => `${s.libelle} ${s.recus} leads, ${s.devis} devis, ${s.signes} signés`).join(" · ")}.` : "",
      a.tempsParEtape.length ? `Temps par étape (jours, médiane) : ${a.tempsParEtape.map((x) => `${x.libelle} ${x.joursMedians}`).join(", ")}.` : "",
      `Pertes : ${pluriel(a.pertes.dossiersPerdus, "dossier")} et ${pluriel(a.pertes.leadsPerdus, "lead perdu", "leads perdus")}${a.pertes.parMotif.length ? ` (${a.pertes.parMotif.map((m) => `${m.libelle} ${m.valeur}`).join(", ")})` : ""} ; étiquettes d'appel : ${a.pertes.etiquettesAppel.map((m) => `${m.libelle} ${m.valeur}`).join(", ") || "aucune"}.`,
      `Délai de premier rappel : médiane ${a.delaiRappel.delaiMedianHeures ?? "—"} h ; ${a.delaiRappel.tranches.map((x) => `${x.libelle} : ${x.leads} leads, ${format.pourcent(x.tauxSignature)} signés`).join(" · ")}.`,
      `Devis en attente aujourd'hui : ${a.devisEnAttente.nombre} pour ${format.euros(a.devisEnAttente.montantTotal)}, ancienneté moyenne ${a.devisEnAttente.ancienneteMoyenneJours ?? "—"} jours, ${a.devisEnAttente.relusSansSignature} ${accord(a.devisEnAttente.relusSansSignature, "relu")} sans signature.`,
      `Panier moyen signé : ${a.panierMoyen.global !== null ? format.euros(a.panierMoyen.global) : "—"} sur ${pluriel(a.panierMoyen.signes, "signature")}${a.panierMoyen.parFamille.length ? ` (${a.panierMoyen.parFamille.map((f) => `${f.libelle} ${f.panier !== null ? format.euros(f.panier) : "—"}`).join(", ")})` : ""}.`,
    ].filter(Boolean).join("\n");
    return { texte, donnees: a, liens: [lien("Synthèse", `/synthese?du=${a.periode.du}&au=${a.periode.au}`), lien("Commercial", "/commercial")] };
  },
});

export const arrondiPct = arrondi;
