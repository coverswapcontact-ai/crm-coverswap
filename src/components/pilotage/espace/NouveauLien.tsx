"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CaseACocher, Modale, ZoneTexte } from "@/components/pilotage/ui";

/**
 * « Nouveau lien » : l'ancien lien du client cesse de fonctionner (tous ses
 * projets), un nouveau est émis ; le SMS qui le porte est relu ici et part au
 * clic — décochable. Rien ne part sans ce clic.
 */
export function NouveauLien({ permanentId, texteSms, numero, onFait, taille = "sm" }: { permanentId: string; texteSms: string; numero: string | null; onFait: () => void | Promise<void>; taille?: "sm" | "md" }) {
  const [ouverte, setOuverte] = useState(false);
  const [texte, setTexte] = useState(texteSms);
  const [sms, setSms] = useState(Boolean(numero));
  const [occupe, setOccupe] = useState(false);

  async function regenerer() {
    setOccupe(true);
    try {
      const r = await envoyerJson<{ lien: string; sms: { statut: string } | null }>(`/api/espaces/${permanentId}`, "POST", { action: "regenerer", sms, texte });
      toast.success(r.sms ? "Nouveau lien émis, SMS envoyé : l'ancien ne fonctionne plus" : "Nouveau lien émis : l'ancien ne fonctionne plus");
      setOuverte(false);
      await onFait();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <>
      <Bouton taille={taille === "sm" ? "sm" : undefined} variante="fantome" icone={<RefreshCw size={13} aria-hidden />} onClick={() => { setTexte(texteSms); setSms(Boolean(numero)); setOuverte(true); }}>
        Nouveau lien…
      </Bouton>
      <Modale
        ouverte={ouverte}
        onFermer={() => setOuverte(false)}
        titre="Émettre un nouveau lien pour son espace"
        description="L'ancien lien cesse de fonctionner tout de suite, pour tous ses projets. Rien n'est effacé."
        largeur="sm"
        pied={
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setOuverte(false)}>Annuler</Bouton>
            <Bouton variante="primaire" chargement={occupe} onClick={() => void regenerer()}>
              {sms ? "Émettre et envoyer le SMS" : "Émettre le nouveau lien"}
            </Bouton>
          </div>
        }
      >
        <div className="space-y-3">
          <CaseACocher libelle={numero ? `Envoyer le nouveau lien par SMS (${numero})` : "Envoyer par SMS"} description={numero ? "Relisez le texte : {lien} est remplacé par le nouveau lien." : "Aucun numéro connu : copiez le lien ensuite."} checked={sms} disabled={!numero} onChange={setSms} />
          {sms ? <ZoneTexte libelle="Le SMS" rows={4} value={texte} maxLength={700} onChange={(e) => setTexte(e.target.value)} /> : null}
        </div>
      </Modale>
    </>
  );
}
