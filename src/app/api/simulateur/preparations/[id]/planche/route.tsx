import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { imageEchantillon } from "@/lib/simulateur/catalogue";
import { lirePreparation } from "@/lib/simulateur/preparation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET : la planche des teintes d'une préparation — l'« Image 2 » que l'on joint
 * dans ChatGPT. Fond neutre (gris clair, sans reflet), échantillons grands et
 * carrés, chacun étiqueté par sa lettre et sa zone, avec la référence et le nom
 * de la teinte : ChatGPT lit l'image, et le prompt cite les mêmes étiquettes.
 * ?telecharger=1 : servie en pièce jointe.
 */
function dimensions(n: number): { largeur: number; hauteur: number; cote: number; parLigne: number } {
  if (n <= 1) return { largeur: 1200, hauteur: 1060, cote: 660, parLigne: 1 };
  if (n === 2) return { largeur: 1600, hauteur: 1000, cote: 620, parLigne: 2 };
  if (n === 3) return { largeur: 1920, hauteur: 960, cote: 540, parLigne: 3 };
  return { largeur: 1600, hauteur: 1720, cote: 580, parLigne: 2 };
}

export async function GET(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const preparation = await lirePreparation(id);
    const { largeur, hauteur, cote, parLigne } = dimensions(preparation.zones.length);
    const sharp = (await import("sharp")).default;
    const images = await Promise.all(
      preparation.zones.map(async (z) => {
        const octets = await sharp(await imageEchantillon(z.ref)).rotate().resize(cote, cote, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
        return `data:image/jpeg;base64,${octets.toString("base64")}`;
      })
    );
    const lignes: (typeof preparation.zones)[] = [];
    for (let i = 0; i < preparation.zones.length; i += parLigne) lignes.push(preparation.zones.slice(i, i + parLigne));

    const reponse = new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#E6E6E3", padding: "48px 56px", color: "#161616" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 28, color: "#4A4A47" }}>
            <span style={{ display: "flex" }}>IMAGE 2 — PLANCHE DES TEINTES</span>
            <span style={{ display: "flex" }}>{`CoverSwap · ${preparation.typeLibelle}`}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
            {lignes.map((ligne, rang) => (
              <div key={rang} style={{ display: "flex", justifyContent: "center", marginTop: rang === 0 ? 0 : 48 }}>
                {ligne.map((z, i) => (
                  <div key={z.zone} style={{ display: "flex", flexDirection: "column", width: cote, marginLeft: i === 0 ? 0 : 56 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- rendu par satori, pas par le navigateur */}
                    <img src={images[preparation.zones.indexOf(z)]} width={cote} height={cote} alt="" style={{ border: "8px solid #FFFFFF", borderRadius: 4 }} />
                    <div style={{ display: "flex", fontSize: 46, marginTop: 22, color: "#111111" }}>{z.etiquette}</div>
                    <div style={{ display: "flex", fontSize: 28, marginTop: 6, color: "#2E2E2C" }}>{`${z.ref} — ${z.nom}`}</div>
                    <div style={{ display: "flex", fontSize: 24, marginTop: 4, color: "#55554F" }}>{z.resume}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ),
      { width: largeur, height: hauteur }
    );
    const entetes = new Headers(reponse.headers);
    entetes.set("Cache-Control", "private, max-age=3600");
    entetes.set("Content-Disposition", `${requete.nextUrl.searchParams.get("telecharger") ? "attachment" : "inline"}; filename="planche-teintes-${id.slice(-6)}.png"`);
    return new Response(reponse.body, { status: 200, headers: entetes });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/preparations/[id]/planche");
  }
}
