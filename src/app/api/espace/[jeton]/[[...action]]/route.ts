import { NextResponse, type NextRequest } from "next/server";
import type { EspaceClient } from "@prisma/client";
import { analyser } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ipDepasseLaLimite } from "@/lib/acces/limite-site";
import { lirePdfDocument } from "@/lib/dossiers/documents";
import { espaceDuJeton } from "@/lib/espace/liens";
import {
  accepterDevis,
  choisirSimulation,
  commenterSimulation,
  completerCoordonnees,
  deposerPhotos,
  enregistrerSouhaits,
  etatEspace,
  imageDeSimulation,
  noterVisite,
  photoDeLEspace,
  schemaAccord,
  schemaChoix,
  schemaCoordonnees,
  schemaSouhaits,
} from "@/lib/espace/service";

/**
 * API PUBLIQUE de l'espace client — appelée par la page coverswap.fr/e/<jeton>,
 * depuis le navigateur du client. Aucune session : le jeton signé de l'adresse
 * est la seule clé, et il n'ouvre QUE le dossier auquel il appartient (photos,
 * simulations et devis sont toujours cherchés avec l'identifiant de ce dossier).
 *
 *   GET    /api/espace/<jeton>                              état du projet
 *   GET    /api/espace/<jeton>/photos/<id>                  une photo du client
 *   GET    /api/espace/<jeton>/simulations/<id>             l'image d'une simulation
 *   GET    /api/espace/<jeton>/devis/<id>                   le PDF du devis
 *   POST   /api/espace/<jeton>/photos                       dépôt de photos (multipart)
 *   PUT    /api/espace/<jeton>/souhaits | coordonnees
 *   POST   /api/espace/<jeton>/simulations/<id>/choix | commentaire
 *   POST   /api/espace/<jeton>/accord                       bon pour accord
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

async function traiter(requete: NextRequest, contexte: Contexte, suite: (espace: EspaceClient, action: string[]) => Promise<Response>): Promise<Response> {
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
    const reponse = await suite(espace, action);
    for (const [nom, valeur] of Object.entries(entetes)) if (!reponse.headers.has(nom)) reponse.headers.set(nom, valeur);
    return reponse;
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return NextResponse.json({ error: erreur.message, ...erreur.details }, { status: erreur.status, headers: entetes });
    console.error("[espace] erreur :", erreur);
    return NextResponse.json({ error: "Un problème est survenu de notre côté. Réessayez dans un instant, ou appelez-nous." }, { status: 500, headers: entetes });
  }
}

const introuvable = () => new ErreurMetier("Page introuvable.", 404);

export async function OPTIONS(requete: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(requete) });
}

export async function GET(requete: NextRequest, contexte: Contexte) {
  return traiter(requete, contexte, async (espace, action) => {
    if (action.length === 0) {
      await noterVisite(espace);
      return NextResponse.json({ espace: await etatEspace(espace) });
    }
    const [ressource, id] = action;
    if (action.length === 2 && ressource === "photos") {
      const { contenu, type } = await photoDeLEspace(espace, id);
      return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
    }
    if (action.length === 2 && ressource === "simulations") {
      const { contenu, type } = await imageDeSimulation({ espaceId: espace.id }, id);
      return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
    }
    if (action.length === 2 && ressource === "devis") {
      const { contenu, nomFichier } = await lirePdfDocument(espace.dossierId, id);
      return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nomFichier}"` } });
    }
    throw introuvable();
  });
}

export async function POST(requete: NextRequest, contexte: Contexte) {
  return traiter(requete, contexte, async (espace, action) => {
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
    if (action.length === 1 && ressource === "accord") {
      const resultat = await accepterDevis(espace, analyser(schemaAccord, corps), { ip: ipDe(requete), navigateur: requete.headers.get("user-agent") });
      return NextResponse.json({ ...resultat, espace: await etatEspace(espace) });
    }
    if (action.length === 3 && ressource === "simulations" && geste === "choix") {
      await choisirSimulation(espace, id, analyser(schemaChoix, corps).commentaire);
      return NextResponse.json({ espace: await etatEspace(espace) });
    }
    if (action.length === 3 && ressource === "simulations" && geste === "commentaire") {
      await commenterSimulation(espace, id, analyser(schemaChoix, corps).commentaire);
      return NextResponse.json({ espace: await etatEspace(espace) });
    }
    throw introuvable();
  });
}

export async function PUT(requete: NextRequest, contexte: Contexte) {
  return traiter(requete, contexte, async (espace, action) => {
    const corps: unknown = await requete.json().catch(() => ({}));
    if (action.length === 1 && action[0] === "souhaits") {
      await enregistrerSouhaits(espace, analyser(schemaSouhaits, corps));
      return NextResponse.json({ ok: true });
    }
    if (action.length === 1 && action[0] === "coordonnees") {
      await completerCoordonnees(espace, analyser(schemaCoordonnees, corps));
      return NextResponse.json({ espace: await etatEspace(espace) });
    }
    throw introuvable();
  });
}
