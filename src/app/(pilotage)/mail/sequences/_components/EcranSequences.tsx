"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Eye, Pause, PencilLine, Play, Save, Send, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CLASSE_SAISIE, EnTetePage, Modale, Pastille, Puces, TRANS } from "@/components/pilotage/ui";
import type { ApercuEtape, SequenceVue } from "@/lib/mail/sequences";
import { cn } from "@/lib/utils";

/**
 * Séquences de mails (mission 7) : tout est prêt, rien n'est actif. Chaque
 * séquence se lit d'un coup d'œil (déclencheur, mails, qui est concerné
 * aujourd'hui) ; ses textes se corrigent ici, chaque mail s'aperçoit avec un
 * vrai client. Activer demande une confirmation ; en mode validation, chaque
 * mail attend votre clic, en bas de sa séquence.
 */

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]";
const MODES = [
  { valeur: "VALIDATION", libelle: "Je valide chaque mail" },
  { valeur: "AUTOMATIQUE", libelle: "Automatique" },
] as const;

type Etape = SequenceVue["etapes"][number];
type Confirmation = { titre: string; texte: string; bouton: string; donnees: Record<string, unknown>; succes: string };
type CibleApercu = { rang: number; cle?: string; inscriptionId?: string };

const jours = (n: number) => `${n} jour${n > 1 ? "s" : ""}`;
const quand = (etape: Etape, premiere: boolean) =>
  premiere ? (etape.delaiJours === 0 ? "dès l'entrée dans la séquence" : `${jours(etape.delaiJours)} après l'entrée`) : `${jours(etape.delaiJours)} après le mail précédent`;

export default function EcranSequences({ initial, expediteur }: { initial: SequenceVue[]; expediteur: string | null }) {
  const [sequences, setSequences] = useState(initial);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Séquences"
        sousTitre="Tout est prêt, rien n'est actif. Une séquence s'arrête dès que le client répond, signe ou agit dans son espace."
        actions={
          <Link href="/mail" className={cn("inline-flex h-10 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-3 text-[13px] font-medium text-[#D1D5DB] hover:border-[#3A3E47] sm:h-8", TRANS)}>
            <ArrowLeft size={14} aria-hidden /> Mail
          </Link>
        }
      />
      <div className={cn(CARTE, "flex items-start gap-3 p-3.5 text-[12.5px] leading-relaxed text-[#9CA3AF]")}>
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#5DCAA5]" aria-hidden />
        <p>
          Chaque mail porte un lien de désinscription, et une désinscription est définitive. Envoi depuis{" "}
          {expediteur ? <span className="text-[#D1D5DB]">{expediteur}</span> : "la boîte Gmail connectée"}{" "}
          — à changer dans Paramètres, « Adresse d&apos;expédition des séquences ».
        </p>
      </div>
      <ul className="space-y-3">
        {sequences.map((sequence) => (
          <CarteSequence key={sequence.id} sequence={sequence} onMaj={setSequences} />
        ))}
      </ul>
    </div>
  );
}

function CarteSequence({ sequence, onMaj }: { sequence: SequenceVue; onMaj: (sequences: SequenceVue[]) => void }) {
  const [occupe, setOccupe] = useState<string | null>(null);
  const [plafond, setPlafond] = useState(String(sequence.plafondJour));
  const [edition, setEdition] = useState<Etape[] | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [apercu, setApercu] = useState<CibleApercu | null>(null);

  async function regler(donnees: Record<string, unknown>, quoi: string, succes: string): Promise<boolean> {
    setOccupe(quoi);
    try {
      onMaj((await envoyerJson<{ sequences: SequenceVue[] }>(`/api/mail/sequences/${sequence.code}`, "PATCH", donnees)).sequences);
      toast.success(succes);
      return true;
    } catch (erreur) {
      toast.error("Non enregistré", { description: messageErreur(erreur) });
      return false;
    } finally {
      setOccupe(null);
    }
  }

  async function trancher(inscriptionId: string, action: "ENVOYER" | "ARRETER") {
    setOccupe(`${action}:${inscriptionId}`);
    try {
      await envoyerJson(`/api/mail/sequences/inscriptions/${inscriptionId}`, "POST", { action });
      toast.success(action === "ENVOYER" ? "Mail validé : il part" : "Séquence arrêtée pour ce contact");
      setApercu(null);
      onMaj((await appelApi<{ sequences: SequenceVue[] }>("/api/mail/sequences")).sequences);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  function changerMode(mode: SequenceVue["mode"]) {
    if (mode === sequence.mode) return;
    if (mode === "AUTOMATIQUE" && sequence.active) {
      setConfirmation({
        titre: "Passer en automatique ?",
        texte: `Les mails de « ${sequence.nom} » partiront seuls, sans votre clic, dans la limite de ${sequence.plafondJour} par jour.`,
        bouton: "Passer en automatique",
        donnees: { mode },
        succes: "Automatique : les mails partent seuls, dans la limite du plafond",
      });
      return;
    }
    void regler({ mode }, "mode", mode === "AUTOMATIQUE" ? "Mode automatique enregistré (la séquence reste inactive)" : "Mode validation : chaque mail attendra votre clic");
  }

  function activer() {
    const auto = sequence.mode === "AUTOMATIQUE";
    setConfirmation({
      titre: `Activer « ${sequence.nom} » ?`,
      texte: `${sequence.candidatsAujourdhui} contact${sequence.candidatsAujourdhui > 1 ? "s correspondent" : " correspond"} aujourd'hui. ${
        auto ? `Les mails partiront seuls, ${sequence.plafondJour} par jour au plus.` : "Chaque mail attendra votre clic, en bas de cette séquence."
      } La séquence s'arrête pour un contact dès qu'il répond, signe ou agit dans son espace.`,
      bouton: "Activer",
      donnees: { active: true },
      succes: auto ? "Séquence active : les mails partent seuls" : "Séquence active : les mails attendront votre clic",
    });
  }

  async function enregistrerTextes() {
    if (!edition) return;
    const invalide = edition.find((e) => !e.objet.trim() || e.texte.trim().length < 10 || !Number.isInteger(e.delaiJours) || e.delaiJours < 0 || e.delaiJours > 365);
    if (invalide) {
      toast.error(`Mail ${invalide.rang} : un objet, un texte d'au moins 10 caractères et un délai de 0 à 365 jours.`);
      return;
    }
    if (await regler({ etapes: edition.map(({ rang, delaiJours, objet, texte }) => ({ rang, delaiJours, objet: objet.trim(), texte: texte.trim() })) }, "textes", "Textes enregistrés")) setEdition(null);
  }

  const modifierEtape = (rang: number, champ: Partial<Etape>) => setEdition((actuel) => actuel?.map((e) => (e.rang === rang ? { ...e, ...champ } : e)) ?? null);
  const plafondValide = /^\d{1,2}$/.test(plafond) && Number(plafond) >= 1 && Number(plafond) <= 50;

  return (
    <li className={cn(CARTE, "p-4")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-medium text-[#F2F3F5]">{sequence.nom}</h2>
          <p className="mt-0.5 text-[12.5px] text-[#9CA3AF]">{sequence.declencheur}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sequence.active ? <Pastille ton="vert">Active</Pastille> : <Pastille>Inactive</Pastille>}
          <Pastille ton={sequence.mode === "AUTOMATIQUE" ? "ambre" : "neutre"}>{sequence.mode === "AUTOMATIQUE" ? "Automatique" : "Validation"}</Pastille>
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[#D1D5DB]">{sequence.description}</p>
      <p className="mt-1.5 text-[12.5px] text-[#9CA3AF] tabular-nums">
        {sequence.candidatsAujourdhui} contact{sequence.candidatsAujourdhui > 1 ? "s" : ""} concerné{sequence.candidatsAujourdhui > 1 ? "s" : ""} aujourd&apos;hui · {sequence.enCours} en cours
      </p>

      <ol className="mt-3 space-y-2">
        {(edition ?? sequence.etapes).map((etape, i) => (
          <li key={etape.rang} className="rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-[#9CA3AF]">
                Mail {etape.rang} · {quand(etape, i === 0)}
              </p>
              {edition ? null : (
                <Bouton taille="sm" variante="fantome" icone={<Eye size={13} aria-hidden />} onClick={() => setApercu({ rang: etape.rang })}>
                  Aperçu
                </Bouton>
              )}
            </div>
            {edition ? (
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2 text-[12px] text-[#9CA3AF]">
                  Délai
                  <input type="number" min={0} max={365} inputMode="numeric" value={etape.delaiJours} onChange={(e) => modifierEtape(etape.rang, { delaiJours: Number(e.target.value) })} className={cn(CLASSE_SAISIE, "h-10 w-20 sm:h-8")} />
                  jours {i === 0 ? "après l'entrée" : "après le mail précédent"}
                </label>
                <input aria-label={`Objet du mail ${etape.rang}`} value={etape.objet} maxLength={150} onChange={(e) => modifierEtape(etape.rang, { objet: e.target.value })} className={cn(CLASSE_SAISIE, "h-10 font-medium sm:h-9")} />
                <textarea aria-label={`Texte du mail ${etape.rang}`} value={etape.texte} rows={7} maxLength={4000} onChange={(e) => modifierEtape(etape.rang, { texte: e.target.value })} className={cn(CLASSE_SAISIE, "min-h-[140px] resize-y py-2 leading-relaxed")} />
              </div>
            ) : (
              <>
                <p className="mt-1.5 text-[13.5px] font-medium text-[#F2F3F5]">{etape.objet}</p>
                <p className="mt-1 line-clamp-3 text-[12.5px] whitespace-pre-line text-[#9CA3AF]">{etape.texte}</p>
              </>
            )}
          </li>
        ))}
      </ol>
      {edition ? (
        <p className="mt-2 text-[12px] text-[#6B7280]">
          Variables : {"{prenom}"}, {"{lien}"} (son espace), {"{devis}"} (numéro), {"{montant}"}. Une variable sans valeur bloque l&apos;envoi de ce mail : rien ne part avec un trou.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 border-t-[0.5px] border-[#2A2D34] pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Puces libelle="Envoi" options={MODES} valeur={sequence.mode} onChange={changerMode} />
        <div>
          <label htmlFor={`plafond-${sequence.code}`} className="mb-1.5 block text-[12px] font-medium text-[#9CA3AF]">
            Plafond par jour
          </label>
          <div className="flex gap-2">
            <input id={`plafond-${sequence.code}`} type="number" min={1} max={50} inputMode="numeric" value={plafond} onChange={(e) => setPlafond(e.target.value)} className={cn(CLASSE_SAISIE, "h-10 w-20 sm:h-8")} />
            <Bouton taille="sm" disabled={!plafondValide || Number(plafond) === sequence.plafondJour} chargement={occupe === "plafond"} onClick={() => void regler({ plafondJour: Number(plafond) }, "plafond", `Plafond : ${plafond} mails par jour`)}>
              Enregistrer
            </Bouton>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {edition ? (
          <>
            <Bouton taille="sm" variante="fantome" onClick={() => setEdition(null)}>
              Annuler
            </Bouton>
            <Bouton taille="sm" variante="primaire" icone={<Save size={13} aria-hidden />} chargement={occupe === "textes"} onClick={() => void enregistrerTextes()}>
              Enregistrer les textes
            </Bouton>
          </>
        ) : (
          <Bouton taille="sm" variante="fantome" icone={<PencilLine size={13} aria-hidden />} onClick={() => setEdition(sequence.etapes.map((e) => ({ ...e })))}>
            Modifier les textes
          </Bouton>
        )}
        {sequence.active ? (
          <Bouton taille="sm" icone={<Pause size={13} aria-hidden />} chargement={occupe === "active"} onClick={() => void regler({ active: false }, "active", "Séquence en pause : plus aucun mail ne part")}>
            Mettre en pause
          </Bouton>
        ) : (
          <Bouton taille="sm" variante="secondaire" icone={<Play size={13} aria-hidden />} disabled={Boolean(edition)} onClick={activer}>
            Activer…
          </Bouton>
        )}
      </div>

      {sequence.aValider.length ? (
        <div className="mt-4 border-t-[0.5px] border-[#2A2D34] pt-3">
          <p className="text-[12px] font-medium tracking-wide text-[#F5B454] uppercase">À valider · {sequence.aValider.length}</p>
          <ul className="mt-2 space-y-1.5">
            {sequence.aValider.map((inscription) => (
              <li key={inscription.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] bg-[#16181D] px-3 py-2">
                <span className="min-w-0 truncate text-[13px] text-[#E5E7EB]">
                  {inscription.adresse} <span className="text-[#8B919C]">· mail {inscription.etape}</span>
                </span>
                <span className="flex gap-1.5">
                  <Bouton taille="sm" variante="fantome" icone={<X size={13} aria-hidden />} chargement={occupe === `ARRETER:${inscription.id}`} onClick={() => void trancher(inscription.id, "ARRETER")}>
                    Arrêter
                  </Bouton>
                  <Bouton taille="sm" variante="primaire" icone={<Eye size={13} aria-hidden />} onClick={() => setApercu({ rang: inscription.etape, cle: inscription.cle, inscriptionId: inscription.id })}>
                    Relire
                  </Bouton>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modale
        ouverte={Boolean(confirmation)}
        onFermer={() => setConfirmation(null)}
        titre={confirmation?.titre ?? ""}
        largeur="sm"
        pied={
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setConfirmation(null)}>
              Annuler
            </Bouton>
            <Bouton
              variante="primaire"
              chargement={occupe === "confirmation"}
              onClick={() => {
                if (!confirmation) return;
                void regler(confirmation.donnees, "confirmation", confirmation.succes).then((ok) => ok && setConfirmation(null));
              }}
            >
              {confirmation?.bouton}
            </Bouton>
          </div>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-[#D1D5DB]">{confirmation?.texte}</p>
      </Modale>

      {apercu ? (
        <ApercuMail
          key={`${apercu.rang}:${apercu.cle ?? ""}`}
          code={sequence.code}
          nom={sequence.nom}
          cible={apercu}
          envoiEnCours={Boolean(apercu.inscriptionId) && occupe === `ENVOYER:${apercu.inscriptionId}`}
          onEnvoyer={apercu.inscriptionId ? () => void trancher(apercu.inscriptionId!, "ENVOYER") : undefined}
          onFermer={() => setApercu(null)}
        />
      ) : null}
    </li>
  );
}

/** Un mail de la séquence tel qu'il partirait, avec les données d'un vrai client ; « Envoyer » quand il attend votre validation. */
function ApercuMail({ code, nom, cible, envoiEnCours, onEnvoyer, onFermer }: { code: string; nom: string; cible: CibleApercu; envoiEnCours: boolean; onEnvoyer?: () => void; onFermer: () => void }) {
  const [cle, setCle] = useState(cible.cle);
  const [donnees, setDonnees] = useState<ApercuEtape | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    appelApi<ApercuEtape>(`/api/mail/sequences/${code}/apercu?rang=${cible.rang}${cle ? `&cle=${encodeURIComponent(cle)}` : ""}`)
      .then((reponse) => actif && setDonnees(reponse))
      .catch((e) => actif && setErreur(messageErreur(e)));
    return () => {
      actif = false;
    };
  }, [code, cible.rang, cle]);

  const bloque = Boolean(donnees?.manques.length);
  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre={`${nom} · mail ${cible.rang}`}
      description={onEnvoyer ? "Relisez : il part tel quel, avec son lien de désinscription." : "Aperçu avec les données d'un vrai client. Rien ne part d'ici."}
      pied={
        onEnvoyer ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton variante="fantome" onClick={onFermer}>
              Fermer
            </Bouton>
            <Bouton variante="primaire" icone={<Send size={14} aria-hidden />} disabled={!donnees || bloque} chargement={envoiEnCours} onClick={onEnvoyer}>
              Envoyer ce mail
            </Bouton>
          </div>
        ) : undefined
      }
    >
      {erreur ? <p className="text-[13px] text-[#F87171]">{erreur}</p> : null}
      {!donnees && !erreur ? <p className="text-[13px] text-[#9CA3AF]">Préparation de l&apos;aperçu…</p> : null}
      {donnees ? (
        <div className="space-y-3">
          {!onEnvoyer && donnees.candidats.length > 1 ? (
            <select aria-label="Client de l'aperçu" value={donnees.candidat?.cle ?? ""} onChange={(e) => setCle(e.target.value)} className={cn(CLASSE_SAISIE, "h-10 sm:h-9")}>
              {donnees.candidats.map((c) => (
                <option key={c.cle} value={c.cle}>
                  {c.nom}
                </option>
              ))}
            </select>
          ) : null}
          {donnees.candidat ? (
            <p className="text-[12.5px] text-[#9CA3AF]">
              À : <span className="text-[#E5E7EB]">{donnees.candidat.adresse}</span>
            </p>
          ) : (
            <p className="text-[12.5px] text-[#F5B454]">Aucun contact ne correspond aujourd&apos;hui : voici le texte type, variables comprises.</p>
          )}
          <div className="rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3">
            <p className="text-[13.5px] font-medium text-[#F2F3F5]">{donnees.objet}</p>
            <p className="mt-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-[#D1D5DB]">{donnees.texte}</p>
          </div>
          {bloque ? <p className="text-[12.5px] text-[#F5B454]">Il manque : {donnees.manques.join(", ")}. Ce mail ne partira pas tant que l&apos;information manque.</p> : null}
        </div>
      ) : null}
    </Modale>
  );
}
