import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { resolveUploadsDir } from "@/lib/uploads";
import { DOSSIER_ORIGINAUX, estVignette } from "@/lib/fichiers/images";

/**
 * Sert les fichiers stockés sur le volume Railway (/data/uploads/...).
 * Protégé par la session NextAuth : préfixe /api/uploads dans src/middleware.ts
 * (le Basic Auth n'est pas actif en production).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await ctx.params;

  // Prévention path traversal
  for (const seg of segments) {
    if (seg.includes("..") || seg.includes("/") || seg.includes("\\")) {
      return NextResponse.json({ error: "Chemin invalide" }, { status: 400 });
    }
  }

  // Mission 13 (lot 6) : les originaux sont hors ligne, jamais servis.
  if (segments[0] === DOSSIER_ORIGINAUX) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const base = resolveUploadsDir();
  const full = path.join(base, ...segments);

  try {
    let buf: Buffer;
    try {
      buf = await fs.readFile(full);
    } catch (erreur) {
      // Vignette pas encore produite (photo d'avant le lot 6) : la version servie.
      const relatif = segments.join("/");
      if (!estVignette(relatif)) throw erreur;
      buf = await fs.readFile(path.join(base, relatif.replace(/\.vignette(\.[a-z0-9]+)$/i, "$1")));
    }
    const ext = path.extname(full).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".png" ? "image/png" :
      ext === ".webp" ? "image/webp" :
      "application/octet-stream";
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
}
