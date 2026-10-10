"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CARTE, CLASSE_SAISIE, Pastille, TitreSection, TRANS } from "@/components/pilotage/ui";
import { apercuDuTexte } from "@/lib/messagerie/apercu";
import { GROUPES_MESSAGES, LIBELLES_GROUPE_MESSAGE, LIBELLES_MODE_MESSAGE, LIBELLES_VARIABLE_MESSAGE, MODES_MESSAGE, type ModeMessage } from "@/lib/messagerie/catalogue";
import type { MessageDeLaListe, TexteDeLaListe } from "@/lib/messagerie/modeles";
import { cn } from "@/lib/utils";

const TON_MODE: Record<ModeMessage, "vert" | "neutre" | "ambre"> = { AUTO: "vert", VALIDATION: "neutre", DESACTIVE: "ambre" };
const AIDE_MODE: Record<ModeMessage, string> = {
  AUTO: "En mode Android, part seul à l'heure prévue.",
  VALIDATION: "Attend ton accord, même en mode Android.",
  DESACTIVE: "Jamais préparé, quel que soit le mode.",
};

/**
 * Mission 25 (lot 3) — Paramètres → SMS : les 41 messages de la liste validée le 10/10, par groupe. Chaque message
 * se déplie : quand il part, son mode (Auto, Validation, Désactivé), et chacun de ses textes (variantes comprises),
 * avec l'aperçu pour un client fictif. Une erreur qui empêcherait l'envoi bloque l'enregistrement ; une règle du
 * contrôleur non suivie est signalée, sans bloquer.
 */
export default function MessagesDeLaListe({ initial }: { initial: MessageDeLaListe[] }) {
  const [messages, setMessages] = useState(initial);
  const remplacer = (m: MessageDeLaListe) => setMessages((tous) => tous.map((x) => (x.code === m.code ? m : x)));
  const regles = messages.filter((m) => m.mode !== m.modeListe || m.textes.some((t) => t.modifie)).length;

  return (
    <section className="mt-10" id="messages">
      <TitreSection action={regles ? <span className="text-[12px] text-texte-3 tabular-nums">{regles} modifié{regles > 1 ? "s" : ""}</span> : null}>Messages de la messagerie</TitreSection>
      <div className="space-y-1.5 text-[12.5px] leading-relaxed text-texte-3">
        <p>
          <span className="text-texte">La liste validée le 10/10 : 32 messages préparés par le CRM, « comme convenu » et 8 réponses rapides.</span>{" "}
          Le CRM n&apos;écrit rien d&apos;autre : ce que tu corriges ici sera préparé la prochaine fois.
        </p>
        <p>Le mode sert au mode Android : Auto part seul, Validation attend ton accord, Désactivé n&apos;est jamais préparé. En mode Manuel, chaque message t&apos;attend dans la Messagerie.</p>
        <p>Les mots entre accolades sont remplis par le CRM. L&apos;aperçu montre le texte pour un client fictif (Camille, une cuisine).</p>
      </div>
      {GROUPES_MESSAGES.map((groupe) => {
        const duGroupe = messages.filter((m) => m.groupe === groupe);
        return duGroupe.length ? (
          <div key={groupe} className="mt-6">
            <h3 className="mb-2 text-[12px] font-medium tracking-wide text-texte-3 uppercase">{LIBELLES_GROUPE_MESSAGE[groupe]}</h3>
            <div className="space-y-2">
              {duGroupe.map((message) => (
                <CarteMessageListe key={message.code} message={message} onChange={remplacer} />
              ))}
            </div>
          </div>
        ) : null;
      })}
    </section>
  );
}

function CarteMessageListe({ message, onChange }: { message: MessageDeLaListe; onChange: (m: MessageDeLaListe) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState<ModeMessage | null>(null);
  const rapide = message.nature === "RAPIDE";
  const modifie = message.textes.some((t) => t.modifie);

  async function changerMode(mode: ModeMessage) {
    if (mode === message.mode) return;
    setEnvoi(mode);
    try {
      const { message: aJour } = await envoyerJson<{ message: MessageDeLaListe }>("/api/messagerie/modeles", "PATCH", { code: message.code, mode });
      onChange(aJour);
      toast.success(`${message.code} : ${LIBELLES_MODE_MESSAGE[aJour.mode]}`);
    } catch (erreur) {
      toast.error("Non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <div className={cn(CARTE, message.mode === "DESACTIVE" && "opacity-75")}>
      <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} className={cn("flex min-h-[48px] w-full items-center gap-2 rounded-[11px] px-4 py-2 text-left hover:bg-surface-2", TRANS)}>
        <span className="w-9 shrink-0 font-mono text-[12.5px] text-texte-3">{message.code}</span>
        <span className="min-w-0 flex-1 text-[13.5px] font-medium text-texte">{message.libelle}</span>
        {modifie ? <Pastille>Texte modifié</Pastille> : null}
        {rapide ? null : <Pastille ton={TON_MODE[message.mode]}>{LIBELLES_MODE_MESSAGE[message.mode]}</Pastille>}
        <ChevronDown size={16} aria-hidden className={cn("shrink-0 text-texte-3 transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert ? (
        <div className="space-y-4 border-t-[0.5px] border-trait px-4 pt-3 pb-4">
          <p className="text-[12.5px] leading-relaxed text-texte-3">{rapide ? "Réponse rapide : elle part seulement quand tu la choisis, depuis une conversation." : message.quand}</p>
          {rapide ? null : (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-texte-3">Mode {message.mode !== message.modeListe ? <span className="font-normal">(liste validée : {LIBELLES_MODE_MESSAGE[message.modeListe]})</span> : null}</p>
              <div role="radiogroup" aria-label={`Mode de ${message.code}`} className="flex flex-wrap gap-1.5">
                {MODES_MESSAGE.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={message.mode === mode}
                    disabled={envoi !== null}
                    onClick={() => void changerMode(mode)}
                    className={cn(
                      "min-h-11 rounded-full border-[0.5px] px-3.5 text-[13px] sm:min-h-8",
                      message.mode === mode ? "border-action/60 bg-action-fond text-action-clair" : "border-trait bg-fond text-texte-2 hover:border-trait-2 hover:text-texte",
                      TRANS
                    )}
                  >
                    {envoi === mode ? "…" : LIBELLES_MODE_MESSAGE[mode]}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] text-texte-3">{AIDE_MODE[message.mode]}</p>
            </div>
          )}
          {message.textes.map((texte) => (
            <EditeurTexte key={texte.cle} code={message} texte={texte} plusieurs={message.textes.length > 1} onChange={onChange} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EditeurTexte({ code: message, texte: ligne, plusieurs, onChange }: { code: MessageDeLaListe; texte: TexteDeLaListe; plusieurs: boolean; onChange: (m: MessageDeLaListe) => void }) {
  const [texte, setTexte] = useState(ligne.texte);
  const [envoi, setEnvoi] = useState(false);
  const apercu = apercuDuTexte(message.code, ligne.variante, texte);
  const modifie = texte.trim() !== ligne.texte;

  async function enregistrer(valeur: string | null) {
    setEnvoi(true);
    try {
      const { message: aJour } = await envoyerJson<{ message: MessageDeLaListe }>("/api/messagerie/modeles", "PATCH", { cle: ligne.cle, texte: valeur });
      onChange(aJour);
      setTexte(aJour.textes.find((t) => t.cle === ligne.cle)?.texte ?? ligne.depart);
      toast.success(valeur === null ? "Texte validé remis" : "Texte enregistré");
    } catch (erreur) {
      toast.error("Non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div>
      <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] font-medium text-texte-3">
        {plusieurs ? ligne.libelle : "Texte"}
        {ligne.modifie ? <Pastille>modifié</Pastille> : null}
      </p>
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={3}
        aria-label={`Texte de ${message.code}${plusieurs ? ` (${ligne.libelle})` : ""}`}
        aria-invalid={apercu.erreurs.length ? true : undefined}
        className={cn(CLASSE_SAISIE, "min-h-[84px] resize-y py-2 leading-relaxed")}
      />
      <p className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px] text-texte-3">
        {ligne.variables.map((v) => (
          <code key={v} title={LIBELLES_VARIABLE_MESSAGE[v]} className="rounded-[6px] border-[0.5px] border-trait bg-fond px-1.5 py-0.5 text-texte-2">
            {`{${v}}`}
          </code>
        ))}
      </p>
      <div className="mt-2 rounded-[10px] bg-surface-2 px-3 py-2">
        <p className="text-[11.5px] font-medium text-texte-3">Aperçu · {apercu.longueur} caractères</p>
        <p className="mt-0.5 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-texte">{apercu.texte || "—"}</p>
      </div>
      {apercu.erreurs.map((e) => (
        <p key={e} className="mt-1 text-[12px] text-retard-texte">
          {e}
        </p>
      ))}
      {apercu.aRevoir.length ? <p className="mt-1 text-[12px] text-attention-texte">À revoir : {apercu.aRevoir.join(" ")}</p> : null}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {texte.trim() !== ligne.depart ? (
          <Bouton taille="sm" variante="fantome" icone={<Undo2 size={12} aria-hidden />} onClick={() => setTexte(ligne.depart)}>
            Revenir au texte validé
          </Bouton>
        ) : null}
        {modifie ? (
          <Bouton taille="sm" variante="fantome" icone={<RotateCcw size={12} aria-hidden />} onClick={() => setTexte(ligne.texte)}>
            Annuler
          </Bouton>
        ) : null}
        <Bouton
          taille="sm"
          variante="primaire"
          icone={<Save size={12} aria-hidden />}
          disabled={!modifie || apercu.erreurs.length > 0}
          chargement={envoi}
          onClick={() => void enregistrer(texte.trim() === ligne.depart ? null : texte.trim())}
        >
          Enregistrer
        </Bouton>
      </div>
    </div>
  );
}
