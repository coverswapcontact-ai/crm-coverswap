"use client";

import { useState } from "react";
import { ChevronDown, MessageSquare, RotateCcw, Save, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CLASSE_SAISIE, Pastille, TitreSection, CARTE } from "@/components/pilotage/ui";
import type { EtatFournisseur } from "@/lib/sms/fournisseurs";
import type { ModeleCatalogue, ModeleVue } from "@/lib/sms/modeles";
import { GROUPES_SMS, LIBELLES_GROUPE_SMS, LIBELLES_VARIABLE_SMS, LONGUEUR_VISEE, aUnInterrupteur, verifierTexteSms, type GroupeSms, type VariableSms } from "@/lib/sms/catalogue";
import { mesurerSms, remplirModele, simplifierPourGsm } from "@/lib/sms/texte";
import { cn } from "@/lib/utils";

export type ReponseSms = { modeles: ModeleCatalogue[]; fournisseur: EtatFournisseur };
type Reponse = ReponseSms;

const NOMS_FOURNISSEUR: Record<string, string> = { ovh: "OVHcloud — numéro 09 (envoi et réponses)", brevo: "Brevo (envoi seul)", simulateur: "Simulateur (aucun SMS réel)" };

/** Des valeurs d'exemple, pour compter les caractères comme le client les recevra. */
const EXEMPLE = { prenom: "Camille", quand: "demain vers 18 h", lien: "https://coverswap.fr/e/AB12CD-Xy3kP9qLm2Rt7vWz", validite: "12 octobre", montant: "1 500 EUR" };

/**
 * Paramètres → SMS (mission 14, partie 5) : le fournisseur, puis LE catalogue des
 * SMS, par groupe. Un seul endroit pour les textes : l'écran SMS, l'assistant et
 * les relances lisent ceux-ci. Rien ne part tout seul sauf les deux accusés de
 * réception ; copier un SMS vaut envoi.
 */
export default function MessagerieSms({ initial }: { initial: Reponse }) {
  // Mission 13 (lot 3) : les modèles arrivent du serveur avec la page.
  const [donnees, setDonnees] = useState<Reponse>(initial);
  const { fournisseur, modeles } = donnees;

  const remplacer = (vue: ModeleVue) => setDonnees((actuel) => ({ ...actuel, modeles: actuel.modeles.map((m) => (m.id === vue.id ? { ...m, texte: vue.texte, actif: vue.actif } : m)) }));
  const duGroupe = (groupe: GroupeSms) => modeles.filter((m) => m.groupe === groupe);

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

      <div className="mt-6 space-y-1.5 text-[12.5px] leading-relaxed text-[#9CA3AF]">
        <p>
          <span className="text-[#F2F3F5]">Un seul endroit pour les textes SMS.</span>{" "}
          L&apos;écran SMS, l&apos;assistant et les relances lisent ceux-ci : ce que tu corriges ici est ce qui sera proposé la prochaine fois.
        </p>
        <p>Rien ne part tout seul, sauf les deux accusés de réception. Les autres SMS s&apos;ouvrent préremplis : tu relis, tu copies, tu colles dans Messages. Copier un SMS vaut envoi : il s&apos;écrit dans l&apos;historique du lead ou du dossier.</p>
        <p>Règles d&apos;écriture : parler du projet, pas de la pièce ; ne jamais promettre de simulation ; court et naturel (160 caractères, un SMS, quand il n&apos;y a pas de lien) ; le lien toujours à la fin.</p>
      </div>

      {GROUPES_SMS.filter((groupe) => groupe !== "ANCIEN").map((groupe) =>
        duGroupe(groupe).length ? (
          <div key={groupe} className="mt-6">
            <h3 className="mb-2 text-[12px] font-medium tracking-wide text-[#8B919C] uppercase">{LIBELLES_GROUPE_SMS[groupe]}</h3>
            <div className="space-y-3">
              {duGroupe(groupe).map((modele) => (
                <CarteModele key={modele.code} modele={modele} onChange={remplacer} />
              ))}
            </div>
          </div>
        ) : null
      )}

      {duGroupe("ANCIEN").length ? (
        <details className="group mt-8">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[12px] font-medium tracking-wide text-[#8B919C] uppercase [&::-webkit-details-marker]:hidden">
            <ChevronDown size={14} aria-hidden className="transition-transform group-open:rotate-180" />
            {LIBELLES_GROUPE_SMS.ANCIEN}
          </summary>
          <p className="mb-3 text-[12.5px] leading-relaxed text-[#9CA3AF]">Encore lus par l&apos;ancien circuit de relances (tu valides, le fournisseur envoie), tels quels jusqu&apos;à son retrait.</p>
          <div className="space-y-3">
            {duGroupe("ANCIEN").map((modele) => (
              <CarteModele key={modele.code} modele={modele} onChange={remplacer} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function CarteModele({ modele, onChange }: { modele: ModeleCatalogue; onChange: (modele: ModeleVue) => void }) {
  const [texte, setTexte] = useState(modele.texte);
  const [envoi, setEnvoi] = useState<"texte" | "actif" | null>(null);
  const exemple = remplirModele(texte, EXEMPLE);
  const mesure = mesurerSms(exemple);
  const modifie = texte.trim() !== modele.texte;
  const refus = texte.trim() ? verifierTexteSms(modele.code, texte) : "Le texte du message est vide.";
  // Ce qui peut partir par le fournisseur (facturé au SMS) : les accents à simplifier. Seuls les accusés et l'ancien circuit ont un interrupteur.
  const parLeFournisseur = modele.fournisseur;
  const interrupteur = aUnInterrupteur(modele);
  const coupe = interrupteur && !modele.actif;

  async function enregistrer(donnees: { texte?: string; actif?: boolean }, quoi: "texte" | "actif") {
    if (!modele.id) return;
    setEnvoi(quoi);
    try {
      const { modele: aJour } = await envoyerJson<{ modele: ModeleVue }>(`/api/sms/modeles/${modele.id}`, "PATCH", donnees);
      onChange(aJour);
      setTexte(aJour.texte);
      toast.success(quoi === "texte" ? "Texte enregistré" : aJour.actif ? "Message réactivé" : "Message coupé");
    } catch (erreur) {
      toast.error("Non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <div className={cn(CARTE, "p-4", coupe && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-[#F2F3F5]">
          {modele.libelle}
          {modele.automatique ? (
            <Pastille ton="vert">
              <Zap size={11} aria-hidden /> Part tout seul
            </Pastille>
          ) : null}
          {coupe ? <Pastille ton="ambre">Coupé</Pastille> : null}
        </p>
        {interrupteur && modele.id ? (
          <Bouton taille="sm" variante="fantome" chargement={envoi === "actif"} onClick={() => void enregistrer({ actif: !modele.actif }, "actif")}>
            {modele.actif ? (modele.automatique ? "Couper l'envoi automatique" : "Ne plus proposer") : "Réactiver"}
          </Bouton>
        ) : null}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#9CA3AF]">{modele.usage}</p>
      <p className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px] text-[#8B919C]">
        {modele.variables.map((variable) => (
          <code key={variable} title={LIBELLES_VARIABLE_SMS[variable as VariableSms]} className="rounded-[6px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-1.5 py-0.5 text-[#D1D5DB]">
            {`{${variable}}`}
          </code>
        ))}
      </p>
      <textarea
        value={texte}
        disabled={!modele.id}
        onChange={(evenement) => setTexte(evenement.target.value)}
        rows={3}
        aria-label={`Texte du message « ${modele.libelle} »`}
        aria-invalid={modifie && refus ? true : undefined}
        className={cn(CLASSE_SAISIE, "mt-3 min-h-[84px] resize-y py-2 leading-relaxed")}
      />
      {modifie && refus ? <p className="mt-1 text-[12px] text-[#F87171]">{refus}</p> : null}
      {!modele.id ? <p className="mt-1 text-[12px] text-[#6B7280]">Pas encore en base : il sera posé au prochain démarrage.</p> : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#9CA3AF]">
        <p>
          {mesure.longueur} caractères · {mesure.segments} SMS
          {!modele.lien && mesure.longueur > LONGUEUR_VISEE ? <span className="text-[#F5B454]"> · Vise {LONGUEUR_VISEE} caractères</span> : null}
          {!mesure.gsm ? <span className={parLeFournisseur ? "text-[#F5B454]" : undefined}> · Unicode à cause de : {mesure.horsGsm.slice(0, 6).join(" ")}</span> : null}
          <span className="text-[#6B7280]"> (avec un prénom{modele.lien ? ", le lien" : ""}{modele.variables.includes("quand") ? ", « demain vers 18 h »" : ""})</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {parLeFournisseur && !mesure.gsm ? (
            <Bouton taille="sm" variante="fantome" onClick={() => setTexte(simplifierPourGsm(texte))}>
              Simplifier les accents
            </Bouton>
          ) : null}
          {texte.trim() !== modele.defaut ? (
            <Bouton taille="sm" variante="fantome" icone={<Undo2 size={12} aria-hidden />} disabled={!modele.id} onClick={() => setTexte(modele.defaut)}>
              Revenir au texte de départ
            </Bouton>
          ) : null}
          {modifie ? (
            <Bouton taille="sm" variante="fantome" icone={<RotateCcw size={12} aria-hidden />} onClick={() => setTexte(modele.texte)}>
              Annuler
            </Bouton>
          ) : null}
          <Bouton taille="sm" variante="primaire" icone={<Save size={12} aria-hidden />} disabled={!modele.id || !modifie || Boolean(refus)} chargement={envoi === "texte"} onClick={() => void enregistrer({ texte: texte.trim() }, "texte")}>
            Enregistrer
          </Bouton>
        </div>
      </div>
    </div>
  );
}
