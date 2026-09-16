"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CloudUpload, Link2, Link2Off, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Pastille, TitreSection } from "@/components/pilotage/ui";
import { formatDateCourte, formatHorodatage } from "@/lib/dossiers/dates";
import type { EtatMiroir } from "@/lib/drive/synchronisation";
import type { EtatConnexionGoogle } from "@/lib/google/connexion";
import { cn } from "@/lib/utils";

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]";

type Etat = { google: EtatConnexionGoogle; drive: EtatMiroir };

/** Connexion Google (Drive, Gmail) et miroir Drive : état, connexion, synchronisation à la demande. */
export default function Connexions({ retour }: { retour: { google: string | null; compte: string | null; message: string | null } }) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  useEffect(() => {
    if (retour.google === "connecte") toast.success("Compte Google connecté", { description: retour.compte ?? undefined });
    if (retour.google === "erreur") toast.error("Connexion Google impossible", { description: retour.message ?? undefined });
    let actif = true;
    appelApi<Etat>("/api/connexions")
      .then((reponse) => actif && setEtat(reponse))
      .catch((erreur) => toast.error("État des connexions indisponible", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, [retour.google, retour.compte, retour.message]);

  async function recharger() {
    setEtat(await appelApi<Etat>("/api/connexions"));
  }

  async function action(nom: string, appel: () => Promise<unknown>, reussite: string) {
    setEnvoi(nom);
    try {
      await appel();
      toast.success(reussite);
      await recharger();
    } catch (erreur) {
      toast.error("Action refusée", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(null);
    }
  }

  if (!etat) return <p className="mt-6 text-[13px] text-[#6B7280]">Chargement des connexions…</p>;
  const { google, drive } = etat;

  return (
    <section className="mt-6">
      <TitreSection>Connexions</TitreSection>
      <div className="grid gap-2.5 md:grid-cols-2">
        <div className={cn(CARTE, "p-4")}>
          <p className="flex items-center gap-2 text-[14px] font-medium text-[#F2F3F5]">
            <Link2 size={15} aria-hidden /> Compte Google (Drive, Gmail)
          </p>
          {!google.configuree ? (
            <div className="mt-2 text-[12.5px] text-[#9CA3AF]">
              <Pastille ton="neutre">Non configuré</Pastille>
              <p className="mt-2">À ajouter aux variables d&apos;environnement du serveur : {google.manquantes.join(", ")}. Voir la section 15 du document d&apos;architecture.</p>
            </div>
          ) : google.connexion ? (
            <div className="mt-2 text-[12.5px] text-[#9CA3AF]">
              <p className="flex items-center gap-1.5 text-[#5DCAA5]">
                <CircleCheck size={14} aria-hidden /> {google.connexion.compte}
              </p>
              <p className="mt-1">Connecté depuis le {formatDateCourte(google.connexion.depuis)}</p>
              {google.connexion.derniereErreur ? <p className="mt-1 text-[#F87171]">{google.connexion.derniereErreur}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="/api/google/connexion" className="inline-flex h-8 items-center rounded-[8px] border-[0.5px] border-[#2A2D34] px-3 text-[12px] text-[#F2F3F5] hover:border-[#3A3E47]">
                  Reconnecter
                </a>
                <Bouton
                  taille="sm"
                  variante="danger"
                  icone={<Link2Off size={13} aria-hidden />}
                  chargement={envoi === "deconnexion"}
                  onClick={() => void action("deconnexion", () => envoyerJson("/api/google/deconnexion", "POST"), "Compte Google déconnecté")}
                >
                  Déconnecter
                </Bouton>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[12.5px] text-[#9CA3AF]">
              <Pastille ton="ambre">Pas connecté</Pastille>
              <p className="mt-2">Autorise le CRM à écrire dans Drive (ses propres fichiers seulement) et à lire, ranger et envoyer les mails de la boîte.</p>
              <a href="/api/google/connexion" className="mt-3 inline-flex h-9 items-center rounded-[8px] bg-[#1D9E75] px-3.5 text-[13px] font-medium text-[#0B1612] hover:bg-[#5DCAA5]">
                Connecter le compte Google
              </a>
            </div>
          )}
        </div>

        <div className={cn(CARTE, "p-4")}>
          <p className="flex items-center gap-2 text-[14px] font-medium text-[#F2F3F5]">
            <CloudUpload size={15} aria-hidden /> Miroir Google Drive
          </p>
          {!drive.actif ? (
            <p className="mt-2 text-[12.5px] text-[#9CA3AF]">Inactif tant qu&apos;aucun compte Google n&apos;est connecté. Le CRM reste la référence : Drive n&apos;en est qu&apos;une copie lisible.</p>
          ) : (
            <div className="mt-2 text-[12.5px] text-[#9CA3AF]">
              <p>
                {drive.aJour} élément{drive.aJour > 1 ? "s" : ""} à jour sur {drive.elements}
                {drive.dernierPassage ? ` · dernier passage le ${formatHorodatage(drive.dernierPassage)}` : ""}
              </p>
              {drive.enErreur.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5 text-[#F5B454]">
                  {drive.enErreur.slice(0, 5).map((ligne) => (
                    <li key={ligne.cle}>
                      {ligne.nom} : {ligne.erreur}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Bouton
                  taille="sm"
                  icone={<RefreshCw size={13} aria-hidden />}
                  chargement={envoi === "synchro"}
                  onClick={() => void action("synchro", () => envoyerJson("/api/drive/synchroniser", "POST", {}), "Synchronisation lancée en tâche de fond")}
                >
                  Synchroniser maintenant
                </Bouton>
                <Bouton
                  taille="sm"
                  variante="fantome"
                  chargement={envoi === "verification"}
                  onClick={() => void action("verification", () => envoyerJson("/api/drive/synchroniser", "POST", { verifier: true }), "Vérification lancée en tâche de fond")}
                >
                  Vérifier Drive
                </Bouton>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
