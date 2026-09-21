"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheckBig } from "lucide-react";
import { appelApi } from "./client";
import { EVENEMENT_COMPTEURS } from "./Navigation";

/**
 * « À valider » n'est plus dans le menu, mais ce que le CRM propose continue
 * d'attendre une décision (dossier à classer « perdu — sans réponse », mail
 * préparé par l'agent…). Ce rappel n'apparaît que s'il y a quelque chose : il
 * mène à la file de validation, qui existe toujours. Les SMS proposés, eux, se
 * relisent directement dans la conversation (écran SMS) et ne sont pas comptés ici.
 */
export function PropositionsEnAttente() {
  const [nombre, setNombre] = useState(0);

  useEffect(() => {
    let actif = true;
    const charger = () =>
      appelApi<{ propositions: { type: string }[] }>("/api/validation?statut=EN_ATTENTE&limite=200")
        .then(({ propositions }) => actif && setNombre(propositions.filter((p) => p.type !== "ENVOI_SMS").length))
        .catch(() => undefined);
    const minuterie = window.setTimeout(charger, 0);
    window.addEventListener(EVENEMENT_COMPTEURS, charger);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
      window.removeEventListener(EVENEMENT_COMPTEURS, charger);
    };
  }, []);

  if (nombre === 0) return null;
  return (
    <Link href="/validation" className="inline-flex h-8 items-center gap-1.5 rounded-full border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/10 px-3 text-[12.5px] text-[#F5B454] hover:bg-[#EF9F27]/20">
      <CircleCheckBig size={13} aria-hidden /> {nombre} décision{nombre > 1 ? "s" : ""} en attente
    </Link>
  );
}
