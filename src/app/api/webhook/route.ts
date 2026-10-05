import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { rattacherLead } from "@/lib/clients/identification";
import { classerLeadSansBloquer } from "@/lib/prospects/qualification";
import { envoyerAccuseDeReception } from "@/lib/sms/accuse";
import { secretWebhookValide, secretsWebhook } from "@/lib/acces/secret-webhook";
import { LIMITE_PAR_CONTACT, contactDepasseLaLimite, ipDepasseLaLimite, ipDuVisiteur } from "@/lib/acces/limite-site";
import { enregistrerImageBase64, enregistrerPhotosLead } from "@/lib/simulations/images";
import { rattacherSimulationsSite } from "@/lib/site/simulations";
import { ouvrirDossierAutomatique } from "@/lib/dossiers/depuis-lead";
import { notifierDemandeDuSite } from "@/lib/prospects/notification";
import { estDemandeDeDevis } from "@/lib/prospects/constantes";
import { reperDoublonProbable } from "@/lib/prospects/doublons";
import type { Priorite } from "@/lib/prospects/priorite";
import { pluriel } from "@/lib/commun/format";
import { CRENEAUX_RAPPEL_SITE, momentDuRappel, rappelDuCreneau } from "@/lib/commercial/quand";
import { complementsDeLaDemande, contactNeuf, ouvrirEspaceALEnvoi, suivreLeRappel, type EspaceALEnvoi } from "@/lib/site/tunnel";

// Accept both Meta/n8n format AND internal format
const webhookSchema = z.object({
  // Meta Lead Ads fields (via n8n)
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  form_name: z.string().optional(),
  ad_name: z.string().optional(),
  campaign_name: z.string().optional(),
  // Internal CoverSwap fields
  nom: z.string().optional(),
  prenom: z.string().optional(),
  telephone: z.string().optional(),
  ville: z.string().optional(),
  codePostal: z.string().optional(),
  source: z.string().optional(),
  typeProjet: z.string().optional(),
  referenceChoisie: z.string().optional(),
  mlEstimes: z.number().optional(),
  prixDevis: z.number().optional(),
  lienSimulation: z.string().optional(),
  notes: z.string().optional(),
  // Champs structurés du site (17/09/2026)
  message: z.string().max(4000).optional(),
  styleSouhaite: z.string().max(200).optional(),
  // Identifiant du parcours navigateur : simulation puis devis = même fiche
  parcoursId: z.string().regex(/^[0-9a-fA-F-]{16,64}$/, "parcoursId invalide").optional(),
  // Photos jointes à la demande (data URL), 4 au plus
  photos: z.array(z.string()).max(4).optional(),
  // Simulations faites sur le site avant les coordonnées (SimulationSite), à rattacher
  simulationIds: z.array(z.string().max(40)).max(10).optional(),
  // Consentement aux mails commerciaux : case distincte du formulaire, jamais présumé
  consentementMail: z.boolean().optional(),
  consentementTexte: z.string().max(1000).optional(),
  // Simulation images (base64 data URLs or raw base64)
  imageBefore: z.string().optional(),
  imageAfter: z.string().optional(),
  imageOriginal: z.string().optional(),
  // Mission 16 (partie 4) : le tunnel du site. Une valeur illisible est ignorée (`catch`), jamais une raison de perdre le lead.
  rappelCreneau: z.enum(CRENEAUX_RAPPEL_SITE).optional().catch(undefined),
  estimationMin: z.number().int().min(1).max(1_000_000).optional().catch(undefined),
  estimationMax: z.number().int().min(1).max(1_000_000).optional().catch(undefined),
  formatPiece: texteCourt(40),
  canal: texteCourt(60),
  pageEntree: texteCourt(200),
  // Formulaire de /pro : surface approximative, en m² OU en mètres linéaires.
  surfaceM2: z.number().positive().max(100_000).optional().catch(undefined),
  surfaceMl: z.number().positive().max(100_000).optional().catch(undefined),
  // Le site AFFICHERA le lien de l'espace (formulaire après un rendu) : sans ce drapeau, le site ne l'ouvre pas (ancien
  // site, demande après un échec de génération) — rien ne dirait alors au dossier un « lien affiché » qui ne l'est pas.
  afficherLienEspace: z.boolean().optional().catch(undefined),
});

/** Les listes Leads et Dossiers se relisent ; jamais bloquant (le lead est déjà écrit, un 500 ferait renvoyer la demande). */
function rafraichirLesEcrans() {
  try {
    revalidatePath("/leads");
    revalidatePath("/dossiers");
  } catch (erreur) {
    console.warn("[webhook] écrans non rafraîchis :", erreur instanceof Error ? erreur.message : erreur);
  }
}

/** Un texte facultatif coupé à `max` caractères (jamais refusé : le lead passe avant la forme). */
function texteCourt(max: number) {
  return z
    .string()
    .optional()
    .catch(undefined)
    .transform((v) => v?.trim().slice(0, max) || undefined);
}

function normalizeData(body: z.infer<typeof webhookSchema>) {
  const isMeta = !!(body.first_name || body.last_name || body.phone);

  const prenom = body.prenom || body.first_name || "Inconnu";
  const nom = body.nom || body.last_name || "Inconnu";
  const telephone = body.telephone || body.phone || "";
  const email = body.email || undefined;
  const ville = body.ville || body.city || "Non renseignée";
  const source = body.source || (isMeta ? "META_ADS" : "AUTRE");

  const metaNotes = [
    body.form_name ? `Formulaire: ${body.form_name}` : null,
    body.ad_name ? `Pub: ${body.ad_name}` : null,
    body.campaign_name ? `Campagne: ${body.campaign_name}` : null,
  ].filter(Boolean).join(" | ");

  const surface = body.surfaceM2 ? `Surface approximative : ${body.surfaceM2} m²` : null;
  const notes = [body.notes || metaNotes || null, surface].filter(Boolean).join(" — ") || undefined;
  // Une fourchette n'est gardée qu'entière et dans l'ordre.
  const estimation = body.estimationMin && body.estimationMax && body.estimationMin <= body.estimationMax ? { estimationMin: body.estimationMin, estimationMax: body.estimationMax } : { estimationMin: undefined, estimationMax: undefined };

  return {
    prenom, nom, telephone, email, ville,
    codePostal: body.codePostal,
    source,
    typeProjet: body.typeProjet || "CUISINE",
    referenceChoisie: body.referenceChoisie,
    prixDevis: body.prixDevis,
    mlEstimes: body.mlEstimes ?? body.surfaceMl,
    lienSimulation: body.lienSimulation,
    notes,
    message: body.message?.trim() || undefined,
    styleSouhaite: body.styleSouhaite?.trim() || undefined,
    parcoursId: body.parcoursId,
    formulaire: body.form_name,
    publicite: body.ad_name,
    campagne: body.campaign_name,
    ...estimation,
    formatPiece: body.formatPiece,
    canal: body.canal,
    pageEntree: body.pageEntree,
  };
}

function calculateScore(data: ReturnType<typeof normalizeData>): number {
  let score = 0;
  const sourceScores: Record<string, number> = {
    META_ADS: 15, TIKTOK: 10, INSTAGRAM: 15,
    ORGANIQUE: 25, REFERENCE: 40, AUTRE: 10,
    SITE_SIMULATEUR: 30, SITE_DEVIS: 45, SITE_CONTACT: 35, SITE_PRO: 40,
  };
  score += sourceScores[data.source] || 10;

  const hour = new Date().getHours();
  if ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18)) score += 10;

  const nearMontpellier = ["montpellier", "lattes", "perols", "castelnau", "mauguio", "palavas", "grabels", "juvignac", "saint-jean-de-vedas", "villeneuve-les-maguelone"];
  const majorCities = ["nimes", "beziers", "sete", "perpignan", "narbonne", "ales", "lunel"];
  const cityLower = data.ville.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (nearMontpellier.some(c => cityLower.includes(c))) score += 20;
  else if (majorCities.some(c => cityLower.includes(c))) score += 10;

  const projectScores: Record<string, number> = {
    CUISINE: 25, SDB: 20, MEUBLES: 15, PRO: 20, AUTRE: 10,
  };
  score += projectScores[data.typeProjet] || 10;

  if (data.email) score += 5;
  if (data.telephone && data.telephone.length >= 10) score += 5;

  return Math.min(score, 100);
}

// Normalize phone for dedup comparison: keep only digits, strip leading 0/33
function normalizePhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("33") && digits.length === 11) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

const FENETRE_PARCOURS_MS = 24 * 60 * 60 * 1000;
const LIBELLES_PROJET_ACCUSE: Record<string, string> = { CUISINE: "cuisine", SDB: "salle de bain", MEUBLES: "meubles", PRO: "local professionnel", AUTRE: "autre" };

async function findExistingLead(telephone: string, email?: string, parcoursId?: string) {
  const normalized = normalizePhone(telephone);
  const memeContact = (l: { email: string | null; telephone: string }) =>
    (!!email && !!l.email && l.email.toLowerCase() === email.toLowerCase()) || (!!normalized && normalizePhone(l.telephone) === normalized);
  // Même parcours navigateur (simulation puis devis 1-clic) : même fiche, à condition
  // que ce soit la même personne (téléphone ou e-mail) — un appareil partagé ne fusionne pas deux contacts.
  if (parcoursId) {
    const memeParcours = await prisma.lead.findMany({
      where: { parcoursId, createdAt: { gte: new Date(Date.now() - FENETRE_PARCOURS_MS) } },
      orderBy: { createdAt: "desc" },
    });
    const meme = memeParcours.find(memeContact);
    if (meme) return meme;
  }
  const candidates = await prisma.lead.findMany({
    where: {
      OR: [
        telephone ? { telephone } : undefined,
        email ? { email } : undefined,
      ].filter(Boolean) as { telephone?: string; email?: string }[],
    },
    orderBy: { createdAt: "desc" },
  });
  // Refine by normalized phone (covers spaces, + prefix, etc.)
  return candidates.find(memeContact) || null;
}

/** Demandes récentes d'un même contact (téléphone ou e-mail) : la limite anti-abus par contact. */
async function demandesRecentesDuContact(telephone: string, email?: string): Promise<number> {
  const depuis = new Date(Date.now() - LIMITE_PAR_CONTACT.fenetreMs);
  const conditions = [telephone ? { telephone } : undefined, email ? { email } : undefined].filter(Boolean) as { telephone?: string; email?: string }[];
  if (conditions.length === 0) return 0;
  const leads = await prisma.lead.findMany({ where: { OR: conditions }, select: { id: true } });
  if (leads.length === 0) return 0;
  return prisma.interaction.count({ where: { leadId: { in: leads.map((l) => l.id) }, createdAt: { gte: depuis }, type: "NOTE" } });
}

export async function POST(request: NextRequest) {
  try {
    if (secretsWebhook().length === 0) {
      console.error("WEBHOOK_SECRET is not configured");
      return NextResponse.json({ error: "Configuration serveur manquante" }, { status: 500 });
    }
    if (!secretWebhookValide(request.headers.get("x-webhook-secret"))) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    // Limite par visiteur : l'IP transmise par le site (secret vérifié, donc de confiance), sinon l'appelant.
    const ipVisiteur = ipDuVisiteur(request.headers);
    if (ipDepasseLaLimite(ipVisiteur)) {
      console.warn(`[webhook] limite par IP atteinte (${ipVisiteur})`);
      return NextResponse.json({ error: "Trop de demandes depuis cette adresse. Réessayez dans quelques minutes." }, { status: 429 });
    }

    const body = await request.json();

    // ── Health check shortcut: webhook is reachable + secret OK, skip DB write ──
    if (body && typeof body === "object" && (body as Record<string, unknown>).__health_check === true) {
      return NextResponse.json({ ok: true, health: "webhook-reachable", at: new Date().toISOString() });
    }

    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error.issues }, { status: 400 });
    }

    const data = normalizeData(parsed.data);

    if (!data.nom || (data.nom === "Inconnu" && !data.telephone)) {
      return NextResponse.json({ error: "Nom ou téléphone requis au minimum" }, { status: 400 });
    }

    // Limite par contact : un même téléphone / e-mail ne peut pas envoyer sans fin.
    if (contactDepasseLaLimite(await demandesRecentesDuContact(data.telephone, data.email))) {
      console.warn(`[webhook] limite par contact atteinte (${data.telephone} / ${data.email ?? "-"})`);
      return NextResponse.json({ error: "Nous avons déjà bien reçu vos demandes. Nous vous rappelons très vite." }, { status: 429 });
    }

    // ── Mission 16 (partie 4) : le rappel demandé sur le site, daté ici (heure de Paris, week-end → lundi) ──
    const maintenant = new Date();
    const rappelLe = parsed.data.rappelCreneau ? rappelDuCreneau(parsed.data.rappelCreneau, maintenant) : null;
    // Une seule règle (prospects/constantes) : formulaire de /devis (ancien), de /pro, ou de /contact avec un projet.
    const demandeDeDevis = estDemandeDeDevis({ source: data.source, typeProjet: data.typeProjet });
    // Un message écrit sur le site (devis, pro, contact) : Lucas est prévenu même pour un contact déjà connu.
    const demandeEcrite = demandeDeDevis || data.source === "SITE_CONTACT";

    // ── DEDUP: same browser journey, then existing lead by phone OR email ──
    const existing = await findExistingLead(data.telephone, data.email, data.parcoursId);

    let lead;
    let isNew = false;
    if (existing) {
      lead = existing;
      // Enrichissement: met à jour les champs manquants si le nouveau payload les a
      const updates: Record<string, unknown> = {};
      if (!existing.email && data.email) updates.email = data.email;
      if (existing.ville === "Non renseignée" && data.ville !== "Non renseignée") updates.ville = data.ville;
      if (!existing.codePostal && data.codePostal) updates.codePostal = data.codePostal;
      // Enrichir prénom/nom si le lead existant est "Inconnu"
      if (existing.prenom === "Inconnu" && data.prenom && data.prenom !== "Inconnu") updates.prenom = data.prenom;
      if (existing.nom === "Inconnu" && data.nom && data.nom !== "Inconnu") updates.nom = data.nom;
      if (!existing.referenceChoisie && data.referenceChoisie) updates.referenceChoisie = data.referenceChoisie;
      if (!existing.mlEstimes && data.mlEstimes) updates.mlEstimes = data.mlEstimes;
      if (!existing.prixDevis && data.prixDevis) updates.prixDevis = data.prixDevis;
      if (!existing.message && data.message) updates.message = data.message;
      if (!existing.styleSouhaite && data.styleSouhaite) updates.styleSouhaite = data.styleSouhaite;
      if (!existing.parcoursId && data.parcoursId) updates.parcoursId = data.parcoursId;
      // Mission 16 : la dernière estimation vue compte ; l'origine reste celle de la première visite ; un rappel demandé remplace l'ancien.
      if (data.estimationMin && data.estimationMax) Object.assign(updates, { estimationMin: data.estimationMin, estimationMax: data.estimationMax, formatPiece: data.formatPiece ?? null });
      if (!existing.canal && data.canal) updates.canal = data.canal;
      if (!existing.pageEntree && data.pageEntree) updates.pageEntree = data.pageEntree;
      if (rappelLe) updates.rappelLe = rappelLe;
      // Si le nouveau lead est une demande de devis (formulaire ou pro), élever le statut
      if (demandeDeDevis && existing.statut === "NOUVEAU") {
        updates.statut = "DEVIS_DEMANDE";
      }
      // Mission 18 (B12) : une demande de devis d'un contact qui n'avait écrit que pour « Autre » lui donne son projet — son
      // intention (« Devis ») se lit sur ses faits, plus sur un statut que le dossier ouvert par la demande remplace.
      // (seulement un projet que le site a dit : pas la valeur par défaut de normalizeData)
      if (demandeDeDevis && (!existing.typeProjet || existing.typeProjet === "AUTRE") && parsed.data.typeProjet && parsed.data.typeProjet !== "AUTRE") {
        updates.typeProjet = data.typeProjet;
      }
      if (Object.keys(updates).length > 0) {
        lead = await prisma.lead.update({ where: { id: existing.id }, data: updates });
      }
    } else {
      isNew = true;
      const scoreSignature = calculateScore(data);
      lead = await prisma.lead.create({
        data: { ...data, ipOrigine: ipVisiteur === "inconnue" ? null : ipVisiteur, scoreSignature, rappelLe },
      });
    }

    // ── Client pérenne : retrouvé par e-mail ou téléphone, sinon créé ──
    // Jamais bloquant : un lead sans client est rattrapé par le travail périodique.
    const consentement = parsed.data.consentementMail === undefined ? null : parsed.data.consentementMail ? "ACCORDE" : "REFUSE";
    try {
      await rattacherLead(
        prisma,
        lead.id,
        parsed.data.consentementMail === undefined
          ? null
          : {
              accorde: parsed.data.consentementMail,
              moyen: "FORMULAIRE_SITE",
              recueilliLe: new Date(),
              preuve: parsed.data.consentementTexte ?? `Formulaire du site (${data.source})`,
            }
      );
    } catch (erreurClient) {
      console.error("[webhook] rattachement du client (non bloquant) :", erreurClient);
    }

    // ── Priorité de rappel : classée à l'arrivée, jamais bloquante ──
    const qualification = await classerLeadSansBloquer(lead.id);

    // ── Même nom, même ville, autre numéro et autre e-mail : doublon probable, signalé (jamais fusionné seul) ──
    let doublon: { doublonDe: string; motif: string } | null = null;
    if (isNew) {
      try {
        doublon = await reperDoublonProbable(lead.id);
      } catch (erreurDoublon) {
        console.error("[webhook] recherche de doublon (non bloquant) :", erreurDoublon);
      }
    }
    // Le client avait déjà son espace : ses nouvelles simulations y entrent, et l'alerte dédiée part de là.
    const avaitUnEspace = !isNew && (await prisma.espaceClient.count({ where: { dossier: { leadId: lead.id, archiveLe: null } } })) > 0;

    // ── Accusé de réception par SMS : seul envoi automatique, nouveau contact seulement ──
    if (isNew && qualification?.priorite !== "A_ECARTER") await envoyerAccuseDeReception(lead.id);

    // ── Photos jointes à la demande (formulaire de devis) ──
    const photosEcrites = parsed.data.photos?.length ? await enregistrerPhotosLead(lead.id, parsed.data.photos) : 0;

    // ── Simulations faites avant les coordonnées : rattachées à la fiche avec leurs images ──
    let simulationsRattachees: string[] = [];
    try {
      simulationsRattachees = await rattacherSimulationsSite(lead.id, data.parcoursId, parsed.data.simulationIds ?? []);
    } catch (erreurSimulations) {
      console.error("[webhook] rattachement des simulations du site (non bloquant) :", erreurSimulations);
    }

    // ── Handle simulation (images + record) ──
    const hasImages = !!(parsed.data.imageBefore || parsed.data.imageAfter);
    const isSimulation = data.source === "SITE_SIMULATEUR" || hasImages;
    // Mission 16 : estimation vue, rappel demandé, origine de la visite — à la suite de la note, quelle qu'elle soit.
    const complements = complementsDeLaDemande({ ...data, rappelLe }, maintenant).map((ligne) => ` — ${ligne}`).join("");

    if (simulationsRattachees.length > 0 && !hasImages) {
      await prisma.interaction.create({
        data: {
          type: "NOTE",
          contenu: `${isNew ? "Lead reçu via le simulateur" : "Nouvelle demande via le simulateur"} (${data.source}) — ${pluriel(simulationsRattachees.length, "simulation rattachée", "simulations rattachées")}${data.message ? ` — Message : ${data.message}` : ""}${complements}`,
          leadId: lead.id,
        },
      });
    } else if (isSimulation) {
      const simulation = await prisma.simulation.create({
        data: {
          leadId: lead.id,
          source: data.source,
          referenceChoisie: data.referenceChoisie,
          mlEstimes: data.mlEstimes,
          prixDevis: data.prixDevis,
          lienSimulation: data.lienSimulation,
          notes: data.notes,
        },
      });

      const dossier = `${lead.id}/${simulation.id}`;
      const imageBeforePath = parsed.data.imageBefore ? await enregistrerImageBase64(parsed.data.imageBefore, dossier, "before.jpg") : null;
      const imageAfterPath = parsed.data.imageAfter ? await enregistrerImageBase64(parsed.data.imageAfter, dossier, "after.jpg") : null;
      const imageOriginalPath = parsed.data.imageOriginal ? await enregistrerImageBase64(parsed.data.imageOriginal, dossier, "original.jpg") : null;

      if (imageBeforePath || imageAfterPath || imageOriginalPath) {
        await prisma.simulation.update({
          where: { id: simulation.id },
          data: { imageBeforePath, imageAfterPath, imageOriginalPath },
        });
      }

      await prisma.interaction.create({
        data: {
          type: "NOTE",
          contenu: `Nouvelle simulation (${data.source})${data.referenceChoisie ? ` — réf. ${data.referenceChoisie}` : ""}${data.notes ? ` — ${data.notes}` : ""}${complements}`,
          leadId: lead.id,
        },
      });
    } else {
      const prefix = isNew ? "Lead reçu via webhook" : "Nouveau contact du client";
      const details = [data.notes, data.message ? `Message : ${data.message}` : null, data.styleSouhaite ? `Style : ${data.styleSouhaite}` : null, photosEcrites ? `${pluriel(photosEcrites, "photo jointe", "photos jointes")}` : null]
        .filter(Boolean)
        .join(" — ");
      await prisma.interaction.create({
        data: {
          type: "NOTE",
          contenu: `${prefix} (${data.source})${details ? ` — ${details}` : ""}${complements}`,
          leadId: lead.id,
        },
      });
    }

    // ── Mission 18 (A2) : une simulation, des photos ou une demande de devis venues du site ouvrent le dossier tout
    //    seuls (Qualification, « Appeler : … » pour aujourd'hui, ou « Rappeler » à l'heure demandée) ; « Ouvrir un
    //    dossier » ne sert plus qu'à un lead qualifié au téléphone. Un contact qui a déjà un dossier vivant : photo avant,
    //    rendus et photos y sont rangés (et rejoignent son espace). Ni hors zone, ni lead Meta (rien fait sur le site). ──
    const aSimule = isSimulation || simulationsRattachees.length > 0 || photosEcrites > 0;
    const tunnel = data.source === "SITE_SIMULATEUR" && parsed.data.afficherLienEspace === true;
    // Le tunnel n'affiche le lien qu'à un contact neuf : lu AVANT l'ouverture du dossier, qui le rendrait « connu ».
    const neuf = tunnel && isNew ? await contactNeuf(lead.id).catch(() => false) : false;
    const ouverture = aSimule || demandeDeDevis ? await ouvrirDossierAutomatique(lead.id, { demande: demandeDeDevis }) : null;
    // ── Mission 16 (partie 4) : après un rendu du simulateur, l'espace client s'ouvre et son lien revient au site, qui
    //    l'AFFICHE (rien n'est envoyé) — à un contact neuf, ou au même parcours, jamais à un contact déjà connu.
    //    Seulement quand le site le demande (`afficherLienEspace`, formulaire après un rendu) : ni l'ancien site ni la
    //    demande après un échec de génération n'ouvrent l'espace. Au-delà de deux projets en cours, c'est Lucas qui
    //    ouvre : lien null. ──
    const espace: EspaceALEnvoi | null = tunnel ? await ouvrirEspaceALEnvoi(lead.id, { rappel: !!rappelLe, nouveau: isNew, parcoursId: data.parcoursId, neuf }) : null;
    // Le rappel demandé : sur le dossier s'il en a un (à l'heure exacte), sinon « À rappeler » ; agenda et notification suivent.
    if (rappelLe) await suivreLeRappel(lead.id);
    const dossierIdFinal = espace?.dossierId ?? ouverture?.dossierId ?? null;
    // La simulation vient d'être rattachée : la classe (Prioritaire d'office, sauf hors zone) est relue pour le push.
    const classeFinale = aSimule ? ((await prisma.lead.findUnique({ where: { id: lead.id }, select: { priorite: true, prioriteMotif: true } })) ?? null) : null;

    // Accusé de réception au visiteur (site seulement, jamais Meta) : ce que nous
    // avons reçu, le délai de réponse, comment nous joindre. Exige un expéditeur
    // vérifié (EMAIL_FROM) : sans lui, rien ne part et on le journalise.
    if (data.source.startsWith("SITE_") && data.email && (isNew || demandeDeDevis || simulationsRattachees.length > 0)) {
      if (!process.env.EMAIL_FROM || !process.env.RESEND_API_KEY) {
        console.warn("[webhook] accusé de réception non envoyé : EMAIL_FROM ou RESEND_API_KEY absente");
      } else {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const objet = data.source === "SITE_SIMULATEUR" ? "Votre simulation CoverSwap et votre demande de devis" : "Votre demande de devis CoverSwap";
          const recu = [
            data.typeProjet ? `Projet : ${LIBELLES_PROJET_ACCUSE[data.typeProjet] ?? data.typeProjet}` : null,
            data.ville && data.ville !== "Non renseignée" ? `Ville : ${data.ville}${data.codePostal ? ` (${data.codePostal})` : ""}` : null,
            data.referenceChoisie ? `Finition retenue : ${data.referenceChoisie}` : null,
            photosEcrites ? `${pluriel(photosEcrites, "photo jointe", "photos jointes")}` : null,
            simulationsRattachees.length ? `${pluriel(simulationsRattachees.length, "simulation")} sur votre photo` : null,
          ].filter(Boolean);
          await resend.emails.send({
            from: process.env.EMAIL_FROM,
            to: data.email,
            replyTo: "contact@coverswap.fr",
            subject: objet,
            text: [
              `Bonjour ${data.prenom !== "Inconnu" ? data.prenom : ""}`.trim() + ",",
              "",
              "Nous avons bien reçu votre demande sur coverswap.fr. Vous recevrez un devis détaillé sous 48 h ouvrées, chiffré au mètre linéaire, finition par finition.",
              "",
              ...(recu.length ? ["Ce que nous avons reçu :", ...recu.map((l) => `- ${l}`), ""] : []),
              "Une question d'ici là ? Répondez à ce mail ou appelez le 06 70 35 28 69 (lundi-vendredi, 8 h-17 h).",
              "",
              "Lucas Villemin — CoverSwap",
              "73 rue Simone Veil, 34470 Pérols · coverswap.fr",
              "",
              "Vos données servent uniquement à traiter votre demande (politique de confidentialité : https://coverswap.fr/politique-confidentialite).",
            ].join("\n"),
          });
        } catch (erreurAccuse) {
          console.error("[webhook] accusé de réception non envoyé :", erreurAccuse);
        }
      }
    }

    // Notification email au gérant :
    // - tout NOUVEAU lead (peu importe la source)
    // - OU TOUTE demande écrite sur le site (devis, pro, contact), même d'un client déjà en base (un client
    //   qui redemande un devis est très chaud → à ne jamais rater ; un client qui écrit attend une réponse).
    const isDevis = demandeDeDevis;
    if (isNew || demandeEcrite) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr";
        const sourceLabel: Record<string, string> = {
          SITE_SIMULATEUR: "Simulation IA",
          SITE_DEVIS: "Demande de devis",
          SITE_CONTACT: "Formulaire contact",
          SITE_PRO: "Site (pro)",
          META_ADS: "Meta Ads",
        };
        await resend.emails.send({
          from: process.env.EMAIL_FROM || "CoverSwap <onboarding@resend.dev>",
          to: process.env.LEAD_NOTIFICATION_EMAIL || "contact@coverswap.fr",
          subject: isDevis
            ? `🔥 Demande de devis${data.source === "SITE_PRO" ? " pro" : ""}${!isNew ? " (client existant)" : ""} — ${data.prenom} ${data.nom}`
            : `🔔 ${isNew ? "Nouveau lead" : "Nouveau message (client existant)"} ${sourceLabel[data.source] || data.source} — ${data.prenom} ${data.nom}`,
          html: `
            <h2>Nouveau lead reçu</h2>
            <table style="border-collapse:collapse;font-family:sans-serif;">
              <tr><td style="padding:4px 12px;font-weight:bold;">Nom</td><td>${data.prenom} ${data.nom}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Téléphone</td><td>${data.telephone || "—"}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Email</td><td>${data.email || "—"}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Ville</td><td>${data.ville || "—"}${data.codePostal ? ` (${data.codePostal})` : ""}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Source</td><td>${sourceLabel[data.source] || data.source}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Projet</td><td>${data.typeProjet}</td></tr>
              ${data.referenceChoisie ? `<tr><td style="padding:4px 12px;font-weight:bold;">Référence</td><td>${data.referenceChoisie}</td></tr>` : ""}
              ${data.message ? `<tr><td style="padding:4px 12px;font-weight:bold;">Message</td><td>${data.message.replace(/[<>]/g, "")}</td></tr>` : ""}
              ${photosEcrites ? `<tr><td style="padding:4px 12px;font-weight:bold;">Photos</td><td>${pluriel(photosEcrites, "jointe")}</td></tr>` : ""}
              <tr><td style="padding:4px 12px;font-weight:bold;">Mails commerciaux</td><td>${consentement === "ACCORDE" ? "accord donné" : consentement === "REFUSE" ? "case non cochée" : "non demandé"}</td></tr>
            </table>
            <br/>
            <a href="${dossierIdFinal ? `${appUrl}/dossiers?dossier=${dossierIdFinal}` : `${appUrl}/leads?lead=${lead.id}`}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Voir dans le CRM</a>
          `,
        });
      } catch (emailErr) {
        console.error("[webhook] Erreur notification email:", emailErr);
      }
    }

    // Push : le téléphone sonne pour une demande du site comme pour un lead Meta (jamais bloquant).
    let notifications: { canal: string; ok: boolean }[] = [];
    // … et pour une simulation refaite par un lead déjà connu, même sans dossier (il se décide : c'est le moment d'appeler).
    if (isNew || demandeEcrite || ouverture?.cree || ((ouverture?.simulationsRangees ?? 0) > 0 && !avaitUnEspace) || (!ouverture && simulationsRattachees.length > 0)) {
      try {
        const resultats = await notifierDemandeDuSite({
          leadId: lead.id,
          dossierId: dossierIdFinal,
          prenom: data.prenom,
          nom: data.nom,
          telephone: data.telephone,
          ville: data.ville && data.ville !== "Non renseignée" ? data.ville : null,
          typeProjet: data.typeProjet,
          source: data.source,
          campagne: data.campagne ?? null,
          nouveau: isNew,
          simulations: simulationsRattachees.length + (hasImages ? 1 : 0),
          photos: photosEcrites,
          message: data.message ?? null,
          priorite: classeFinale?.priorite ? { classe: classeFinale.priorite as Priorite, motif: classeFinale.prioriteMotif ?? "" } : qualification ? { classe: qualification.priorite as Priorite, motif: qualification.motif } : null,
          doublon: doublon?.motif ?? null,
          rappel: rappelLe ? momentDuRappel(rappelLe, maintenant, "à") : null,
        });
        notifications = resultats.map((r) => ({ canal: r.canal, ok: r.ok }));
      } catch (erreurPush) {
        console.error("[webhook] push non envoyé (non bloquant) :", erreurPush);
      }
    }

    rafraichirLesEcrans();

    return NextResponse.json(
      {
        success: true,
        leadId: lead.id,
        deduped: !isNew,
        consentement,
        photos: photosEcrites,
        simulations: simulationsRattachees.length,
        dossierId: dossierIdFinal,
        notifications,
        // Mission 16 (partie 4) : le lien de l'espace, que le site AFFICHE (null : pas d'espace ouvert par le site), et le rappel daté.
        lienEspace: espace?.lien ?? null,
        rappelLe: rappelLe?.toISOString() ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Erreur serveur", message: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret, x-webhook-secret",
    },
  });
}
