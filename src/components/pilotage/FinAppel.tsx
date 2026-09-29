"use client";

import { useEffect, useState } from "react";
import { CalendarClock, PhoneIncoming } from "lucide-react";
import { toast } from "sonner";
import type { ContexteAppel } from "@/lib/commercial/appels";
import { LIBELLES_ISSUE, type IssueAppel, type SuiteAppel } from "@/lib/commercial/constantes";
import { aHeureParis, depuisSaisieParis, momentDuRappel, raccourcisRappel, versSaisieParis, type RaccourciRappel } from "@/lib/commercial/quand";
import { pluriel } from "@/lib/commun/format";
import { LIBELLES_MOTIF_PERTE, MOTIFS_PERTE, type MotifPerte } from "@/lib/dossiers/constants";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { viderNotesEnAttente } from "./NotesAppel";
import { Puces, TRANS } from "./ui";

/**
 * Mission 14 (29/09/2026), partie 4 — la feuille de fin d'appel, seule façon de
 * noter l'issue d'un appel (retour d'un « Appeler », « Noter l'appel », mode
 * appels) : « Comment ça s'est passé avec {nom} ? », quatre puces, une précision
 * commune, Enregistrer, Plus tard.
 *  - Pas de réponse : « Rappel : demain 18:00 », modifiable (champ date et heure
 *    natif) ; à la 3ᵉ tentative, « Classer sans suite — plus de réponse » est
 *    proposé, jamais imposé ;
 *  - À rappeler : un choix exigé — ce soir 18 h (avant 18 h), demain 10 h, demain
 *    18 h, lundi 10 h, autre moment, ou sans date ;
 *  - Intéressé : rien à choisir (son dossier et son espace s'ouvrent) ;
 *  - Pas intéressé : le motif exigé (liste des pertes), une précision pour « Autre ».
 * Les heures sont celles de Paris (`aHeureParis`), quel que soit le fuseau du téléphone.
 */

export type AppelANoter = { leadId: string; nom?: string; dossierId?: string | null };

type ChoixRappel = RaccourciRappel["cle"] | "AUTRE" | "SANS_DATE";

/** L'ordre des puces de la feuille (l'issue la plus fréquente d'abord) ; `ISSUES_APPEL` garde le sien (schéma, outil MCP). */
const ORDRE_FEUILLE = ["PAS_DE_REPONSE", "A_RAPPELER", "INTERESSE", "PAS_INTERESSE"] as const satisfies readonly IssueAppel[];

/** L'appel s'écrit sur le dossier connu ; « dossier:<id> » (dossier sans lead, appelé depuis sa fiche) aussi. */
function cibleDe(appel: AppelANoter): { dossierId: string } | { leadId: string } {
  if (appel.dossierId) return { dossierId: appel.dossierId };
  return appel.leadId.startsWith("dossier:") ? { dossierId: appel.leadId.slice("dossier:".length) } : { leadId: appel.leadId };
}

/** « Rappel : demain 18:00 », modifiable d'un toucher : un champ date et heure natif, invisible, posé sur la ligne. */
function ChampRappel({ valeur, onChange, maintenant, defaut = null }: { valeur: string; onChange: (valeur: string) => void; maintenant: Date; defaut?: Date | null }) {
  const date = depuisSaisieParis(valeur) ?? defaut;
  const libelle = date ? `Rappel : ${momentDuRappel(date, maintenant)}` : "Rappel : à choisir";
  return (
    <label className={cn("relative flex min-h-[44px] items-center gap-2 rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 text-[14px] text-[#E5E7EB] hover:border-[#3A3E47]", TRANS)}>
      <CalendarClock size={15} aria-hidden className="shrink-0 text-[#5DCAA5]" />
      <span className="tabular-nums">{libelle}</span>
      <span className="ml-auto text-[12.5px] text-[#5DCAA5]">Modifier</span>
      <input
        type="datetime-local"
        value={valeur}
        aria-label={`${libelle} : toucher pour la changer`}
        onChange={(evenement) => onChange(evenement.target.value)}
        onClick={(evenement) => {
          // À la souris, le champ invisible n'ouvre pas son sélecteur tout seul ; au doigt (iPhone), si.
          if (!window.matchMedia("(pointer: fine)").matches) return;
          try {
            evenement.currentTarget.showPicker();
          } catch {
            // Sélecteur déjà ouvert, ou navigateur trop ancien : le champ reste utilisable au clavier.
          }
        }}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none text-[16px] opacity-0"
      />
    </label>
  );
}

export function FeuilleFinAppel({ appel, onPlusTard, onEnregistre }: { appel: AppelANoter; onPlusTard: () => void; onEnregistre: (suite: SuiteAppel) => void }) {
  const [maintenant] = useState(() => new Date());
  const [contexte, setContexte] = useState<ContexteAppel | null>(null);
  const [issue, setIssue] = useState<IssueAppel | null>(null);
  const [note, setNote] = useState("");
  // « Pas de réponse » : demain 18 h, modifiable ; vidé, le serveur reprend ce défaut.
  const [rappelSansReponse, setRappelSansReponse] = useState(() => versSaisieParis(aHeureParis(new Date(), 1, 18)));
  const [choix, setChoix] = useState<ChoixRappel | null>(null);
  const [autre, setAutre] = useState("");
  const [motif, setMotif] = useState<MotifPerte | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const cible = cibleDe(appel);
  const requeteContexte = new URLSearchParams(cible).toString();
  useEffect(() => {
    let actif = true;
    // Le nom, la source et les tentatives : sans réseau, la feuille reste utilisable (sans la 3ᵉ tentative signalée).
    appelApi<{ contexte: ContexteAppel }>(`/api/commercial/appels/contexte?${requeteContexte}`)
      .then(({ contexte: lu }) => actif && setContexte(lu))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [requeteContexte]);

  const raccourcis = raccourcisRappel(maintenant);
  const defautSansReponse = aHeureParis(maintenant, 1, 18);
  /** « À rappeler » : l'instant choisi, null = sans date, undefined = rien de valable encore. */
  const rappelARappeler: Date | null | undefined =
    choix === "SANS_DATE" ? null : choix === "AUTRE" ? (depuisSaisieParis(autre) ?? undefined) : raccourcis.find((r) => r.cle === choix)?.le;
  const tentativesAvant = contexte?.tentatives ?? 0;
  const precisionManquante = issue === "PAS_INTERESSE" && motif === "AUTRE" && note.trim().length < 3;
  const pret =
    issue === "PAS_DE_REPONSE" || issue === "INTERESSE" || (issue === "A_RAPPELER" && rappelARappeler !== undefined) || (issue === "PAS_INTERESSE" && motif !== null && !precisionManquante);
  const nom = appel.nom || contexte?.nom;
  // L'appel s'écrit sur un dossier (connu de la feuille, ou lu par le contexte) : le contact n'est dans aucune liste Leads.
  const surDossier = "dossierId" in cible || Boolean(contexte?.dossierId);
  const infos = contexte ? [contexte.source, contexte.tentatives > 0 ? `${pluriel(contexte.tentatives, "appel", "appels")} sans réponse d'affilée` : null].filter(Boolean).join(" · ") : "";

  /** `sansSuite` : « Classer sans suite — plus de réponse » (pas intéressé, motif « Plus de réponse »). */
  async function enregistrer(sansSuite = false) {
    const envoyee: IssueAppel | null = sansSuite ? "PAS_INTERESSE" : issue;
    if (!envoyee || envoi) return;
    const corps = {
      ...cible,
      issue: envoyee,
      note: note.trim(),
      ...(envoyee === "PAS_DE_REPONSE" ? { rappelLe: depuisSaisieParis(rappelSansReponse)?.toISOString() ?? null } : {}),
      ...(envoyee === "A_RAPPELER" ? { rappelLe: rappelARappeler ? rappelARappeler.toISOString() : null } : {}),
      ...(envoyee === "PAS_INTERESSE" ? { motifPerte: sansSuite ? "SANS_REPONSE" : motif } : {}),
    };
    setEnvoi(true);
    try {
      // La note d'appel en attente (tapée ou dictée juste avant) part d'abord : l'issue s'y accroche (`noterIssueSurNote`).
      await viderNotesEnAttente(appel.leadId);
      const { suite } = await envoyerJson<{ suite: SuiteAppel }>("/api/commercial/appels", "POST", corps);
      onEnregistre(suite);
    } catch (erreur) {
      toast.error("Appel non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6" role="dialog" aria-label="Comment s'est passé l'appel ?">
      <div className="max-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] w-full max-w-md overflow-y-auto overscroll-contain rounded-[16px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4 shadow-lg shadow-black/50">
        <p className="flex items-center gap-2 text-[15px] font-medium text-[#F2F3F5]">
          <PhoneIncoming size={16} aria-hidden className="shrink-0 text-[#5DCAA5]" />
          Comment ça s&apos;est passé{nom ? ` avec ${nom}` : ""} ?
        </p>
        {infos ? <p className="mt-0.5 pl-6 text-[12.5px] text-[#8B919C]">{infos}</p> : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {ORDRE_FEUILLE.map((valeur) => (
            <button
              key={valeur}
              type="button"
              aria-pressed={issue === valeur}
              onClick={() => setIssue(valeur)}
              className={cn("min-h-[44px] rounded-[10px] border-[0.5px] px-3 text-[13.5px] font-medium", issue === valeur ? "border-[#1D9E75]/60 bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}
            >
              {LIBELLES_ISSUE[valeur]}
            </button>
          ))}
        </div>

        {issue === "PAS_DE_REPONSE" ? (
          <div className="mt-3 space-y-2">
            <ChampRappel valeur={rappelSansReponse} onChange={setRappelSansReponse} maintenant={maintenant} defaut={defautSansReponse} />
            {tentativesAvant >= 2 ? (
              <div className="rounded-[10px] border-[0.5px] border-[#EF9F27]/30 bg-[#EF9F27]/10 p-3">
                <p className="text-[12.5px] leading-snug text-[#F5B454]">{tentativesAvant + 1}ᵉ appel sans réponse d&apos;affilée : tu peux le classer sans suite, ou le rappeler encore.</p>
                <button
                  type="button"
                  disabled={envoi}
                  onClick={() => void enregistrer(true)}
                  className={cn("mt-2 min-h-[44px] w-full rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 text-[13.5px] text-[#E5E7EB] hover:border-[#3A3E47] disabled:opacity-50", TRANS)}
                >
                  Classer sans suite — plus de réponse
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {issue === "A_RAPPELER" ? (
          <div className="mt-3 space-y-2">
            <Puces
              libelle="Quand le rappeler ?"
              obligatoire
              options={[...raccourcis.map((r) => ({ valeur: r.cle, libelle: r.libelle })), { valeur: "AUTRE" as const, libelle: "Autre…" }, { valeur: "SANS_DATE" as const, libelle: "Sans date" }]}
              valeur={choix}
              onChange={(valeur) => {
                setChoix(valeur);
                if (valeur === "AUTRE" && !autre) setAutre(versSaisieParis(aHeureParis(maintenant, 1, 10)));
              }}
            />
            {choix === "AUTRE" ? <ChampRappel valeur={autre} onChange={setAutre} maintenant={maintenant} /> : null}
            {choix === "SANS_DATE" ? (
              <p className="text-[12.5px] text-[#8B919C]">{surDossier ? "« Rappeler », sans date, devient la prochaine action de son dossier." : "Il reste dans « À rappeler », après les rappels datés."}</p>
            ) : null}
          </div>
        ) : null}

        {issue === "INTERESSE" ? <p className="mt-3 text-[12.5px] leading-snug text-[#8B919C]">Son dossier et son espace s&apos;ouvrent ; le SMS avec le lien de son espace te sera proposé.</p> : null}

        {issue === "PAS_INTERESSE" ? (
          <div className="mt-3">
            <Puces libelle="Pourquoi ?" obligatoire options={MOTIFS_PERTE.map((valeur) => ({ valeur, libelle: LIBELLES_MOTIF_PERTE[valeur] }))} valeur={motif} onChange={setMotif} erreur={precisionManquante ? "Précise le motif ci-dessous (3 caractères au moins)." : null} />
          </div>
        ) : null}

        <textarea
          value={note}
          onChange={(evenement) => setNote(evenement.target.value)}
          placeholder={issue === "PAS_INTERESSE" && motif === "AUTRE" ? "Précision (obligatoire) : pourquoi il ne donne pas suite…" : "Précision (facultatif) : ce qu'il a dit, ce qu'il veut…"}
          aria-label="Précision"
          rows={2}
          className="mt-3 w-full resize-none rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 py-2 text-[16px] text-[#F2F3F5] placeholder:text-[#6B7280] focus:border-[#1D9E75]/60 focus:outline-none sm:text-[14px]"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={onPlusTard} className={cn("min-h-[44px] rounded-[10px] border-[0.5px] border-[#2A2D34] text-[14px] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}>
            Plus tard
          </button>
          <button
            type="button"
            disabled={!pret || envoi}
            onClick={() => void enregistrer()}
            className={cn("min-h-[44px] rounded-[10px] bg-[#1D9E75] text-[14px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:bg-[#22262D] disabled:text-[#6B7280]", TRANS)}
          >
            {envoi ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
