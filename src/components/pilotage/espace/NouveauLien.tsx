"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CaseACocher, Modale, ZoneTexte } from "@/components/pilotage/ui";
import { PHRASE_NOUVEAU_LIEN } from "@/lib/espace/textes";

/**
 * « Nouveau lien » : l'ancien lien du client cesse de fonctionner (tous ses
 * projets), un nouveau est émis ; le mail qui le porte (mission 7 : le mail
 * prend le relais du SMS) est relu ici et part au clic — décochable. Rien ne
 * part sans ce clic.
 */
export function NouveauLien({ permanentId, email, onFait, taille = "sm" }: { permanentId: string; email: string | null; onFait: () => void | Promise<void>; taille?: "sm" | "md" }) {
  const [ouverte, setOuverte] = useState(false);
  const [texte, setTexte] = useState(PHRASE_NOUVEAU_LIEN);
  const [mail, setMail] = useState(Boolean(email));
  const [occupe, setOccupe] = useState(false);

  async function regenerer() {
    setOccupe(true);
    try {
      const r = await envoyerJson<{ lien: string; mail: { id: string } | null }>(`/api/espaces/${permanentId}`, "POST", { action: "regenerer", mail, texte });
      toast.success(r.mail ? "Nouveau lien émis, le mail part : l'ancien ne fonctionne plus" : "Nouveau lien émis : l'ancien ne fonctionne plus");
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
      <Bouton taille={taille === "sm" ? "sm" : undefined} variante="fantome" icone={<RefreshCw size={13} aria-hidden />} onClick={() => { setTexte(PHRASE_NOUVEAU_LIEN); setMail(Boolean(email)); setOuverte(true); }}>
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
              {mail ? "Émettre et envoyer le mail" : "Émettre le nouveau lien"}
            </Bouton>
          </div>
        }
      >
        <div className="space-y-3">
          <CaseACocher
            libelle={email ? `Envoyer le nouveau lien par mail (${email})` : "Envoyer par mail"}
            description={email ? "« Bonjour » avec son prénom et le bouton « Ouvrir mon espace » s'ajoutent d'eux-mêmes." : "Aucune adresse e-mail connue : copiez le lien ensuite."}
            checked={mail}
            disabled={!email}
            onChange={setMail}
          />
          {mail ? <ZoneTexte libelle="La phrase du mail" rows={3} value={texte} maxLength={600} onChange={(e) => setTexte(e.target.value)} /> : null}
        </div>
      </Modale>
    </>
  );
}
