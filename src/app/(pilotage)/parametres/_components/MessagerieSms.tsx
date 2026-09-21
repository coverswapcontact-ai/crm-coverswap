"use client";

import { useEffect, useState } from "react";
import { MessageSquare, RotateCcw, Save, Zap } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CLASSE_SAISIE, Pastille, TitreSection } from "@/components/pilotage/ui";
import type { EtatFournisseur } from "@/lib/sms/fournisseurs";
import type { ModeleVue } from "@/lib/sms/modeles";
import { mesurerSms, simplifierPourGsm } from "@/lib/sms/texte";
import { cn } from "@/lib/utils";

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]";

type Reponse = { modeles: ModeleVue[]; fournisseur: EtatFournisseur };

const NOMS_FOURNISSEUR: Record<string, string> = { ovh: "OVHcloud — numéro 09 (envoi et réponses)", brevo: "Brevo (envoi seul)", simulateur: "Simulateur (aucun SMS réel)" };

/**
 * Messagerie SMS : ce qui est branché, et les messages types.
 * Un message type n'est jamais envoyé tel quel (sauf l'accusé de réception) :
 * il est proposé, Lucas le relit, le corrige, l'envoie. Le corriger ici change
 * ce qui sera proposé la prochaine fois.
 */
export default function MessagerieSms() {
  const [donnees, setDonnees] = useState<Reponse | null>(null);

  useEffect(() => {
    let actif = true;
    appelApi<Reponse>("/api/sms/modeles")
      .then((reponse) => actif && setDonnees(reponse))
      .catch((erreur) => toast.error("Messagerie SMS indisponible", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, []);

  if (!donnees) return null;
  const { fournisseur, modeles } = donnees;

  const remplacer = (modele: ModeleVue) => setDonnees((actuel) => (actuel ? { ...actuel, modeles: actuel.modeles.map((m) => (m.id === modele.id ? modele : m)) } : actuel));

  return (
    <section className="mt-10" id="sms">
      <TitreSection>Messagerie SMS</TitreSection>

      <div className={cn(CARTE, "p-4")}>
        <p className="flex items-center gap-2 text-[14px] font-medium text-[#F2F3F5]">
          <MessageSquare size={15} aria-hidden /> Fournisseur
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-[#9CA3AF]">
          {fournisseur.nom ? <Pastille ton={fournisseur.bidirectionnel && fournisseur.nom !== "simulateur" ? "vert" : "ambre"}>{NOMS_FOURNISSEUR[fournisseur.nom] ?? fournisseur.nom}</Pastille> : <Pastille ton="rouge">Aucun fournisseur</Pastille>}
          {fournisseur.expediteur ? <span>Expéditeur : {fournisseur.expediteur}</span> : null}
        </div>
        {fournisseur.remarque ? <p className="mt-2 text-[12.5px] leading-relaxed text-[#F5B454]">{fournisseur.remarque}</p> : null}
        {fournisseur.aPoser.length > 0 ? (
          <div className="mt-3 text-[12.5px] leading-relaxed text-[#9CA3AF]">
            <p>Variables à poser sur Railway pour le numéro OVH (envoi et réception) :</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {fournisseur.aPoser.map((variable) => (
                <li key={variable} className="rounded-[6px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-2 py-0.5 font-mono text-[11.5px] text-[#D1D5DB]">
                  {variable}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <p className="mt-6 mb-2 text-[12.5px] leading-relaxed text-[#9CA3AF]">
        Messages types. Variables : <code className="text-[#D1D5DB]">{"{prenom}"}</code>, <code className="text-[#D1D5DB]">{"{lien}"}</code> (espace client), <code className="text-[#D1D5DB]">{"{validite}"}</code>. Un accent
        rare (ê, ç, œ, guillemets « ») fait passer le SMS en Unicode : 70 caractères par SMS au lieu de 160.
      </p>
      <div className="space-y-3">
        {modeles.map((modele) => (
          <CarteModele key={modele.id} modele={modele} onChange={remplacer} />
        ))}
      </div>
    </section>
  );
}

function CarteModele({ modele, onChange }: { modele: ModeleVue; onChange: (modele: ModeleVue) => void }) {
  const [texte, setTexte] = useState(modele.texte);
  const [envoi, setEnvoi] = useState<"texte" | "actif" | null>(null);
  const mesure = mesurerSms(texte);
  const modifie = texte.trim() !== modele.texte;

  async function enregistrer(donnees: { texte?: string; actif?: boolean }, quoi: "texte" | "actif") {
    setEnvoi(quoi);
    try {
      const { modele: aJour } = await envoyerJson<{ modele: ModeleVue }>(`/api/sms/modeles/${modele.id}`, "PATCH", donnees);
      onChange(aJour);
      setTexte(aJour.texte);
      toast.success(quoi === "texte" ? "Message type enregistré" : aJour.actif ? "Message réactivé" : "Message coupé");
    } catch (erreur) {
      toast.error("Non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <div className={cn(CARTE, "p-4", !modele.actif && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-[#F2F3F5]">
          {modele.libelle}
          {modele.automatique ? (
            <Pastille ton="vert">
              <Zap size={11} aria-hidden /> Part tout seul
            </Pastille>
          ) : null}
          {!modele.actif ? <Pastille ton="ambre">Coupé</Pastille> : null}
        </p>
        <Bouton taille="sm" variante="fantome" chargement={envoi === "actif"} onClick={() => void enregistrer({ actif: !modele.actif }, "actif")}>
          {modele.actif ? (modele.automatique ? "Couper l'envoi automatique" : "Ne plus proposer") : "Réactiver"}
        </Bouton>
      </div>
      <textarea
        value={texte}
        onChange={(evenement) => setTexte(evenement.target.value)}
        rows={3}
        aria-label={`Texte du message « ${modele.libelle} »`}
        className={cn(CLASSE_SAISIE, "mt-3 min-h-[84px] resize-y py-2 leading-relaxed")}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#9CA3AF]">
        <p className={cn(mesure.segments > 2 || !mesure.gsm ? "text-[#F5B454]" : undefined)}>
          {mesure.longueur} caractères · {mesure.segments} SMS{!mesure.gsm ? ` · Unicode à cause de : ${mesure.horsGsm.slice(0, 6).join(" ")}` : ""}
          <span className="text-[#6B7280]"> (hors prénom et lien, qui s&apos;ajoutent)</span>
        </p>
        <div className="flex gap-2">
          {!mesure.gsm ? (
            <Bouton taille="sm" variante="fantome" onClick={() => setTexte(simplifierPourGsm(texte))}>
              Simplifier les accents
            </Bouton>
          ) : null}
          {modifie ? (
            <Bouton taille="sm" variante="fantome" icone={<RotateCcw size={12} aria-hidden />} onClick={() => setTexte(modele.texte)}>
              Annuler
            </Bouton>
          ) : null}
          <Bouton taille="sm" variante="primaire" icone={<Save size={12} aria-hidden />} disabled={!modifie || texte.trim().length === 0} chargement={envoi === "texte"} onClick={() => void enregistrer({ texte: texte.trim() }, "texte")}>
            Enregistrer
          </Bouton>
        </div>
      </div>
    </div>
  );
}
