"use client";

import { Check, FilePlus2, FileText, FileUp, Undo2 } from "lucide-react";
import { Bouton, Pastille } from "@/components/pilotage/ui";
import type { DossierDetail } from "@/lib/dossiers/types";
import type { VueEspaceCrm } from "@/lib/espace/vue-crm";
import { euros, jour } from "@/lib/commun/format";
import { cn } from "@/lib/utils";
import { Rubrique, type ConfirmationEspace } from "./RubriqueEspace";

/** Mission 13 (lot 7) : la rubrique « Devis et accord » de l'espace client vu du dossier — devis proposés (lectures, visibilité), accord donné ou retiré, faire, ajouter ou déposer un devis. */
export function RubriqueDevisEspace({
  detail,
  espace,
  occupe,
  visibilite,
  setConfirmation,
  onFaireDevis,
  onAjouterDevis,
  onDeposerPdf,
}: {
  detail: DossierDetail;
  espace: VueEspaceCrm;
  occupe: string | null;
  /** Mission 11 : l'interrupteur « visible dans l'espace client » d'un devis proposé. */
  visibilite: (documentId: string, visibleEspace: boolean) => Promise<void>;
  setConfirmation: (confirmation: ConfirmationEspace) => void;
  onFaireDevis?: () => void;
  onAjouterDevis?: () => void;
  onDeposerPdf?: () => void;
}) {
  const aucunDevis = !detail.documents.some((d) => d.type === "DEVIS" && d.numero);
  const visibles = espace.devisProposes.filter((d) => d.visibleEspace || d.statut === "ACCEPTE");
  return (
    <Rubrique
      titre="Devis et accord"
      etat={
        espace.accord ? (
          <Pastille ton="vert"><Check size={11} strokeWidth={3} aria-hidden /> Signé le {jour(espace.accord.le)}</Pastille>
        ) : visibles.length > 1 ? (
          <Pastille ton="ambre">{visibles.length} devis proposés : il en choisit un</Pastille>
        ) : espace.devis && visibles.length === 0 ? (
          <Pastille ton="ambre">Devis masqué : il ne voit rien</Pastille>
        ) : espace.devis ? (
          <Pastille ton="ambre">En attente de son accord</Pastille>
        ) : (
          <Pastille>Pas de devis émis</Pastille>
        )
      }
    >
      {espace.devisProposes.length ? (
        <ul className="space-y-1">
          {espace.devisProposes.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-[#D1D5DB]">
              <span>
                Devis {d.numero}
                {d.libelle ? <span className="text-[#8B919C]"> « {d.libelle} »</span> : null} — {euros(d.total)}
                {d.repris ? <span className="text-[#8B919C]"> (repris)</span> : null}
                {d.statut === "ACCEPTE" ? <span className="text-[#5DCAA5]"> · signé</span> : d.statut === "NON_RETENU" ? <span className="text-[#8B919C]"> · non retenu</span> : null}
              </span>
              {espace.devisProposes.length > 1 ? (
                // Mission 13 (lot 5, B6) : chaque devis compte ses propres lectures.
                <span className={cn("text-[12px]", d.consultations >= 3 && !espace.accord ? "text-[#F87171]" : "text-[#8B919C]")}>
                  {d.consultations > 0 ? `lu ${d.consultations} fois${d.consulteLe ? ` · dernière le ${jour(d.consulteLe)}` : ""}` : "pas encore ouvert"}
                </span>
              ) : null}
              {espace.accord ? null : (
                <label className={cn("inline-flex cursor-pointer items-center gap-1.5 text-[12px]", d.visibleEspace ? "text-[#8B919C]" : "text-[#F5B454]")}>
                  <input type="checkbox" className="accent-[#1D9E75]" checked={d.visibleEspace} disabled={occupe !== null} onChange={(evenement) => void visibilite(d.id, evenement.target.checked)} />
                  {d.visibleEspace ? "visible dans son espace" : !d.repris && d.statut === "GENERE" ? "masqué dans son espace (le rendre visible l'envoie : mail « Devis disponible »)" : "masqué dans son espace"}
                </label>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-[#8B919C]">{espace.choix ? "Il a validé une simulation : le devis est à faire." : "L'onglet Devis de son espace est verrouillé tant qu'il n'a pas validé de simulation."}</p>
      )}
      {espace.devis && espace.devisProposes.length <= 1 ? (
        <p className="mt-1 text-[12px] text-[#8B919C]">
          {espace.devis.consultations > 0 ? (
            <span className={espace.devis.consultations >= 3 && !espace.accord ? "text-[#F87171]" : undefined}>
              Devis ouvert {espace.devis.consultations} fois dans son espace (dernière le {jour(espace.devis.consulteLe)})
            </span>
          ) : (
            "Pas encore ouvert dans son espace"
          )}
        </p>
      ) : null}
      {espace.accord ? (
        <p className="mt-1 text-[13px] text-[#D1D5DB]">
          {espace.accord.source === "ESPACE" ? `Bon pour accord donné dans son espace par ${espace.accord.nom}${espace.accord.signature ? ", signé au doigt" : ""}.` : "Devis noté « accepté » dans le CRM (signé hors de l'espace) : son espace le montre signé."}
        </p>
      ) : null}
      {espace.accordsRetires.map((a) => (
        <p key={a.retireLe} className="mt-1 text-[12px] text-[#F5B454]">
          Accord du {jour(a.le)} retiré le {jour(a.retireLe)} {a.par === "CLIENT" ? "par le client" : "par moi"}
          {a.motif ? ` : « ${a.motif} »` : ""} (preuve gardée).
        </p>
      ))}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {onFaireDevis && (espace.choix || espace.projet) && aucunDevis ? (
          <Bouton taille="sm" variante={espace.choix ? "primaire" : "secondaire"} icone={<FileText size={13} aria-hidden />} onClick={onFaireDevis}>
            {espace.choix ? "Faire le devis depuis son choix" : "Faire le devis depuis son projet"}
          </Bouton>
        ) : null}
        {onAjouterDevis && !aucunDevis && !espace.accord ? (
          <Bouton taille="sm" variante="secondaire" icone={<FilePlus2 size={13} aria-hidden />} onClick={onAjouterDevis}>
            Ajouter un devis
          </Bouton>
        ) : null}
        {onDeposerPdf && (espace.choix || espace.projet || !aucunDevis) && !espace.accord ? (
          <Bouton taille="sm" variante="fantome" icone={<FileUp size={13} aria-hidden />} onClick={onDeposerPdf}>
            Déposer un devis PDF
          </Bouton>
        ) : null}
        {espace.accord?.source === "ESPACE" ? (
          <Bouton taille="sm" variante="fantome" icone={<Undo2 size={13} aria-hidden />} onClick={() => setConfirmation({ titre: "Retirer son bon pour accord ?", texte: "L'accord ne vaut plus (sa preuve reste gardée). Si le dossier est en « Signé », il revient à « Devis envoyé », le devis redevient un devis émis et les autres devis proposés redeviennent au choix.", bouton: "Retirer l'accord", geste: { geste: "retirer-accord", motif: "" }, succes: "Accord retiré" })}>
            Retirer son accord
          </Bouton>
        ) : null}
      </div>
    </Rubrique>
  );
}
