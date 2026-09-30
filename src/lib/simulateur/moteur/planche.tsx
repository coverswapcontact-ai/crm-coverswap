import { ImageResponse } from "next/og";

/**
 * La planche des échantillons étiquetés — l'« Image 2 » du prompt (mission 15,
 * partie 2) : fond gris neutre, échantillons carrés, chacun avec sa lettre et
 * sa zone, la référence et le nom du film. Construite hors de toute requête
 * (`ImageResponse` de next/og fonctionne dans une tâche de fond : police
 * embarquée, rendu PNG), réutilisée par la route
 * `/api/simulateur/preparations/<id>/planche` et par la génération.
 */

export type TuilePlanche = { etiquette: string; ref: string; nom: string; resume?: string | null; image: Buffer };

export function dimensionsPlanche(n: number): { largeur: number; hauteur: number; cote: number; parLigne: number } {
  if (n <= 1) return { largeur: 1200, hauteur: 1060, cote: 660, parLigne: 1 };
  if (n === 2) return { largeur: 1600, hauteur: 1000, cote: 620, parLigne: 2 };
  if (n === 3) return { largeur: 1920, hauteur: 960, cote: 540, parLigne: 3 };
  return { largeur: 1600, hauteur: 1720, cote: 580, parLigne: 2 };
}

/** Une image de tuile carrée (JPEG, `cote` px), depuis l'échantillon du catalogue. */
export async function tuileEchantillon(octets: Buffer, cote: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(octets).rotate().resize(cote, cote, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
}

/** La planche, en PNG. Les tuiles sont redimensionnées ici : passer l'image brute de l'échantillon. */
export async function construirePlanche(tuiles: TuilePlanche[], sousTitre = "CoverSwap"): Promise<Buffer> {
  if (tuiles.length === 0) throw new Error("Planche sans échantillon.");
  const { largeur, hauteur, cote, parLigne } = dimensionsPlanche(tuiles.length);
  const images = await Promise.all(tuiles.map(async (t) => `data:image/jpeg;base64,${(await tuileEchantillon(t.image, cote)).toString("base64")}`));
  const lignes: number[][] = [];
  for (let i = 0; i < tuiles.length; i += parLigne) lignes.push(tuiles.slice(i, i + parLigne).map((_, j) => i + j));
  const reponse = new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#E6E6E3", padding: "48px 56px", color: "#161616" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 28, color: "#4A4A47" }}>
        <span style={{ display: "flex" }}>IMAGE 2 — PLANCHE DES TEINTES</span>
        <span style={{ display: "flex" }}>{sousTitre}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
        {lignes.map((ligne, rang) => (
          <div key={rang} style={{ display: "flex", justifyContent: "center", marginTop: rang === 0 ? 0 : 48 }}>
            {ligne.map((index, i) => (
              <div key={index} style={{ display: "flex", flexDirection: "column", width: cote, marginLeft: i === 0 ? 0 : 56 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- rendu par satori, pas par le navigateur */}
                <img src={images[index]} width={cote} height={cote} alt="" style={{ border: "8px solid #FFFFFF", borderRadius: 4 }} />
                <div style={{ display: "flex", fontSize: 46, marginTop: 22, color: "#111111" }}>{tuiles[index].etiquette}</div>
                <div style={{ display: "flex", fontSize: 28, marginTop: 6, color: "#2E2E2C" }}>{`${tuiles[index].ref} — ${tuiles[index].nom}`}</div>
                {tuiles[index].resume ? <div style={{ display: "flex", fontSize: 24, marginTop: 4, color: "#55554F" }}>{tuiles[index].resume}</div> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>,
    { width: largeur, height: hauteur }
  );
  return Buffer.from(await reponse.arrayBuffer());
}
