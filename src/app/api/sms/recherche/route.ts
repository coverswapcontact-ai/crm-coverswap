import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { formaterTelephone, normaliserTelephone } from "@/lib/clients/normalisation";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export type PersonneTrouvee = { genre: "lead" | "client"; id: string; nom: string; detail: string; telephone: string | null };

/** GET ?q=… : contacts entrants et clients par nom, ville ou numéro — pour ouvrir ou rattacher une conversation. */
export async function GET(requete: NextRequest) {
  try {
    const q = (requete.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
    if (q.length < 2) return NextResponse.json({ personnes: [] });
    const chiffres = q.replace(/\D/g, "").replace(/^(33|0)/, "");
    const termes = q.split(/\s+/).filter(Boolean).slice(0, 4);
    const [leads, clients] = await Promise.all([
      prisma.lead.findMany({
        where: {
          AND: termes.map((t) => ({ OR: [{ nom: { contains: t } }, { prenom: { contains: t } }, { ville: { contains: t } }, ...(chiffres.length >= 4 ? [{ telephone: { contains: chiffres.slice(-8) } }] : [])] })),
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, prenom: true, nom: true, ville: true, telephone: true },
      }),
      prisma.client.findMany({
        where: { AND: termes.map((t) => ({ OR: [{ nom: { contains: t } }, { ville: { contains: t } }, ...(chiffres.length >= 4 ? [{ telephones: { some: { numero: { contains: chiffres.slice(-8) } } } }] : [])] })) },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: { id: true, nom: true, ville: true, telephones: { where: { archiveLe: null }, orderBy: { principal: "desc" }, take: 1, select: { numero: true } } },
      }),
    ]);
    const lisible = (numero: string | null | undefined) => {
      const normalise = numero ? normaliserTelephone(numero) : null;
      return normalise ? formaterTelephone(normalise) : null;
    };
    const personnes: PersonneTrouvee[] = [
      ...leads.map((l): PersonneTrouvee => {
        const prenom = l.prenom.trim();
        const nom = l.nom.trim();
        return { genre: "lead", id: l.id, nom: !prenom || prenom.toLowerCase() === nom.toLowerCase() ? nom || prenom : `${prenom} ${nom}`, detail: [l.ville, "contact entrant"].filter(Boolean).join(" · "), telephone: lisible(l.telephone) };
      }),
      ...clients.map((c): PersonneTrouvee => ({ genre: "client", id: c.id, nom: c.nom, detail: [c.ville, "fiche client"].filter(Boolean).join(" · "), telephone: lisible(c.telephones[0]?.numero) })),
    ];
    return NextResponse.json({ personnes });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/sms/recherche");
  }
}
