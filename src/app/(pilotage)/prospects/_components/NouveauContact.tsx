"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, ListeDeroulante, Modale, ZoneTexte } from "@/components/pilotage/ui";
import { LIBELLES_TYPE_PROJET, SOURCES_LEAD, TYPES_PROJET, libelleSourceLead } from "@/lib/prospects/constantes";

/** Contact saisi à la main (appel, salon, recommandation) : seul un prénom ou un nom est exigé. */
export function NouveauContact({ onFermer, onCree }: { onFermer: () => void; onCree: (id: string) => void }) {
  const [champs, setChamps] = useState({ prenom: "", nomFamille: "", telephone: "", email: "", ville: "", codePostal: "", source: "AUTRE", typeProjet: "CUISINE", notes: "" });
  const [envoi, setEnvoi] = useState(false);
  const changer = (cle: keyof typeof champs) => (evenement: { target: { value: string } }) => setChamps((actuels) => ({ ...actuels, [cle]: evenement.target.value }));
  const nomRenseigne = Boolean(champs.prenom.trim() || champs.nomFamille.trim());

  async function creer() {
    setEnvoi(true);
    try {
      const { id } = await envoyerJson<{ id: string }>("/api/prospects/entrants", "POST", {
        ...champs,
        email: champs.email.trim() || null,
        codePostal: champs.codePostal.trim() || null,
        notes: champs.notes.trim() || null,
      });
      toast.success("Contact enregistré", { description: "Rattaché à la fiche client qui a ces coordonnées, ou à une nouvelle fiche." });
      onCree(id);
    } catch (erreur) {
      toast.error("Contact non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Nouveau contact"
      description="Un appel, un salon, une recommandation : il rejoint les contacts à traiter."
      pied={
        <div className="flex justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" icone={<UserPlus size={15} aria-hidden />} disabled={!nomRenseigne} chargement={envoi} onClick={() => void creer()}>
            Enregistrer le contact
          </Bouton>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ libelle="Prénom" maxLength={80} value={champs.prenom} onChange={changer("prenom")} />
        <Champ libelle="Nom" maxLength={120} value={champs.nomFamille} onChange={changer("nomFamille")} />
        <Champ libelle="Téléphone" type="tel" inputMode="tel" maxLength={40} value={champs.telephone} onChange={changer("telephone")} />
        <Champ libelle="E-mail" type="email" inputMode="email" maxLength={160} value={champs.email} onChange={changer("email")} />
        <Champ libelle="Ville" maxLength={80} value={champs.ville} onChange={changer("ville")} />
        <Champ libelle="Code postal" inputMode="numeric" maxLength={10} value={champs.codePostal} onChange={changer("codePostal")} />
        <ListeDeroulante libelle="D'où vient-il ?" value={champs.source} onChange={changer("source")} options={SOURCES_LEAD.map((valeur) => ({ valeur, libelle: libelleSourceLead(valeur) }))} />
        <ListeDeroulante libelle="Projet" value={champs.typeProjet} onChange={changer("typeProjet")} options={TYPES_PROJET.map((valeur) => ({ valeur, libelle: LIBELLES_TYPE_PROJET[valeur] }))} />
        <ZoneTexte classeConteneur="sm:col-span-2" libelle="Notes" rows={3} maxLength={5000} placeholder="Ce qu'il veut, quand le rappeler…" value={champs.notes} onChange={changer("notes")} />
      </div>
      {!nomRenseigne ? <p className="mt-2 text-[12px] text-[#6B7280]">Un prénom ou un nom suffit ; le reste se complète plus tard.</p> : null}
    </Modale>
  );
}
