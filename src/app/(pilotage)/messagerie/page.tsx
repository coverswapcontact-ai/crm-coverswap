import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { EcranMessagerie } from "@/components/messagerie/EcranMessagerie";

export const metadata: Metadata = {
  title: "Messagerie — CoverSwap",
  description: "Une conversation par client, tous les canaux réunis ; les messages préparés à l'heure prévue, « Où on en est » en tête de chaque dossier, et le mode « Un par un ».",
};

export const dynamic = "force-dynamic";

const IDENTIFIANT = /^[a-z0-9]{10,40}$/i;

// Mission 25 : ?suivi=<id> ouvre une conversation ; ?message=<id> celle d'un message (lien des notifications) ;
// ?vue=un-par-un ouvre la file du jour. Le même écran en v1 et en v2 (il ne dépend d'aucune des deux coques).
export default async function MessageriePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  let suivi = typeof parametres.suivi === "string" && IDENTIFIANT.test(parametres.suivi) ? parametres.suivi : null;
  if (!suivi && typeof parametres.message === "string" && IDENTIFIANT.test(parametres.message)) {
    suivi = (await prisma.messagePrepare.findUnique({ where: { id: parametres.message }, select: { suiviId: true } }))?.suiviId ?? null;
  }
  return <EcranMessagerie suiviInitial={suivi} unParUnInitial={parametres.vue === "un-par-un"} />;
}
