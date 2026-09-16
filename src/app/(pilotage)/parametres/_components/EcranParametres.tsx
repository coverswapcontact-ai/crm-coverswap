"use client";

import { useState } from "react";
import { History, Pencil } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { ChampsParametre, saisieVide, versCorps } from "@/components/pilotage/SaisieParametres";
import { Bouton, EnTetePage, Modale, Pastille, TRANS, TitreSection } from "@/components/pilotage/ui";
import { formatDateCourte } from "@/lib/dossiers/dates";
import {
  GROUPES_PARAMETRES,
  formaterValeurParametre,
  type CleParametre,
  type GroupeParametre,
  type ParametreVue,
} from "@/lib/parametres/definitions";
import { cn } from "@/lib/utils";

function LigneParametre({ parametre, onModifier }: { parametre: ParametreVue; onModifier: () => void }) {
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);
  const futures = parametre.historique.filter((ligne) => new Date(ligne.valableDu) > new Date());
  return (
    <li className="border-t-[0.5px] border-[#2A2D34] px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] text-[#F2F3F5]">{parametre.libelle}</p>
          {parametre.courante ? (
            <p className="mt-0.5 text-[12.5px] text-[#9CA3AF]">
              <span className="font-medium text-[#F2F3F5]">{formaterValeurParametre(parametre.cle, parametre.courante.valeur)}</span>
              {" · depuis le "}
              {formatDateCourte(parametre.courante.valableDu)}
              {parametre.courante.source ? ` · ${parametre.courante.source}` : ""}
            </p>
          ) : (
            <p className="mt-1">
              <Pastille ton="ambre">À renseigner</Pastille>
            </p>
          )}
          {futures.length > 0 ? (
            <p className="mt-0.5 text-[12px] text-[#93C5FD]">
              {futures.length === 1
                ? `Nouvelle valeur au ${formatDateCourte(futures[0].valableDu)} : ${formaterValeurParametre(parametre.cle, futures[0].valeur)}`
                : `${futures.length} valeurs à venir`}
            </p>
          ) : null}
        </div>
        <span className="flex items-center gap-1">
          {parametre.historique.length > 1 ? (
            <Bouton taille="sm" variante="fantome" icone={<History size={13} aria-hidden />} onClick={() => setHistoriqueOuvert((ouvert) => !ouvert)}>
              Historique
            </Bouton>
          ) : null}
          <Bouton taille="sm" icone={<Pencil size={13} aria-hidden />} onClick={onModifier}>
            {parametre.courante ? "Nouvelle valeur" : "Renseigner"}
          </Bouton>
        </span>
      </div>
      {historiqueOuvert ? (
        <ul className="mt-2 rounded-[8px] bg-[#16181D] px-3 py-2">
          {parametre.historique.map((ligne) => (
            <li key={ligne.id} className="py-0.5 text-[12px] text-[#9CA3AF]">
              {formaterValeurParametre(parametre.cle, ligne.valeur)} à partir du {formatDateCourte(ligne.valableDu)}
              {ligne.source ? ` · ${ligne.source}` : ""} · saisi le {formatDateCourte(ligne.saisiLe)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function EcranParametres({ initiaux }: { initiaux: ParametreVue[] }) {
  const [parametres, setParametres] = useState(initiaux);
  const [enModification, setEnModification] = useState<CleParametre | null>(null);
  const [saisie, setSaisie] = useState(saisieVide());
  const [envoi, setEnvoi] = useState(false);
  // Les réglages de l'IA sont facultatifs : sans eux, elle reste simplement désactivée.
  const aRenseigner = parametres.filter((parametre) => !parametre.courante && parametre.groupe !== "AGENT").length;

  function ouvrir(cle: CleParametre) {
    setSaisie({ ...saisieVide(), valableDu: new Date().toISOString().slice(0, 10) });
    setEnModification(cle);
  }

  async function enregistrer() {
    if (!enModification) return;
    setEnvoi(true);
    try {
      const { parametres: misAJour } = await envoyerJson<{ parametres: ParametreVue[] }>("/api/parametres", "POST", {
        saisies: [versCorps(enModification, saisie)],
      });
      setParametres(misAJour);
      setEnModification(null);
      toast.success("Valeur enregistrée", { description: "L'ancienne valeur reste appliquée à sa période." });
    } catch (erreur) {
      toast.error("Enregistrement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Paramètres"
        sousTitre={
          aRenseigner > 0 ? (
            <span className="text-[#F5B454]">
              {aRenseigner} à renseigner : ils seront demandés à leur première utilisation.
            </span>
          ) : (
            "Seuils, taux et règles datés. Une nouvelle valeur ne réécrit jamais le passé."
          )
        }
      />
      <p className="mt-3 text-[12.5px] leading-relaxed text-[#6B7280]">
        Aucune valeur n&apos;est fournie par défaut : chacune se lit à la source indiquée et se fait confirmer par le
        comptable au besoin.
      </p>
      {(Object.keys(GROUPES_PARAMETRES) as GroupeParametre[]).map((groupe) => {
        const liste = parametres.filter((parametre) => parametre.groupe === groupe);
        if (liste.length === 0) return null;
        return (
          <section key={groupe} className="mt-6">
            <TitreSection>{GROUPES_PARAMETRES[groupe]}</TitreSection>
            {groupe === "AGENT" ? (
              <p className="-mt-1 mb-3 text-[12.5px] leading-relaxed text-[#6B7280]">
                Facultatif : tant que ces réglages manquent, l&apos;IA ne lit aucun mail et ne coûte rien ; l&apos;agent trie avec ses règles sûres. La clé ANTHROPIC_API_KEY se pose sur le serveur, jamais ici.
              </p>
            ) : null}
            <ul className={cn("overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]", TRANS)}>
              {liste.map((parametre) => (
                <LigneParametre key={parametre.cle} parametre={parametre} onModifier={() => ouvrir(parametre.cle)} />
              ))}
            </ul>
          </section>
        );
      })}

      <Modale
        ouverte={enModification !== null}
        onFermer={() => setEnModification(null)}
        titre="Nouvelle valeur"
        description="Elle s'applique à partir de sa date d'effet ; les périodes passées gardent leur valeur."
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setEnModification(null)}>
              Annuler
            </Bouton>
            <Bouton variante="primaire" chargement={envoi} disabled={!saisie.valeur.trim() || !saisie.valableDu} onClick={() => void enregistrer()}>
              Enregistrer
            </Bouton>
          </div>
        }
      >
        {enModification ? <ChampsParametre cle={enModification} saisie={saisie} onChange={setSaisie} /> : null}
      </Modale>
    </div>
  );
}
