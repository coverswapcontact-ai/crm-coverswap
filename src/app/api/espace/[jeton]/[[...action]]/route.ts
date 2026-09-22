import { devaliderChoix, devaliderProjet, devisEmis, retirerAccord, retirerDemandeProposition, retirerPhoto, validerProjet } from "@/lib/espace/validations";
import { NextResponse, type NextRequest } from "next/server";
import type { EspacePermanent } from "@prisma/client";
import prisma from "@/lib/prisma";
import { analyser } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ipDepasseLaLimite } from "@/lib/acces/limite-site";
import { lirePdfDocument } from "@/lib/dossiers/documents";
import { accesDuJeton, apercuValide, confirmationRequise, confirmerTelephone } from "@/lib/espace/liens";
import { alerterConfirmationBloquee, compteEspace, envoyerMessage, noterVisitePermanent, pdfPourLeClient, projetDemande, schemaMessage, type ProjetVisible } from "@/lib/espace/compte";
import { creerProjetClient, demanderProjetDePlus, figeDuProjet, MESSAGE_FIGE, schemaNouveauProjet } from "@/lib/espace/projets";
import {
  accepterDevis,
  choisir,
  choisirSimulation,
  commenterSimulation,
  completerCoordonnees,
  creerSimulationClient,
  demanderProposition,
  demanderSimulations,
  enregistrerFavoris,
  deposerPhotos,
  donnerAvis,
  enregistrerProjetOuSouhaits,
  etatEspace,
  imagePourLeClient,
  lirePortrait,
  noterConsultationDevis,
  noterSimulationsVues,
  noterVisite,
  photoDeLEspace,
  proposerAdresses,
  schemaAccord,
  schemaAvis,
  schemaChoix,
  schemaChoixComplet,
  schemaCoordonnees,
  schemaCreationSimulation,
  schemaFavoris,
  schemaProposition,
  suivreCreation,
} from "@/lib/espace/service";
import { imageEchantillon, vignetteEchantillon } from "@/lib/simulateur/catalogue";

/**
 * API PUBLIQUE de l'espace client — appelée par la page coverswap.fr/e/<jeton>,
 * depuis le navigateur du client. Aucune session : le jeton signé de l'adresse
 * est la seule clé, et il n'ouvre QUE l'espace permanent de son client
 * (mission 5 : un client = un espace, plusieurs projets). Le projet se choisit
 * par `?projet=<code>` parmi les SIENS ; sans lui : celui du lien, ou son seul
 * projet en cours.
 *
 *   GET    /api/espace/<jeton>                              { espace: le projet courant (ou null), compte: son espace }
 *   POST   /api/espace/<jeton>/confirmation                 les 4 derniers chiffres du téléphone (après 90 jours sans visite)
 *   POST   /api/espace/<jeton>/projets | projets/demande    nouveau projet ; demander un projet de plus (au-delà de deux)
 *   POST   /api/espace/<jeton>/message                      « Écrire à CoverSwap »
 *   GET    /api/espace/<jeton>/documents/<id>               le PDF d'un de ses devis ou factures (tous projets)
 *   PUT    /api/espace/<jeton>/favoris                      ses teintes favorites (catalogue de l'espace)
 *   — et, pour le projet choisi —
 *   GET    /photos/<id> · /simulations/<id>[/avant] · /devis/<id> · /adresse?q=… · /simulations/creation/<id>
 *   GET    /echantillons/<ref> · /portrait
 *   POST   /photos (multipart) · /simulations/creer | demande | vues · /choix · /proposition · /accord · /avis
 *   POST   /projet/validation | devalidation · /choix/retrait · /proposition/retrait · /accord/retrait · /photos/<id>/retrait
 *   POST   /devis/<id>/consultation · /simulations/<id>/choix | commentaire (page du 20/09)
 *   PUT    /projet | souhaits · /coordonnees
 *
 * Garde-fous : origine restreinte au site, limite par adresse IP, blocage d'une
 * adresse qui essaie des liens au hasard (20 liens invalides en 10 min) ;
 * confirmation du téléphone après 90 jours sans visite (rien d'autre ne sort
 * avant) ; un projet terminé ou non réalisé se consulte, il ne se modifie plus.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORIGINES = ["https://coverswap.fr", "https://www.coverswap.fr"];

function origineAutorisee(origine: string | null): string | null {
  if (!origine) return null;
  if (ORIGINES.includes(origine)) return origine;
  if (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origine)) return origine;
  return null;
}

function cors(requete: NextRequest): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origineAutorisee(requete.headers.get("origin")) ?? ORIGINES[0],
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  };
}

const ipDe = (requete: NextRequest) => requete.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || requete.headers.get("x-real-ip") || "inconnue";

type Contexte = { params: Promise<{ jeton: string; action?: string[] }> };
type Acces = { permanent: EspacePermanent; projet: ProjetVisible | null; apercu: boolean; aConfirmer: boolean };
type Suite = (acces: Acces, action: string[]) => Promise<Response>;

async function traiter(requete: NextRequest, contexte: Contexte, suite: Suite, ecriture = false): Promise<Response> {
  const entetes = cors(requete);
  const ip = ipDe(requete);
  try {
    const origine = requete.headers.get("origin");
    if (origine && !origineAutorisee(origine)) throw new ErreurMetier("Origine non autorisée.", 403);
    const { jeton, action = [] } = await contexte.params;
    // Les échantillons du catalogue (une image par teinte parcourue) ont leur propre compteur : feuilleter ne bloque pas l'espace.
    const echantillon = requete.method === "GET" && action[0] === "echantillons";
    if (ipDepasseLaLimite(echantillon ? `espace-ech:${ip}` : `espace:${ip}`, Date.now(), echantillon ? 1500 : 400)) throw new ErreurMetier("Trop de requêtes : réessayez dans quelques minutes.", 429);
    let acces: Awaited<ReturnType<typeof accesDuJeton>>;
    try {
      acces = await accesDuJeton(jeton);
    } catch (erreur) {
      // Quelqu'un qui essaie des liens au hasard est arrêté bien avant d'en trouver un.
      if (ipDepasseLaLimite(`espace-ko:${ip}`, Date.now(), 20)) throw new ErreurMetier("Trop de tentatives : réessayez plus tard.", 429);
      throw erreur;
    }
    const { permanent, projetDuLien } = acces;
    const apercu = apercuValide(permanent, requete.nextUrl.searchParams.get("apercu"));
    if (apercu && ecriture) throw new ErreurMetier("Aperçu : c'est la vue du client, en lecture seule. Rien n'est enregistré.", 403);
    const aConfirmer = !apercu && confirmationRequise(permanent);
    const code = requete.nextUrl.searchParams.get("projet");
    const projet = aConfirmer ? null : await projetDemande(permanent, code && /^[a-z0-9]{8}$/.test(code) ? code : null, projetDuLien);
    const reponse = await suite({ permanent, projet, apercu, aConfirmer }, action);
    for (const [nom, valeur] of Object.entries(entetes)) if (!reponse.headers.has(nom)) reponse.headers.set(nom, valeur);
    return reponse;
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return NextResponse.json({ error: erreur.message, ...erreur.details }, { status: erreur.status, headers: entetes });
    console.error("[espace] erreur :", erreur);
    return NextResponse.json({ error: "Un problème est survenu de notre côté. Réessayez dans un instant, ou appelez-nous." }, { status: 500, headers: entetes });
  }
}

const introuvable = () => new ErreurMetier("Page introuvable.", 404);
const image = (contenu: Buffer, type: string, cache = "private, max-age=3600") => new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": type, "Cache-Control": cache } });

/** Après 90 jours sans visite, rien ne sort avant la confirmation du téléphone. */
function exigerConfirmation(acces: Acces): void {
  if (acces.aConfirmer) throw new ErreurMetier("Pour votre sécurité, confirmez d'abord les 4 derniers chiffres de votre numéro de téléphone.", 401, { raison: "confirmation" });
}

/** Le projet choisi, et qu'il soit encore modifiable (un projet terminé ou non réalisé se consulte). */
function projetDe(acces: Acces, modification = false): ProjetVisible {
  exigerConfirmation(acces);
  if (!acces.projet) throw new ErreurMetier("Choisissez d'abord un de vos projets.", 409, { raison: "projet" });
  const fige = figeDuProjet(acces.projet.dossier.etape);
  if (modification && fige) throw new ErreurMetier(MESSAGE_FIGE[fige], 409, { raison: "fige" });
  return acces.projet;
}

/** Ce qui est signé (ou sur quoi le devis est établi) ne se modifie plus depuis l'espace : un appel suffit. */
async function projetEncoreModifiable(projet: ProjetVisible): Promise<void> {
  const accord = await prisma.accordDevis.count({ where: { dossierId: projet.dossierId, retireLe: null } });
  if (accord > 0 || ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"].includes(projet.dossier.etape)) throw new ErreurMetier("Votre projet est signé : pour y changer quelque chose, appelez CoverSwap.", 409, { raison: "signe" });
  if (await devisEmis(projet.dossierId)) throw new ErreurMetier("Votre devis est établi sur ce projet : pour le changer, appelez CoverSwap, nous l'ajustons avec vous.", 409, { raison: "devis-emis" });
}

/** L'état à jour, relu après un geste : le projet (s'il y en a un) et l'espace entier. */
async function etatComplet(permanentId: string, projetId: string | null, apercu = false) {
  const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: permanentId } });
  const projet = projetId ? await prisma.espaceClient.findUnique({ where: { id: projetId } }) : null;
  const [espace, compte] = await Promise.all([projet ? etatEspace(projet, { apercu, permanent }) : Promise.resolve(null), compteEspace(permanent, { apercu, projetCourant: projet })]);
  return { espace, compte };
}

export async function OPTIONS(requete: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(requete) });
}

export async function GET(requete: NextRequest, contexte: Contexte) {
  return traiter(requete, contexte, async (acces, action) => {
    const { permanent, apercu } = acces;
    if (action.length === 0) {
      if (acces.aConfirmer) return NextResponse.json({ espace: null, compte: await compteEspace(permanent, { apercu }) });
      if (!apercu) {
        await noterVisitePermanent(permanent);
        if (acces.projet) await noterVisite(acces.projet);
      }
      return NextResponse.json(await etatComplet(permanent.id, acces.projet?.id ?? null, apercu));
    }
    const [ressource, id, quoi] = action;
    // Ce qui ne dit rien du client : le catalogue et la photo de Lucas.
    if (action.length === 2 && ressource === "echantillons") {
      // ?l=320 : la vignette de la grille du catalogue ; sans : l'échantillon entier (vue agrandie, planche).
      const vignette = requete.nextUrl.searchParams.get("l") === "320";
      return image(vignette ? await vignetteEchantillon(decodeURIComponent(id)) : await imageEchantillon(decodeURIComponent(id)), "image/jpeg", "public, max-age=604800");
    }
    if (action.length === 1 && ressource === "portrait") {
      const { contenu, type } = await lirePortrait();
      return image(contenu, type, "private, max-age=86400");
    }
    exigerConfirmation(acces);
    if (action.length === 2 && ressource === "documents") {
      const { contenu, nomFichier } = await pdfPourLeClient(permanent, id);
      return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nomFichier}"` } });
    }
    const projet = projetDe(acces);
    if (action.length === 3 && ressource === "simulations" && id === "creation") {
      return NextResponse.json(await suivreCreation(projet, quoi));
    }
    if (action.length === 2 && ressource === "photos") {
      const { contenu, type } = await photoDeLEspace(projet, id);
      return image(contenu, type);
    }
    if ((action.length === 2 || (action.length === 3 && quoi === "avant")) && ressource === "simulations") {
      const { contenu, type } = await imagePourLeClient(projet, id, action.length === 3 ? "avant" : "image");
      return image(contenu, type);
    }
    if (action.length === 2 && ressource === "devis") {
      const { contenu, nomFichier } = await lirePdfDocument(projet.dossierId, id);
      if (!apercu) await noterConsultationDevis(projet, id).catch(() => undefined);
      return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nomFichier}"` } });
    }
    if (action.length === 1 && ressource === "adresse") {
      return NextResponse.json({ adresses: await proposerAdresses(requete.nextUrl.searchParams.get("q") ?? "", projet.dossierId) });
    }
    throw introuvable();
  });
}

export async function POST(requete: NextRequest, contexte: Contexte) {
  return traiter(
    requete,
    contexte,
    async (acces, action) => {
      const { permanent } = acces;
      const [ressource, id, geste] = action;
      // Les quatre derniers chiffres du téléphone : seul geste permis avant la confirmation.
      if (action.length === 1 && ressource === "confirmation") {
        const corps = (await requete.json().catch(() => ({}))) as { chiffres?: unknown };
        if (!acces.aConfirmer) return NextResponse.json(await etatComplet(permanent.id, null));
        if (ipDepasseLaLimite(`espace-confirmation:${ipDe(requete)}`, Date.now(), 12)) throw new ErreurMetier("Trop d'essais : réessayez plus tard, ou appelez CoverSwap.", 429, { raison: "bloque" });
        const resultat = await confirmerTelephone(permanent, typeof corps.chiffres === "string" ? corps.chiffres : "");
        if (!resultat.ok) {
          if (resultat.bloque) {
            await alerterConfirmationBloquee(permanent).catch(() => undefined);
            throw new ErreurMetier("Trop d'essais manqués : pour votre sécurité, l'espace est bloqué jusqu'à demain. Appelez CoverSwap si besoin.", 429, { raison: "bloque", restants: 0 });
          }
          throw new ErreurMetier(`Ces chiffres ne correspondent pas. Il vous reste ${resultat.restants} essai${resultat.restants > 1 ? "s" : ""}.`, 400, { raison: "chiffres", restants: resultat.restants });
        }
        const confirme = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: permanent.id } });
        await noterVisitePermanent(confirme);
        const projet = await projetDemande(confirme, null, null);
        return NextResponse.json(await etatComplet(permanent.id, projet?.id ?? null));
      }
      exigerConfirmation(acces);
      if (action.length === 1 && ressource === "projets") {
        const { projet } = await creerProjetClient(permanent, analyser(schemaNouveauProjet, await requete.json().catch(() => ({}))));
        return NextResponse.json(await etatComplet(permanent.id, projet.id));
      }
      if (action.length === 2 && ressource === "projets" && id === "demande") {
        await demanderProjetDePlus(permanent);
        return NextResponse.json(await etatComplet(permanent.id, acces.projet?.id ?? null));
      }
      if (action.length === 1 && ressource === "message") {
        await envoyerMessage(permanent, acces.projet, analyser(schemaMessage, await requete.json().catch(() => ({}))).texte);
        return NextResponse.json({ ok: true });
      }
      if (action.length === 1 && ressource === "photos") {
        const projet = projetDe(acces, true);
        if (ipDepasseLaLimite(`espace-photos:${ipDe(requete)}`, Date.now(), 60)) throw new ErreurMetier("Beaucoup de photos d'un coup : patientez quelques minutes.", 429);
        let formulaire: FormData;
        try {
          formulaire = await requete.formData();
        } catch {
          throw new ErreurMetier("Envoi interrompu ou photo trop lourde : réessayez avec une photo à la fois.", 400);
        }
        const fichiers = formulaire.getAll("photos").filter((valeur): valeur is File => valeur instanceof File);
        const resultat = await deposerPhotos(projet, fichiers.slice(0, 10));
        return NextResponse.json({ ...resultat, ...(await etatComplet(permanent.id, projet.id)) });
      }
      const corps: unknown = await requete.json().catch(() => ({}));
      // Le suivi (devis ouvert, simulations regardées) et l'avis restent permis sur un projet terminé.
      if (action.length === 3 && ressource === "devis" && geste === "consultation") return NextResponse.json(await noterConsultationDevis(projetDe(acces), id));
      if (action.length === 2 && ressource === "simulations" && id === "vues") {
        await noterSimulationsVues(projetDe(acces));
        return NextResponse.json({ ok: true });
      }
      if (action.length === 1 && ressource === "avis") {
        const projet = projetDe(acces);
        const fige = figeDuProjet(projet.dossier.etape);
        if (fige === "NON_REALISE" || (fige === "TERMINE" && projet.avisLe)) throw new ErreurMetier(MESSAGE_FIGE[fige], 409, { raison: "fige" });
        await donnerAvis(projet, analyser(schemaAvis, corps));
        return NextResponse.json(await etatComplet(permanent.id, projet.id));
      }
      const projet = projetDe(acces, true);
      const relu = async () => NextResponse.json(await etatComplet(permanent.id, projet.id));
      if (action.length === 1 && ressource === "accord") {
        const resultat = await accepterDevis(projet, analyser(schemaAccord, corps), { ip: ipDe(requete), navigateur: requete.headers.get("user-agent") });
        return NextResponse.json({ ...resultat, ...(await etatComplet(permanent.id, projet.id)) });
      }
      // Valider, dévalider, retirer : tout ce que le client fait se défait (espace/validations.ts).
      if (action.length === 2 && ressource === "projet" && id === "validation") {
        await validerProjet((await prisma.espaceClient.findUniqueOrThrow({ where: { id: projet.id } })), "CLIENT");
        return relu();
      }
      if (action.length === 2 && ressource === "projet" && id === "devalidation") {
        await projetEncoreModifiable(projet);
        await devaliderProjet(projet, "CLIENT");
        return relu();
      }
      if (action.length === 2 && ressource === "choix" && id === "retrait") {
        await devaliderChoix(projet, "CLIENT");
        return relu();
      }
      if (action.length === 2 && ressource === "proposition" && id === "retrait") {
        await retirerDemandeProposition(projet, "CLIENT");
        return relu();
      }
      if (action.length === 2 && ressource === "accord" && id === "retrait") {
        const motif = corps && typeof corps === "object" && typeof (corps as { motif?: unknown }).motif === "string" ? (corps as { motif: string }).motif.trim().slice(0, 500) : "";
        await retirerAccord(projet, "CLIENT", motif);
        return relu();
      }
      if (action.length === 3 && ressource === "photos" && geste === "retrait") {
        await retirerPhoto(projet, id, "CLIENT");
        return relu();
      }
      if (action.length === 1 && ressource === "choix") {
        await choisir(projet, analyser(schemaChoixComplet, corps));
        return relu();
      }
      if (action.length === 1 && ressource === "proposition") {
        await demanderProposition(projet, analyser(schemaProposition, corps));
        return relu();
      }
      if (action.length === 2 && ressource === "simulations" && id === "creer") {
        const lancee = await creerSimulationClient(projet, analyser(schemaCreationSimulation, corps));
        return NextResponse.json({ ...lancee, ...(await etatComplet(permanent.id, projet.id)) });
      }
      if (action.length === 2 && ressource === "simulations" && id === "demande") {
        await demanderSimulations(projet);
        return relu();
      }
      if (action.length === 3 && ressource === "simulations" && geste === "choix") {
        await choisirSimulation(projet, id, analyser(schemaChoix, corps).commentaire);
        return relu();
      }
      if (action.length === 3 && ressource === "simulations" && geste === "commentaire") {
        await commenterSimulation(projet, id, analyser(schemaChoix, corps).commentaire);
        return relu();
      }
      throw introuvable();
    },
    true
  );
}

export async function PUT(requete: NextRequest, contexte: Contexte) {
  return traiter(
    requete,
    contexte,
    async (acces, action) => {
      const { permanent } = acces;
      const corps: unknown = await requete.json().catch(() => ({}));
      exigerConfirmation(acces);
      if (action.length === 1 && action[0] === "favoris") {
        // Les favoris sont ceux de son espace (le catalogue), pour tous ses projets.
        await enregistrerFavoris(acces.projet, analyser(schemaFavoris, corps).refs, permanent);
        return NextResponse.json({ ok: true });
      }
      const projet = projetDe(acces, true);
      if (action.length === 1 && (action[0] === "souhaits" || action[0] === "projet")) {
        await projetEncoreModifiable(projet);
        await enregistrerProjetOuSouhaits(await prisma.espaceClient.findUniqueOrThrow({ where: { id: projet.id } }), corps);
        // L'état à jour revient avec la confirmation : l'écran montre « Enregistré » et ce que cela débloque.
        return NextResponse.json({ ok: true, ...(await etatComplet(permanent.id, projet.id)) });
      }
      if (action.length === 1 && action[0] === "coordonnees") {
        await completerCoordonnees(projet, analyser(schemaCoordonnees, corps));
        return NextResponse.json(await etatComplet(permanent.id, projet.id));
      }
      throw introuvable();
    },
    true
  );
}
