"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail } from "@/lib/dossiers/types";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Bouton, Champ, EtatVide, Modale } from "./ui";

/**
 * Archiver un dossier : il sort de Dossiers, son lead REVIENT dans Leads avec
 * ses simulations et ses photos, son espace client est désactivé. Rien ne se
 * supprime : le dossier se retrouve dans « Dossiers archivés » et se restaure.
 * Un dossier qui porte un document émis ou un paiement ne s'archive pas (le
 * serveur le refuse et dit pourquoi) : il se passe en « Perdu ».
 */
export function ArchivageDossier({ detail, onArchive }: { detail: DossierDetail; onArchive: (dossierId: string) => void }) {
  const [ouverte, setOuverte] = useState(false);
  const [motif, setMotif] = useState("");
  const [occupe, setOccupe] = useState(false);

  async function archiver() {
    setOccupe(true);
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/archivage`, "POST", { action: "archiver", motif });
      toast.success("Dossier archivé", { description: detail.origine?.type === "LEAD" ? "Son lead est revenu dans Leads, avec ses simulations et ses photos." : "Il se retrouve dans « Dossiers archivés »." });
      setOuverte(false);
      onArchive(detail.id);
    } catch (erreur) {
      toast.error("Dossier non archivé", { description: messageErreur(erreur) });
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className="border-t-[0.5px] border-[#2A2D34] pt-4">
      <Bouton variante="fantome" taille="sm" icone={<Archive size={13} aria-hidden />} onClick={() => setOuverte(true)}>
        Archiver ce dossier
      </Bouton>
      <Modale
        ouverte={ouverte}
        onFermer={() => setOuverte(false)}
        titre={`Archiver le dossier de ${detail.clientNom} ?`}
        description="Rien n'est supprimé : le dossier se restaure depuis « Dossiers archivés »."
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setOuverte(false)}>Annuler</Bouton>
            <Bouton variante="danger" chargement={occupe} disabled={motif.trim().length < 3} onClick={() => void archiver()}>
              Archiver
            </Bouton>
          </div>
        }
      >
        <ul className="mb-4 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-[#D1D5DB]">
          <li>Le dossier sort de Dossiers et d&apos;Espaces clients.</li>
          {detail.origine?.type === "LEAD" ? <li>Son lead revient dans Leads, avec ses simulations et ses photos : tu peux le rappeler depuis la file d&apos;appels.</li> : null}
          <li>Le lien de son espace client est désactivé.</li>
        </ul>
        <Champ libelle="Pourquoi ?" obligatoire value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ouvert par erreur, doublon, jamais traité…" maxLength={300} />
      </Modale>
    </section>
  );
}

type DossierArchive = { id: string; clientNom: string; objet: string; etape: string; archiveLe: string; archiveMotif: string | null; leadId: string | null };

/** Les dossiers archivés, à retrouver et à restaurer (le lead ressort alors de Leads). */
export function DossiersArchives({ ouverte, onFermer, onRestaure }: { ouverte: boolean; onFermer: () => void; onRestaure: () => void }) {
  const [dossiers, setDossiers] = useState<DossierArchive[] | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  useEffect(() => {
    if (!ouverte) return;
    let actif = true;
    appelApi<{ dossiers: DossierArchive[] }>("/api/dossiers/archives")
      .then((reponse) => actif && setDossiers(reponse.dossiers))
      .catch((erreur: unknown) => actif && toast.error("Dossiers archivés non chargés", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, [ouverte]);

  async function restaurer(dossier: DossierArchive) {
    setOccupe(dossier.id);
    try {
      await envoyerJson(`/api/dossiers/${dossier.id}/archivage`, "POST", { action: "restaurer" });
      toast.success(`Dossier de ${dossier.clientNom} restauré`);
      setDossiers((liste) => liste?.filter((d) => d.id !== dossier.id) ?? null);
      onRestaure();
    } catch (erreur) {
      toast.error("Dossier non restauré", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  return (
    <Modale ouverte={ouverte} onFermer={onFermer} titre="Dossiers archivés" description="Rien n'est supprimé. Restaurer un dossier le remet dans Dossiers ; son lead ressort alors de Leads." largeur="lg">
      {dossiers === null ? (
        <p className="text-[13px] text-[#6B7280]">Chargement…</p>
      ) : dossiers.length === 0 ? (
        <EtatVide titre="Aucun dossier archivé" />
      ) : (
        <ul className="divide-y-[0.5px] divide-[#2A2D34]">
          {dossiers.map((dossier) => (
            <li key={dossier.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-[#F2F3F5]">{dossier.clientNom}</p>
                <p className="text-[12px] leading-snug text-[#9CA3AF]">
                  Archivé le {new Date(dossier.archiveLe).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                  {dossier.archiveMotif ? ` — ${dossier.archiveMotif}` : ""}
                </p>
              </div>
              <Bouton taille="sm" icone={<ArchiveRestore size={13} aria-hidden />} chargement={occupe === dossier.id} onClick={() => void restaurer(dossier)}>
                Restaurer
              </Bouton>
            </li>
          ))}
        </ul>
      )}
    </Modale>
  );
}
