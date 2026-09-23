import { createHash } from "node:crypto";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { appliquerProposition } from "@/lib/mail/appliquer";
import { detailMail } from "@/lib/mail/detail";
import { CHAMPS_MAJ, CIBLES_MAJ, TYPE_MAJ_DEPUIS_MAIL, TYPE_REGLE_TRI, champDe, estSensibleMaj, schemaMaj, verifierValeur } from "@/lib/mail/propositions-maj";
import { rattacherALaMain } from "@/lib/mail/rattachement";
import { INTENTIONS, LIBELLES_INTENTION, annulerSnooze, classerIntention, deposerBrouillon, derangerMail, mailsNonClasses, rangerMail, rechercherMails, resumerFil, snoozer } from "@/lib/mail/v2";
import { proposer, rejeterProposition, vueProposition } from "@/lib/validation/service";
import { lireDateDictee } from "../agenda";
import { definirOutil, format, lien, type ResultatOutil } from "../definition";
import { CibleAmbigue, resoudreCible, schemaCible, texteAmbigu } from "./lecture";

/**
 * Les outils du mail (mission 9) : le CRM ne lit pas les mails, c'est Claude,
 * par ces outils. Il lit (fil, contexte, chronologie), il écrit ce qu'il a
 * compris (intention, attendu, résumé, dates), il DÉPOSE des cartes de mise à
 * jour et des brouillons — rien n'est modifié ni envoyé sans Lucas.
 */

const LIBELLE_CLASSE: Record<string, string> = { CLIENT: "client", ADMINISTRATIF: "administratif", HUMAIN: "à lire", BRUIT: "rangé" };
const heure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const court = (texte: string, n: number) => (texte.length > n ? `${texte.slice(0, n)}…` : texte);

type Ids = Awaited<ReturnType<typeof resoudreCible>>;
type Ciblage = { ids: Ids; ambigu?: undefined } | { ids?: undefined; ambigu: ResultatOutil };

async function ciblerContact(cible: z.output<typeof schemaCible>): Promise<Ciblage> {
  try {
    return { ids: await resoudreCible(cible) };
  } catch (e) {
    if (e instanceof CibleAmbigue) return { ambigu: { texte: texteAmbigu(e), donnees: e.candidats } };
    throw e;
  }
}

/** Le dernier mail échangé avec un contact (pour « le fil avec Rousse »). */
async function dernierMailDe(ids: { clientId: string | null; leadId: string | null; dossierId: string | null }): Promise<string | null> {
  const ou = [...(ids.dossierId ? [{ dossierId: ids.dossierId }] : []), ...(ids.clientId ? [{ clientId: ids.clientId }] : []), ...(ids.leadId ? [{ leadId: ids.leadId }] : [])];
  if (!ou.length) return null;
  const m = await prisma.message.findFirst({ where: { canal: "EMAIL", archiveLe: null, OR: ou }, orderBy: { recuLe: "desc" }, select: { id: true } });
  return m?.id ?? null;
}

/* ── Lecture ────────────────────────────────────────────────────────── */

export const outilLireMail = definirOutil({
  nom: "lire_mail",
  titre: "Lire un mail ou un fil complet",
  description:
    "Le fil complet d'un mail (identifiant rendu par « mails_a_traiter », « mails_non_classes » ou « rechercher_mails »), ou le dernier fil échangé avec un contact (par son nom). Rend : chaque message avec son texte et ses pièces, l'intention et ce qui est attendu, le résumé de fil et ses points en suspens, les dates extraites, les cartes de mise à jour en attente, les brouillons déposés, la fiche du client ou du lead, ses projets, et la chronologie du contact (mails, appels, espace, dossier, propositions validées). À appeler avant de résumer, de proposer une mise à jour, de déposer un brouillon.",
  niveau: "LECTURE",
  schema: z.object({ messageId: z.string().max(40).optional(), nom: z.string().max(120).optional().describe("À défaut d'identifiant : le contact, tel que dit (« Rousse »)."), chronologie: z.number().int().min(0).max(60).optional().describe("Nombre d'entrées de chronologie (30 par défaut).") }),
  executer: async (e) => {
    let messageId = e.messageId ?? null;
    if (!messageId) {
      if (!e.nom) throw new ErreurMetier("Donne l'identifiant du mail ou le nom du contact.", 400);
      const r = await ciblerContact({ nom: e.nom });
      if (r.ambigu) return r.ambigu;
      messageId = await dernierMailDe(r.ids);
      if (!messageId) throw new ErreurMetier(`Aucun mail échangé avec ${r.ids.nom}.`, 404);
    }
    const d = await detailMail(messageId);
    const chrono = d.chronologie.slice(0, e.chronologie ?? 30);
    const lignes = [
      `« ${d.objet} » — ${d.correspondant.nom ? `${d.correspondant.nom} <${d.correspondant.adresse}>` : d.correspondant.adresse}${d.classe ? ` · ${LIBELLE_CLASSE[d.classe] ?? d.classe}` : ""}${d.range ? " · rangé" : ""}${d.traite ? " · archivé" : ""}${d.snoozeJusqua ? ` · remis au ${heure(d.snoozeJusqua)}` : ""} [mail:${d.messageId}]`,
      d.intention ? `Intention : ${LIBELLES_INTENTION[d.intention as keyof typeof LIBELLES_INTENTION] ?? d.intention}${d.attendu ? ` — ${d.attendu}` : ""} (${d.intentionPar ?? "?"}, ${d.intentionLe ? heure(d.intentionLe) : "?"})` : "Intention : non classé (« classer_mail »).",
      d.resume ? `Résumé (${d.resume.par ?? "?"}, ${heure(d.resume.le)}${d.resume.perime ? ", PÉRIMÉ : de nouveaux messages depuis" : ""}) : ${d.resume.resume}${d.resume.pointsEnSuspens.length ? ` — En suspens : ${d.resume.pointsEnSuspens.map((p) => `${p.texte}${p.date ? ` (${p.date})` : ""}`).join(" ; ")}` : ""}` : d.fil.length > 2 ? "Pas de résumé (« resumer_fil »)." : "",
      d.datesExtraites.length ? `Dates extraites : ${d.datesExtraites.map((x) => `${x.date}${x.heure ? ` ${x.heure}` : ""} (${x.nature === "ECHEANCE" ? "échéance" : "disponibilité"}) — « ${x.passage} »`).join(" · ")}` : "",
      `Fil (${d.fil.length}) :\n${d.fil.map((m) => `[${heure(m.recuLe)}] ${m.sens === "SORTANT" ? (m.automatique ? "CoverSwap (automatique)" : "Lucas") : (m.deNom ?? m.de)} : ${court(m.texte.replace(/\s+/g, " ").trim(), 1200)}${m.pieces.length ? ` (pièces : ${m.pieces.map((p) => p.nom).join(", ")})` : ""} [message:${m.id}]`).join("\n")}`,
      d.propositions.length ? `Cartes en attente (${d.propositions.length}) : ${d.propositions.map((p) => `[proposition:${p.id}] ${p.titre}${p.sensible ? " (sensible : confirmation)" : ""}`).join(" · ")}` : "Aucune carte en attente.",
      d.brouillons.filter((b) => b.statut === "BROUILLON").length ? `Brouillons prêts : ${d.brouillons.filter((b) => b.statut === "BROUILLON").map((b) => `[brouillon:${b.id}] « ${b.objet ?? ""} » (${b.source === "ASSISTANT" ? "déposé par toi" : "IA du CRM"}) : ${court((b.texte ?? "").replace(/\s+/g, " "), 200)}`).join(" · ")}` : "",
      d.contexte ? `Contact : ${d.contexte.contact.nom} (${d.contexte.contact.type === "CLIENT" ? `client [client:${d.contexte.contact.clientId}]` : d.contexte.contact.type === "LEAD" ? `lead [lead:${d.contexte.contact.leadId}]` : "inconnu"})${d.contexte.contact.ville ? `, ${d.contexte.contact.ville}` : ""}${d.contexte.projets.length ? ` — projets : ${d.contexte.projets.map((p) => `${p.nom} (${p.etapeLibelle}, main : ${p.main}${p.devis ? `, devis ${p.devis.numero} ${p.devis.totalTtc} €` : ""}) [dossier:${p.dossierId}]`).join(" ; ")}` : " — aucun dossier"}` : "Contact inconnu (« rattacher_mail », ou lead à créer).",
      chrono.length ? `Chronologie (${chrono.length}/${d.chronologie.length}) :\n${chrono.map((c) => `${heure(c.le)} · ${c.titre}${c.texte ? ` — ${court(c.texte.replace(/\s+/g, " "), 160)}` : ""}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");
    return { texte: lignes, donnees: { ...d, fil: d.fil.map((m) => ({ ...m, texte: court(m.texte, 4000) })), chronologie: chrono }, liens: [lien("Ouvrir le mail", `/mail?mail=${d.messageId}`), ...(d.contexte?.projets[0] ? [lien("Dossier", `/dossiers?dossier=${d.contexte.projets[0].dossierId}`)] : [])] };
  },
});

export const outilMailsNonClasses = definirOutil({
  nom: "mails_non_classes",
  titre: "Les mails à classer",
  description: "Les mails reçus, conservés, sans intention (un par fil, le dernier reçu), avec leur texte : c'est la file de « Classe mes mails ». Lis-les, puis « classer_mail » en lot (intention, ce qui est attendu, dates extraites avec leur passage).",
  niveau: "LECTURE",
  schema: z.object({ limite: z.number().int().min(1).max(40).optional() }),
  executer: async ({ limite }) => {
    const mails = await mailsNonClasses({ limite: limite ?? 15 });
    if (!mails.length) return { texte: "Aucun mail à classer : tout ce qui est conservé porte une intention." };
    return {
      texte: `${mails.length} mail(s) à classer :\n${mails.map((m) => `[mail:${m.messageId}] ${m.deNom ?? m.de} — « ${m.objet ?? "(sans objet)"} » ${heure(m.recuLe)}${m.classe ? ` · ${LIBELLE_CLASSE[m.classe] ?? m.classe}` : ""}${m.contact ? ` · ${m.contact.nom}` : ""}${m.messagesDuFil > 1 ? ` · fil de ${m.messagesDuFil}` : ""}${m.pieces ? ` · ${m.pieces} pièce(s)` : ""}\n${court(m.texte.replace(/\s+/g, " "), 400)}`).join("\n\n")}`,
      donnees: mails,
      liens: [lien("Mail", "/mail")],
    };
  },
});

export const outilRechercherMails = definirOutil({
  nom: "rechercher_mails",
  titre: "Rechercher dans les mails",
  description: "Recherche plein texte dans l'objet, le corps, l'expéditeur et le contact rattaché, avec des dates facultatives : « le client qui voulait du marbre sur l'îlot » → mots « marbre îlot ». Chaque mot doit s'y trouver. Rend les mails avec le passage trouvé et l'identifiant pour « lire_mail ».",
  niveau: "LECTURE",
  schema: z.object({ texte: z.string().min(2).max(160), du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limite: z.number().int().min(1).max(30).optional() }),
  executer: async (e) => {
    const trouves = await rechercherMails({ texte: e.texte, du: e.du, au: e.au, limite: e.limite ?? 10 });
    if (!trouves.length) return { texte: `Rien pour « ${e.texte} »${e.du || e.au ? " sur cette période" : ""}. Essaie avec un seul mot, ou une autre orthographe.` };
    return {
      texte: `${trouves.length} mail(s) pour « ${e.texte} » :\n${trouves.map((m) => `[mail:${m.messageId}] ${m.sens === "ENTRANT" ? `de ${m.deNom ?? m.de}` : `à ${m.a[0] ?? "?"}`} — « ${m.objet ?? "(sans objet)"} » ${heure(m.recuLe)}${m.contact ? ` · ${m.contact.type === "CLIENT" ? "client" : "lead"} ${m.contact.nom} [${m.contact.type.toLowerCase()}:${m.contact.id}]` : ""}${m.passage ? ` — ${m.passage}` : ""}`).join("\n")}`,
      donnees: trouves,
      liens: trouves.slice(0, 3).map((m) => lien(m.objet ?? m.messageId, `/mail?mail=${m.messageId}`)),
    };
  },
});

/* ── Écriture réversible ────────────────────────────────────────────── */

const schemaDate = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), heure: z.string().regex(/^\d{2}:\d{2}$/).optional(), nature: z.enum(["DISPONIBILITE", "ECHEANCE"]), passage: z.string().min(3).max(300).describe("Le passage du mail qui donne cette date.") });
const schemaClassement = z.object({
  messageId: z.string().max(40),
  intention: z.enum([...INTENTIONS, "NON_CLASSE"]),
  attendu: z.string().max(300).optional().describe("Ce qui est attendu, concret : « Il demande le délai de pose »."),
  dates: z.array(schemaDate).max(12).optional().describe("Disponibilités et échéances trouvées dans le mail, chacune avec son passage."),
});

export const outilClasserMail = definirOutil({
  nom: "classer_mail",
  titre: "Classer des mails (intention, attendu, dates)",
  description: "Pose sur un ou plusieurs mails l'intention (REPONSE : on attend une réponse de Lucas ; ACTION : quelque chose à faire ; INFORMATION : rien à faire ; NON_CLASSE : retire l'intention), la ligne « ce qui est attendu », et les dates extraites (chacune avec son passage). Réversible (reclasser). Plus de trois mails → aperçu puis confirmation. Un lot compte pour une seule écriture.",
  niveau: "REVERSIBLE",
  schema: z.object({ mails: z.array(schemaClassement).min(1).max(60) }),
  masse: (e) => e.mails.length,
  apercu: async (e) => {
    const objets = await prisma.message.findMany({ where: { id: { in: e.mails.map((m) => m.messageId) } }, select: { id: true, objet: true, deNom: true, de: true } });
    return `Je vais classer ${e.mails.length} mails :\n${e.mails.map((m) => { const o = objets.find((x) => x.id === m.messageId); return `- ${o ? `${o.deNom ?? o.de} — « ${o.objet ?? "(sans objet)"} »` : m.messageId} → ${m.intention === "NON_CLASSE" ? "non classé" : LIBELLES_INTENTION[m.intention]}${m.attendu ? ` : ${m.attendu}` : ""}`; }).join("\n")}`;
  },
  executer: async (e) => {
    const r = await classerIntention(e.mails.map((m) => ({ messageId: m.messageId, intention: m.intention === "NON_CLASSE" ? null : m.intention, attendu: m.attendu ?? null, dates: m.dates ?? null })));
    return { texte: `${r.classes} mail(s) classé(s)${r.inconnus.length ? ` ; ${r.inconnus.length} identifiant(s) inconnu(s) : ${r.inconnus.join(", ")}` : ""}.`, donnees: r, liens: [lien("Mail", "/mail")] };
  },
});

export const outilResumerFil = definirOutil({
  nom: "resumer_fil",
  titre: "Résumer un fil",
  description: "Écrit le résumé d'un fil (3 lignes au plus) et ses points en suspens (question sans réponse, engagement pris, avec une date si le mail en donne une). Affiché en tête du fil dans l'onglet Mail ; se remplace. À faire sur tout fil de plus de deux messages, après « lire_mail ».",
  niveau: "REVERSIBLE",
  schema: z.object({ messageId: z.string().max(40), resume: z.string().min(5).max(600), points_en_suspens: z.array(z.object({ texte: z.string().min(2).max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })).max(10).optional() }),
  executer: async (e) => {
    const r = await resumerFil(e.messageId, { resume: e.resume, pointsEnSuspens: (e.points_en_suspens ?? []).map((p) => ({ texte: p.texte, date: p.date ?? null })) });
    return { texte: `Résumé posé sur le fil (${r.messages} messages)${e.points_en_suspens?.length ? `, ${e.points_en_suspens.length} point(s) en suspens` : ""}.`, donnees: r, liens: [lien("Ouvrir le mail", `/mail?mail=${e.messageId}`)] };
  },
});

const schemaCarte = z.object({
  cible: z.enum(CIBLES_MAJ).describe("DOSSIER (objet, montantEstime, dateChantier, prochaineAction, prochaineActionDate, clientAdresse, clientCp, clientVille, clientEmail, clientTelephone, prestations, note, photos), CLIENT (prenom, nomFamille, raisonSociale, adresse, codePostal, ville, notes, email, telephone), LEAD (prenom, nomFamille, ville, codePostal, typeProjet, notes, email, telephone), PROJET (styles, precisions, delai, metres : l'espace client du dossier)."),
  dossierId: z.string().max(40).optional(),
  clientId: z.string().max(40).optional(),
  leadId: z.string().max(40).optional(),
  champ: z.string().min(1).max(40),
  valeur: z.string().max(4000).describe("Toujours une chaîne : un nombre en chiffres (« 1450 »), une date AAAA-MM-JJ, une liste en JSON ([\"marbre\"]), « toutes » pour les photos."),
  libelle: z.string().max(160).optional().describe("Ce que la carte propose, en une phrase : « Teinte souhaitée : marbre blanc »."),
  passage: z.string().min(3).max(600).describe("Le passage du mail, cité tel quel, qui justifie la carte. Obligatoire."),
});

export const outilProposerMiseAJour = definirOutil({
  nom: "proposer_mise_a_jour",
  titre: "Déposer des cartes de mise à jour depuis un mail",
  description:
    "Dépose une ou plusieurs cartes « ce que ce mail change » sur un dossier, une fiche client, un lead ou le projet (espace client) : champ visé, valeur proposée, passage du mail qui la justifie. Ne modifie RIEN : Lucas valide (dans le mail, au pouce) ou toi par « valider_proposition » quand il le dit. Une carte sur un montant, une adresse ou une date de chantier est sensible (confirmation à la validation). Sans passage clair, pas de carte ; ne jamais déduire un prix.",
  niveau: "REVERSIBLE",
  schema: z.object({ messageId: z.string().max(40), propositions: z.array(schemaCarte).min(1).max(20) }),
  executer: async (e, contexte) => {
    const message = await prisma.message.findUnique({ where: { id: e.messageId }, select: { id: true, objet: true, clientId: true, dossierId: true, leadId: true } });
    if (!message) throw new ErreurMetier("Mail introuvable.", 404);
    const creees: { id: string; titre: string; sensible: boolean }[] = [];
    const deja: string[] = [];
    const refusees: string[] = [];
    for (const c of e.propositions) {
      const contenu = schemaMaj.parse({ messageId: e.messageId, cible: c.cible, dossierId: c.dossierId ?? (c.cible === "DOSSIER" || c.cible === "PROJET" ? message.dossierId : null), clientId: c.clientId ?? (c.cible === "CLIENT" ? message.clientId : null), leadId: c.leadId ?? (c.cible === "LEAD" ? message.leadId : null), champ: c.champ, valeur: c.valeur, libelle: c.libelle ?? null, passage: c.passage });
      try {
        verifierValeur(contenu);
      } catch (erreur) {
        refusees.push(`${c.champ} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
        continue;
      }
      const def = champDe(contenu.cible, contenu.champ)!;
      const titre = court(contenu.libelle ?? `${def.libelle} → ${contenu.valeur}`, 160);
      const { id, creee } = await proposer({
        type: TYPE_MAJ_DEPUIS_MAIL,
        titre,
        resume: `Mail « ${message.objet ?? "(sans objet)"} » : « ${court(contenu.passage, 300)} »${contexte.commande ? ` — demandé : « ${contexte.commande} »` : ""}`,
        contenu,
        cleUnicite: `maj:${e.messageId}:${contenu.cible}:${contenu.champ}:${createHash("sha1").update(contenu.valeur).digest("hex").slice(0, 10)}`,
        clientId: contenu.clientId ?? undefined,
        dossierId: contenu.dossierId ?? undefined,
        messageId: e.messageId,
      });
      if (creee) creees.push({ id, titre, sensible: estSensibleMaj(contenu) });
      else deja.push(titre);
    }
    const texte = [
      creees.length ? `${creees.length} carte(s) déposée(s), rien n'est modifié : ${creees.map((c) => `[proposition:${c.id}] ${c.titre}${c.sensible ? " (sensible)" : ""}`).join(" · ")}. Lucas valide dans le mail, ou dis « valider_proposition » avec les identifiants quand il l'a dit.` : "Aucune carte déposée.",
      deja.length ? `Déjà proposé (ou déjà écarté) : ${deja.join(" · ")}.` : "",
      refusees.length ? `Refusé : ${refusees.join(" · ")}.` : "",
    ].filter(Boolean).join("\n");
    return { texte, donnees: { creees, deja, refusees }, liens: [lien("Ouvrir le mail", `/mail?mail=${e.messageId}`)] };
  },
});

const schemaIds = z.object({ propositionIds: z.array(z.string().max(40)).min(1).max(20).describe("Identifiants rendus par « proposer_mise_a_jour » ou « lire_mail ».") });

async function chargerCartes(ids: string[]) {
  const cartes = await prisma.proposition.findMany({ where: { id: { in: ids } } });
  return cartes.map((c) => ({ ...vueProposition(c), contenuBrut: c.contenu, type: c.type }));
}

export const outilValiderProposition = definirOutil({
  nom: "valider_proposition",
  titre: "Valider des cartes (appliquer la mise à jour)",
  description: "Applique une ou plusieurs cartes en attente (mise à jour depuis un mail, règle de tri) : le dossier, la fiche, le lead ou le projet sont modifiés par le code de la fiche (mêmes règles : qui a la main, étape, contrôle de cohérence), et la chronologie le garde. Sensible quand une carte touche un montant, une adresse ou une date de chantier : aperçu puis confirmation. Plus de trois cartes → confirmation. Corrections possibles (« valeur »).",
  niveau: "REVERSIBLE",
  schema: schemaIds.extend({ corrections: z.object({ valeur: z.string().max(4000).optional() }).optional().describe("Pour une seule carte : la valeur corrigée par Lucas.") }),
  masse: (e) => e.propositionIds.length,
  sensible: async (e) => {
    const cartes = await prisma.proposition.findMany({ where: { id: { in: e.propositionIds }, type: TYPE_MAJ_DEPUIS_MAIL }, select: { contenu: true } });
    return cartes.some((c) => {
      const lu = schemaMaj.safeParse(JSON.parse(c.contenu));
      return lu.success && estSensibleMaj(lu.data);
    });
  },
  apercu: async (e) => {
    const cartes = await chargerCartes(e.propositionIds);
    return `Je vais appliquer ${cartes.length} carte(s) :\n${cartes.map((c) => `- ${c.titre}${c.sensible ? " (sensible)" : ""}${c.statut !== "EN_ATTENTE" ? ` — déjà ${c.statut.toLowerCase()}` : ""}`).join("\n")}${e.corrections?.valeur ? `\nValeur corrigée : ${e.corrections.valeur}` : ""}`;
  },
  executer: async (e) => {
    const resultats: { id: string; titre: string; statut: string; erreur: string | null }[] = [];
    for (const id of e.propositionIds) {
      try {
        const p = await appliquerProposition(id, e.corrections && e.propositionIds.length === 1 ? e.corrections : undefined);
        resultats.push({ id, titre: p.titre, statut: p.statut, erreur: p.erreurExecution ?? null });
      } catch (erreur) {
        const message = erreur instanceof Error ? erreur.message : String(erreur);
        const p = await prisma.proposition.findUnique({ where: { id }, select: { titre: true, statut: true } });
        resultats.push({ id, titre: p?.titre ?? id, statut: p?.statut ?? "?", erreur: message });
      }
    }
    const ok = resultats.filter((r) => r.statut === "EXECUTEE");
    const ko = resultats.filter((r) => r.statut !== "EXECUTEE");
    return { texte: [ok.length ? `Appliqué : ${ok.map((r) => r.titre).join(" · ")}.` : "", ko.length ? `Pas appliqué : ${ko.map((r) => `${r.titre} (${r.erreur ?? r.statut})`).join(" · ")}.` : ""].filter(Boolean).join("\n") || "Rien à faire.", donnees: resultats, liens: [lien("À valider", "/validation")] };
  },
});

export const outilIgnorerProposition = definirOutil({
  nom: "ignorer_proposition",
  titre: "Ignorer des cartes",
  description: "Écarte une ou plusieurs cartes en attente sans rien modifier (motif : MAL_LU, DEJA_A_JOUR, PAS_MAINTENANT, INUTILE, INEXACT…). Réversible en pratique : la carte reste lisible, rien n'est effacé ; une nouvelle carte identique n'est pas reproposée.",
  niveau: "REVERSIBLE",
  schema: schemaIds.extend({ motif: z.string().max(60).optional(), commentaire: z.string().max(300).optional() }),
  masse: (e) => e.propositionIds.length,
  executer: async (e) => {
    const faits: string[] = [];
    const refus: string[] = [];
    for (const id of e.propositionIds) {
      try {
        const p = await rejeterProposition(id, { motif: e.motif ?? "INUTILE", commentaire: e.commentaire ?? null });
        faits.push(p.titre);
      } catch (erreur) {
        refus.push(`${id} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
      }
    }
    return { texte: [faits.length ? `Ignoré : ${faits.join(" · ")}.` : "", refus.length ? `Pas ignoré : ${refus.join(" · ")}.` : ""].filter(Boolean).join("\n") || "Rien à faire.", donnees: { faits, refus } };
  },
});

export const outilDeposerBrouillon = definirOutil({
  nom: "deposer_brouillon",
  titre: "Déposer un brouillon de mail",
  description: "Dépose un texte que tu as écrit (voix de Lucas : court, direct, vouvoiement), attaché au mail auquel il répond ou au contact ; jamais envoyé. Il apparaît dans l'onglet Mail avec un bouton Envoyer. Un fait que le CRM ne donne pas s'écrit « [à compléter] » ; l'envoi reste bloqué tant qu'il en reste. Pour envoyer sur ordre de Lucas : « envoyer_mail » (aperçu puis confirmation) avec ce brouillonId.",
  niveau: "REVERSIBLE",
  schema: schemaCible.partial().extend({ messageId: z.string().max(40).optional().describe("Le mail reçu auquel le brouillon répond."), a: z.email().optional(), objet: z.string().min(1).max(200), texte: z.string().min(1).max(10_000) }),
  executer: async (e) => {
    let clientId = e.clientId ?? null;
    let leadId = e.leadId ?? null;
    let dossierId = e.dossierId ?? null;
    if (!e.messageId && e.nom) {
      const r = await ciblerContact({ nom: e.nom });
      if (r.ambigu) return r.ambigu;
      clientId = r.ids.clientId;
      leadId = r.ids.leadId;
      dossierId = r.ids.dossierId;
    }
    if (!e.messageId && !clientId && !leadId && !dossierId) throw new ErreurMetier("À qui ? Donne le mail auquel répondre (messageId), ou le contact (nom, clientId, leadId, dossierId).", 400);
    const b = await deposerBrouillon({ messageId: e.messageId ?? null, clientId, leadId, dossierId, a: e.a ?? null, objet: e.objet, texte: e.texte });
    return {
      texte: `Brouillon déposé [brouillon:${b.id}]${b.a ? ` pour ${b.a}` : " (destinataire à préciser)"}, objet « ${e.objet } »${b.aCompleter ? ` — ${b.aCompleter} « [à compléter] » à remplacer : l'envoi est bloqué tant qu'ils y sont` : ""}. Rien n'est parti : Lucas l'envoie depuis l'onglet Mail, ou dis « envoyer_mail » avec brouillonId ${b.id}${b.enReponseA ? ` et en_reponse_a ${b.enReponseA}` : ""} quand il le demande.`,
      donnees: b,
      liens: [e.messageId ? lien("Ouvrir le mail", `/mail?mail=${e.messageId}`) : lien("Mail", "/mail")],
    };
  },
});

export const outilSnoozerMail = definirOutil({
  nom: "snoozer_mail",
  titre: "Remettre un mail à plus tard",
  description: "Sort un mail d'« À traiter » jusqu'au moment dicté (« demain 9h », « lundi », « dans une semaine », « 2026-10-01 14:00 » ; sans heure : 9 h) ; il revient alors en tête, marqué « Revenu ». Réversible (annuler = true).",
  niveau: "REVERSIBLE",
  schema: z.object({ messageId: z.string().max(40), quand: z.string().max(60).optional(), annuler: z.boolean().optional() }),
  executer: async (e, contexte) => {
    if (e.annuler) {
      await annulerSnooze(e.messageId);
      return { texte: "Remise à plus tard annulée : le mail revient dans « À traiter » s'il attend quelque chose.", liens: [lien("Ouvrir le mail", `/mail?mail=${e.messageId}`)] };
    }
    if (!e.quand) throw new ErreurMetier("Quand ? (« demain 9h », « lundi », « dans une semaine »).", 400);
    const jusqua = lireDateDictee(e.quand, contexte.maintenant, 9);
    if (!jusqua) throw new ErreurMetier(`Je n'ai pas compris « ${e.quand} ».`, 400);
    if (jusqua <= contexte.maintenant) throw new ErreurMetier(`« ${e.quand} » est déjà passé.`, 400);
    await snoozer(e.messageId, jusqua);
    return { texte: `Remis au ${format.jour(jusqua)} à ${jusqua.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} : il reviendra en tête d'« À traiter », marqué « Revenu ».`, donnees: { jusqua: jusqua.toISOString() }, liens: [lien("Ouvrir le mail", `/mail?mail=${e.messageId}`)] };
  },
});

export const outilRattacherMail = definirOutil({
  nom: "rattacher_mail",
  titre: "Rattacher un mail à un client ou un dossier",
  description: "Rattache tout le fil à un client (fautes tolérées ; candidats si doute, jamais un choix à ta place) ou à un dossier : son adresse est ajoutée à la fiche, ses prochains mails sont reconnus seuls, le mail est tracé dans le dossier. Un lead sans fiche client : le fil lui est rattaché.",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({ messageId: z.string().max(40) }),
  executer: async (e) => {
    const r = await ciblerContact({ dossierId: e.dossierId, clientId: e.clientId, leadId: e.leadId, nom: e.nom });
    if (r.ambigu) return r.ambigu;
    let clientId = r.ids.clientId;
    if (!clientId && r.ids.dossierId) clientId = (await prisma.dossier.findUnique({ where: { id: r.ids.dossierId }, select: { clientId: true } }))?.clientId ?? null;
    if (clientId) {
      const fait = await rattacherALaMain(e.messageId, clientId, r.ids.dossierId ?? null);
      return { texte: `Fil rattaché à ${r.ids.nom}${fait.dossierId ? ", tracé dans son dossier" : ""} ; son adresse est sur la fiche : ses prochains mails seront reconnus seuls.`, donnees: { clientId, dossierId: fait.dossierId }, liens: [lien("Fiche client", `/clients/${clientId}`), ...(fait.dossierId ? [lien("Dossier", `/dossiers?dossier=${fait.dossierId}`)] : [])] };
    }
    if (r.ids.leadId) {
      const message = await prisma.message.findUnique({ where: { id: e.messageId }, select: { id: true, canal: true, filCanal: true } });
      if (!message) throw new ErreurMetier("Mail introuvable.", 404);
      const fil = message.filCanal ? { canal: message.canal, filCanal: message.filCanal } : { id: message.id };
      const { count } = await prisma.message.updateMany({ where: fil, data: { leadId: r.ids.leadId, classe: "CLIENT", classeMotif: "Rattaché au lead à la main.", classePar: "LUCAS", statut: "A_TRIER", rangeLe: null, rangePar: null } });
      return { texte: `${count} message(s) rattaché(s) au lead ${r.ids.nom}.`, donnees: { leadId: r.ids.leadId }, liens: [lien("Lead", `/leads?lead=${r.ids.leadId}`)] };
    }
    throw new ErreurMetier(`${r.ids.nom} n'a ni fiche client ni lead.`, 409);
  },
});

export const outilRangerMail = definirOutil({
  nom: "ranger_mail",
  titre: "Ranger des mails (lu + libellé)",
  description: "Range un ou plusieurs fils à la main : lus, libellé « CoverSwap/Rangé », hors de la boîte (dans Gmail aussi si le rangement est actif). Réversible (annuler = true). Par identifiants, ou par expéditeur (adresse exacte ou « @domaine ») : alors aperçu puis confirmation. Trois rangements de la même adresse → le CRM propose une règle (« proposer_regle » pour la poser tout de suite).",
  niveau: "REVERSIBLE",
  schema: z.object({ messageIds: z.array(z.string().max(40)).max(100).optional(), expediteur: z.string().max(160).optional(), motif: z.string().max(200).optional(), annuler: z.boolean().optional() }),
  masse: (e) => e.messageIds?.length ?? 0,
  sensible: (e) => Boolean(e.expediteur),
  apercu: async (e) => {
    const cibles = await ciblesRangement(e);
    return cibles.length ? `Je vais ${e.annuler ? "remettre" : "ranger"} ${cibles.length} fil(s) : ${cibles.slice(0, 15).map((m) => `${m.deNom ?? m.de} — « ${m.objet ?? "(sans objet)"} »`).join(" · ")}${cibles.length > 15 ? " …" : ""}. ${e.annuler ? "" : "Réversible ; rien n'est supprimé."}` : "Rien à ranger avec ces critères.";
  },
  executer: async (e) => {
    const cibles = await ciblesRangement(e);
    if (!cibles.length) return { texte: "Rien à ranger : aucun mail ne correspond (ou déjà rangés)." };
    let total = 0;
    for (const m of cibles) total += e.annuler ? (await derangerMail(m.id)).remis : (await rangerMail(m.id, e.motif ?? (e.expediteur ? `Rangé à la main : ${e.expediteur}` : "Rangé à la main"))).ranges;
    return { texte: `${total} mail(s) ${e.annuler ? "remis dans la boîte" : "rangé(s) (lus, libellé CoverSwap/Rangé)"} sur ${cibles.length} fil(s). ${e.annuler ? "" : "Réversible : « ranger_mail » avec annuler = true."}`, donnees: { fils: cibles.map((m) => m.id), messages: total }, liens: [lien("Mail", "/mail")] };
  },
});

async function ciblesRangement(e: { messageIds?: string[]; expediteur?: string; annuler?: boolean }) {
  const ou = [];
  if (e.messageIds?.length) ou.push({ id: { in: e.messageIds } });
  if (e.expediteur) {
    const cible = e.expediteur.trim().toLowerCase();
    ou.push(cible.startsWith("@") ? { de: { endsWith: cible } } : { de: cible });
  }
  if (!ou.length) throw new ErreurMetier("Donne des identifiants de mails ou un expéditeur.", 400);
  const messages = await prisma.message.findMany({ where: { canal: "EMAIL", sens: "ENTRANT", archiveLe: null, OR: ou, ...(e.annuler ? { rangeLe: { not: null } } : { rangeLe: null }) }, orderBy: { recuLe: "desc" }, take: 100, select: { id: true, filCanal: true, de: true, deNom: true, objet: true } });
  const parFil = new Map<string, (typeof messages)[number]>();
  for (const m of messages) if (!parFil.has(m.filCanal ?? m.id)) parFil.set(m.filCanal ?? m.id, m);
  return [...parFil.values()];
}

export const outilProposerRegle = definirOutil({
  nom: "proposer_regle",
  titre: "Proposer une règle de tri",
  description: "Dépose une règle d'expéditeur à valider par Lucas (adresse exacte ou « @domaine ») : RANGER (toujours rangé, jamais un client), NE_JAMAIS_RANGER, ADMINISTRATIF. Rien n'est posé tant qu'elle n'est pas validée (dans l'onglet Mail, Paramètres → Mail, ou « valider_proposition »). Pour « range tout ce qui vient de TikTok pour toujours » : « ranger_mail » avec l'expéditeur, puis cette règle.",
  niveau: "REVERSIBLE",
  schema: z.object({ cible: z.string().min(3).max(160), action: z.enum(["RANGER", "NE_JAMAIS_RANGER", "ADMINISTRATIF"]), motif: z.string().min(2).max(300) }),
  executer: async (e, contexte) => {
    const cible = e.cible.trim().toLowerCase();
    if (!cible.includes("@")) throw new ErreurMetier("La cible est une adresse (« x@y.fr ») ou un domaine (« @y.fr »).", 400);
    const { id, creee } = await proposer({
      type: TYPE_REGLE_TRI,
      titre: `${e.action === "RANGER" ? "Toujours ranger" : e.action === "ADMINISTRATIF" ? "Toujours classer en administratif" : "Ne jamais ranger"} les mails de ${cible}`,
      resume: `${e.motif}${contexte.commande ? ` — demandé : « ${contexte.commande} »` : ""}`,
      contenu: { cible, action: e.action, motif: e.motif, origine: "ASSISTANT" },
      cleUnicite: `regle-tri:${cible}:${e.action}`,
    });
    return { texte: creee ? `Règle proposée [proposition:${id}] : ${e.action} pour ${cible}. Elle attend la validation de Lucas (onglet Mail, Paramètres → Mail) ; si Lucas l'a déjà dite, « valider_proposition ».` : `Cette règle est déjà proposée ou déjà décidée [proposition:${id}].`, donnees: { propositionId: id, creee }, liens: [lien("Paramètres → Mail", "/parametres#mail")] };
  },
});

export const OUTILS_MAIL = [outilLireMail, outilMailsNonClasses, outilRechercherMails, outilClasserMail, outilResumerFil, outilProposerMiseAJour, outilValiderProposition, outilIgnorerProposition, outilDeposerBrouillon, outilSnoozerMail, outilRattacherMail, outilRangerMail, outilProposerRegle];

export { CHAMPS_MAJ };
