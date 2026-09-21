import { NextResponse, type NextRequest } from "next/server";
import type { EspaceClient } from "@prisma/client";
import { analyser } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ipDepasseLaLimite } from "@/lib/acces/limite-site";
import { lirePdfDocument } from "@/lib/dossiers/documents";
import { apercuValide, espaceDuJeton } from "@/lib/espace/liens";
import {
  accepterDevis,
  choisir,
  choisirSimulation,
  commenterSimulation,
  completerCoordonnees,
  demanderProposition,
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
  schemaProposition,
} from "@/lib/espace/service";
import { imageEchantillon } from "@/lib/simulateur/catalogue";

/**
 * API PUBLIQUE de l'espace client — appelée par la page coverswap.fr/e/<jeton>,
 * depuis le navigateur du client. Aucune session : le jeton signé de l'adresse
 * est la seule clé, et il n'ouvre QUE le dossier auquel il appartient (photos,
 * simulations publiées et devis sont toujours cherchés avec l'identifiant de
 * ce dossier ou de cet espace).
 *
 *   GET    /api/espace/<jeton>                              état du projet (?apercu=… : Lucas, lecture seule)
 *   GET    /api/espace/<jeton>/photos/<id>                  une photo du client
 *   GET    /api/espace/<jeton>/simulations/<id>[/avant]     une simulation publiée (rendu, ou sa photo avant)
 *   GET    /api/espace/<jeton>/echantillons/<ref>           l'échantillon d'une teinte (servi par le CRM)
 *   GET    /api/espace/<jeton>/devis/<id>                   le PDF du devis (compte une consultation)
 *   GET    /api/espace/<jeton>/portrait                     la photo de Lucas
 *   GET    /api/espace/<jeton>/adresse?q=…                  saisie assistée de l'adresse (Base adresse nationale)
 *   POST   /api/espace/<jeton>/photos                       dépôt de photos (multipart)
 *   PUT    /api/espace/<jeton>/souhaits | projet | coordonnees
 *   POST   /api/espace/<jeton>/choix                        une simulation, ou une teinte par zone
 *   POST   /api/espace/<jeton>/proposition                  demander une autre proposition
 *   POST   /api/espace/<jeton>/simulations/vues             ses simulations ont été regardées
 *   POST   /api/espace/<jeton>/simulations/<id>/choix | commentaire   (page du 20/09)
 *   POST   /api/espace/<jeton>/devis/<id>/consultation      le devis a été ouvert
 *   POST   /api/espace/<jeton>/accord                       bon pour accord (+ signature)
 *   POST   /api/espace/<jeton>/avis                         après le chantier
 *
 * Garde-fous : origine restreinte au site, limite par adresse IP, et blocage
 * d'une adresse qui essaie des liens au hasard (20 liens invalides en 10 min).
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
type Suite = (espace: EspaceClient, action: string[], apercu: boolean) => Promise<Response>;

async function traiter(requete: NextRequest, contexte: Contexte, suite: Suite, ecriture = false): Promise<Response> {
  const entetes = cors(requete);
  const ip = ipDe(requete);
  try {
    const origine = requete.headers.get("origin");
    if (origine && !origineAutorisee(origine)) throw new ErreurMetier("Origine non autorisée.", 403);
    if (ipDepasseLaLimite(`espace:${ip}`, Date.now(), 400)) throw new ErreurMetier("Trop de requêtes : réessayez dans quelques minutes.", 429);
    const { jeton, action = [] } = await contexte.params;
    let espace: EspaceClient;
    try {
      espace = await espaceDuJeton(jeton);
    } catch (erreur) {
      // Quelqu'un qui essaie des liens au hasard est arrêté bien avant d'en trouver un.
      if (ipDepasseLaLimite(`espace-ko:${ip}`, Date.now(), 20)) throw new ErreurMetier("Trop de tentatives : réessayez plus tard.", 429);
      throw erreur;
    }
    const apercu = apercuValide(espace, requete.nextUrl.searchParams.get("apercu"));
    if (apercu && ecriture) throw new ErreurMetier("Aperçu : c'est la vue du client, en lecture seule. Rien n'est enregistré.", 403);
    const reponse = await suite(espace, action, apercu);
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

export async function OPTIONS(requete: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(requete) });
}

export async function GET(requete: NextRequest, contexte: Contexte) {
  return traiter(requete, contexte, async (espace, action, apercu) => {
    if (action.length === 0) {
      if (!apercu) await noterVisite(espace);
      return NextResponse.json({ espace: await etatEspace(espace, { apercu }) });
    }
    const [ressource, id, quoi] = action;
    if (action.length === 2 && ressource === "photos") {
      const { contenu, type } = await photoDeLEspace(espace, id);
      return image(contenu, type);
    }
    if ((action.length === 2 || (action.length === 3 && quoi === "avant")) && ressource === "simulations") {
      const { contenu, type } = await imagePourLeClient(espace, id, action.length === 3 ? "avant" : "image");
      return image(contenu, type);
    }
    if (action.length === 2 && ressource === "echantillons") {
      return image(await imageEchantillon(decodeURIComponent(id)), "image/jpeg", "public, max-age=604800");
    }
    if (action.length === 2 && ressource === "devis") {
      const { contenu, nomFichier } = await lirePdfDocument(espace.dossierId, id);
      if (!apercu) await noterConsultationDevis(espace, id).catch(() => undefined);
      return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nomFichier}"` } });
    }
    if (action.length === 1 && ressource === "portrait") {
      const { contenu, type } = await lirePortrait();
      return image(contenu, type, "private, max-age=86400");
    }
    if (action.length === 1 && ressource === "adresse") {
      return NextResponse.json({ adresses: await proposerAdresses(requete.nextUrl.searchParams.get("q") ?? "", espace.dossierId) });
    }
    throw introuvable();
  });
}

export async function POST(requete: NextRequest, contexte: Contexte) {
  return traiter(
    requete,
    contexte,
    async (espace, action) => {
      const [ressource, id, geste] = action;
      if (action.length === 1 && ressource === "photos") {
        if (ipDepasseLaLimite(`espace-photos:${ipDe(requete)}`, Date.now(), 60)) throw new ErreurMetier("Beaucoup de photos d'un coup : patientez quelques minutes.", 429);
        let formulaire: FormData;
        try {
          formulaire = await requete.formData();
        } catch {
          throw new ErreurMetier("Envoi interrompu ou photo trop lourde : réessayez avec une photo à la fois.", 400);
        }
        const fichiers = formulaire.getAll("photos").filter((valeur): valeur is File => valeur instanceof File);
        const resultat = await deposerPhotos(espace, fichiers.slice(0, 10));
        return NextResponse.json({ ...resultat, espace: await etatEspace(espace) });
      }
      const corps: unknown = await requete.json().catch(() => ({}));
      const relu = async () => NextResponse.json({ espace: await etatEspace(await espaceDuJeton((await contexte.params).jeton)) });
      if (action.length === 1 && ressource === "accord") {
        const resultat = await accepterDevis(espace, analyser(schemaAccord, corps), { ip: ipDe(requete), navigateur: requete.headers.get("user-agent") });
        return NextResponse.json({ ...resultat, espace: await etatEspace(espace) });
      }
      if (action.length === 1 && ressource === "choix") {
        await choisir(espace, analyser(schemaChoixComplet, corps));
        return relu();
      }
      if (action.length === 1 && ressource === "proposition") {
        await demanderProposition(espace, analyser(schemaProposition, corps));
        return relu();
      }
      if (action.length === 1 && ressource === "avis") {
        await donnerAvis(espace, analyser(schemaAvis, corps));
        return relu();
      }
      if (action.length === 2 && ressource === "simulations" && id === "vues") {
        await noterSimulationsVues(espace);
        return NextResponse.json({ ok: true });
      }
      if (action.length === 3 && ressource === "devis" && geste === "consultation") {
        return NextResponse.json(await noterConsultationDevis(espace, id));
      }
      if (action.length === 3 && ressource === "simulations" && geste === "choix") {
        await choisirSimulation(espace, id, analyser(schemaChoix, corps).commentaire);
        return relu();
      }
      if (action.length === 3 && ressource === "simulations" && geste === "commentaire") {
        await commenterSimulation(espace, id, analyser(schemaChoix, corps).commentaire);
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
    async (espace, action) => {
      const corps: unknown = await requete.json().catch(() => ({}));
      if (action.length === 1 && (action[0] === "souhaits" || action[0] === "projet")) {
        await enregistrerProjetOuSouhaits(espace, corps);
        return NextResponse.json({ ok: true });
      }
      if (action.length === 1 && action[0] === "coordonnees") {
        await completerCoordonnees(espace, analyser(schemaCoordonnees, corps));
        return NextResponse.json({ espace: await etatEspace(espace) });
      }
      throw introuvable();
    },
    true
  );
}
