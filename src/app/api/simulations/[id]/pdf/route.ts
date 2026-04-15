import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { promises as fs } from "fs";
import path from "path";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Génère à la volée un PDF "avant / après" pour une simulation donnée.
 * Route protégée par le middleware Basic Auth.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const sim = await prisma.simulation.findUnique({
    where: { id },
    include: { lead: true },
  });
  if (!sim) return NextResponse.json({ error: "Simulation introuvable" }, { status: 404 });

  const base = resolveUploadsDir();

  async function readImage(relPath: string | null): Promise<Buffer | null> {
    if (!relPath) return null;
    try {
      return await fs.readFile(path.join(base, relPath));
    } catch {
      return null;
    }
  }

  const beforeBuf = await readImage(sim.imageBeforePath);
  const afterBuf = await readImage(sim.imageAfterPath);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // A4 portrait: 595 x 842 pts
  const page = pdf.addPage([595, 842]);
  const { width, height } = page.getSize();

  // Header
  page.drawText("CoverSwap — Simulation cuisine", {
    x: 40,
    y: height - 50,
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  const client = `${sim.lead.prenom} ${sim.lead.nom}`.trim();
  const createdAt = sim.createdAt.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  page.drawText(`Client : ${client}`, {
    x: 40, y: height - 75, size: 11, font, color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText(`Téléphone : ${sim.lead.telephone}`, {
    x: 40, y: height - 92, size: 11, font, color: rgb(0.2, 0.2, 0.2),
  });
  if (sim.lead.email) {
    page.drawText(`Email : ${sim.lead.email}`, {
      x: 40, y: height - 109, size: 11, font, color: rgb(0.2, 0.2, 0.2),
    });
  }
  page.drawText(`Date : ${createdAt}`, {
    x: 40, y: height - 126, size: 11, font, color: rgb(0.2, 0.2, 0.2),
  });
  if (sim.referenceChoisie) {
    page.drawText(`Référence : ${sim.referenceChoisie}`, {
      x: 300, y: height - 75, size: 11, font, color: rgb(0.2, 0.2, 0.2),
    });
  }
  if (sim.mlEstimes) {
    page.drawText(`Mètres linéaires : ${sim.mlEstimes}`, {
      x: 300, y: height - 92, size: 11, font, color: rgb(0.2, 0.2, 0.2),
    });
  }
  if (sim.prixDevis) {
    page.drawText(`Prix estimé : ${sim.prixDevis.toFixed(2)} €`, {
      x: 300, y: height - 109, size: 11, font, color: rgb(0.8, 0.15, 0.15),
    });
  }

  // Layout: two images stacked
  const imgMaxW = width - 80; // 515
  const imgMaxH = 300;
  let cursorY = height - 160;

  async function embed(buf: Buffer | null) {
    if (!buf) return null;
    // pdf-lib: try JPEG first, fallback PNG
    try {
      return await pdf.embedJpg(new Uint8Array(buf));
    } catch {
      try {
        return await pdf.embedPng(new Uint8Array(buf));
      } catch {
        return null;
      }
    }
  }

  const beforeImg = await embed(beforeBuf);
  const afterImg = await embed(afterBuf);

  function drawImage(label: string, img: Awaited<ReturnType<typeof embed>>) {
    page.drawText(label, {
      x: 40, y: cursorY, size: 13, font: fontBold, color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= 18;
    if (img) {
      const scale = Math.min(imgMaxW / img.width, imgMaxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = 40 + (imgMaxW - w) / 2;
      page.drawImage(img, { x, y: cursorY - h, width: w, height: h });
      cursorY -= h + 20;
    } else {
      page.drawText("(image indisponible)", {
        x: 40, y: cursorY - 14, size: 10, font, color: rgb(0.5, 0.5, 0.5),
      });
      cursorY -= 30;
    }
  }

  drawImage("Avant", beforeImg);
  drawImage("Après simulation", afterImg);

  // Footer
  page.drawText("CoverSwap — Covering adhésif premium | coverswap.fr", {
    x: 40, y: 30, size: 9, font, color: rgb(0.5, 0.5, 0.5),
  });

  const bytes = await pdf.save();
  const filename = `simulation-${sim.lead.nom}-${sim.id.slice(-6)}.pdf`;

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
