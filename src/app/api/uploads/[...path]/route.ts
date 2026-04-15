import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Sert les fichiers stockés sur le volume Railway (/data/uploads/...).
 * Protégé par le middleware Basic Auth comme le reste du CRM.
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

  const base = resolveUploadsDir();
  const full = path.join(base, ...segments);

  try {
    const buf = await fs.readFile(full);
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
