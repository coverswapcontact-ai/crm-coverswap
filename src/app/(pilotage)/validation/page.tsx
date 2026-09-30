import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { compterPropositionsEnAttente, listerPropositions, vueProposition } from "@/lib/validation/service";
import FileValidation from "./_components/FileValidation";

export const metadata: Metadata = {
  title: "À valider — CoverSwap",
  description: "Propositions de l'agent et du système : rien ne part sans validation.",
};

export const dynamic = "force-dynamic";

/** Un identifiant de proposition lisible (cuid), sinon null : rien d'autre n'est cherché en base. */
function identifiant(brut: string | string[] | undefined): string | null {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  return valeur && /^[a-z0-9_-]{8,64}$/i.test(valeur) ? valeur : null;
}

// Mission 17 (partie A, relecture) : `?proposition=<id>` (« Relire et valider » depuis Tâches) ouvre directement cette
// proposition, avec son aperçu, même si elle n'est pas parmi les 200 plus récentes, ou si elle a été décidée entre-temps.
export default async function ValidationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const id = identifiant((await searchParams).proposition);
  const [propositions, totalEnAttente, ligne] = await Promise.all([
    listerPropositions({ statuts: ["EN_ATTENTE"], limite: 200 }),
    compterPropositionsEnAttente(),
    id ? prisma.proposition.findUnique({ where: { id } }) : Promise.resolve(null),
  ]);
  return <FileValidation key={id ?? "toutes"} initiales={propositions} totalEnAttente={totalEnAttente} cible={ligne ? vueProposition(ligne) : null} cibleDemandee={id !== null} />;
}
