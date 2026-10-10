"use client";

import { useState } from "react";
import { BellRing, CalendarClock, Camera, FileText, Images, Link2, MapPin, MessageSquarePlus, NotebookPen, Pause, Phone, ShieldBan, Star, Workflow } from "lucide-react";
import { toast } from "sonner";
import type { MessageVue } from "@/lib/messagerie/vues";
import type { OuEnEst } from "@/lib/messagerie/types";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/evenements";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { Modale, TRANS } from "@/components/pilotage/ui";
import { BOUTON_PRINCIPAL, BOUTON_SECONDAIRE_M, CarteMessage } from "./CarteMessage";
import { LignesOuEnEst } from "./OuEnEst";

/**
 * Mission 25 — les feuilles de la conversation : 📥 la réponse du client (texte collé, heure, photos), 📝 la note
 * (écrite, ou dictée avec le micro du clavier), « Qu'est-ce qui s'est dit ? » après un appel, et les outils « + »
 * (rappel, pause des relances, lien, visite, demandes, STOP). Après chaque geste, ce que la messagerie a préparé
 * s'affiche aussitôt, avec « Ouvrir Messages ».
 */

const CHAMP = "w-full rounded-[10px] border-[0.5px] border-trait bg-fond px-3 py-2.5 text-[16px] text-texte focus:border-action focus:outline-none";
const PUCE = (actif: boolean) => cn("min-h-[44px] rounded-[10px] border-[0.5px] px-3 text-[14px]", TRANS, actif ? "border-action bg-action-fond text-texte" : "border-trait text-texte-2 hover:border-trait-2");

/* ── 📥 Réponse du client ─────────────────────────────────────────────────── */

const HEURES = [
  { cle: "MAINTENANT", libelle: "Maintenant" },
  { cle: "10", libelle: "Il y a 10 min" },
  { cle: "30", libelle: "30 min" },
  { cle: "60", libelle: "1 h" },
  { cle: "MATIN", libelle: "Ce matin" },
  { cle: "HIER_SOIR", libelle: "Hier soir" },
  { cle: "AUTRE", libelle: "Autre" },
] as const;

function heureDuChoix(cle: (typeof HEURES)[number]["cle"], autre: string): Date {
  const maintenant = new Date();
  const aParis = (jours: number, heure: number) => {
    const jour = new Date(maintenant.getTime() + jours * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
    const supposee = new Date(`${jour}T${String(heure).padStart(2, "0")}:00:00Z`);
    const decalage = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(supposee)) - heure;
    return new Date(supposee.getTime() - decalage * 3_600_000);
  };
  switch (cle) {
    case "10":
    case "30":
    case "60":
      return new Date(maintenant.getTime() - Number(cle) * 60_000);
    case "MATIN":
      return aParis(0, 9);
    case "HIER_SOIR":
      return aParis(-1, 19);
    case "AUTRE":
      return autre ? new Date(autre) : maintenant;
    default:
      return maintenant;
  }
}

export function FeuilleReponseClient({ suiviId, nom, ouverte, onFermer, onFait }: { suiviId: string; nom: string; ouverte: boolean; onFermer: () => void; onFait: () => void }) {
  const [texte, setTexte] = useState("");
  const [heure, setHeure] = useState<(typeof HEURES)[number]["cle"]>("MAINTENANT");
  const [autre, setAutre] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [proposee, setProposee] = useState<MessageVue | null | undefined>(undefined);

  async function enregistrer() {
    setOccupe(true);
    try {
      const formulaire = new FormData();
      formulaire.set("texte", texte);
      formulaire.set("recuLe", heureDuChoix(heure, autre).toISOString());
      for (const photo of photos) formulaire.append("photos", photo);
      const reponse = await fetch(`/api/messagerie/conversations/${suiviId}`, { method: "POST", body: formulaire });
      const corps = (await reponse.json()) as { proposee?: MessageVue | null; error?: string; photos?: number };
      if (!reponse.ok) throw new Error(corps.error ?? "Enregistrement impossible.");
      toast.success(corps.photos ? `Réponse et ${corps.photos} photo${corps.photos > 1 ? "s" : ""} rangées` : "Réponse enregistrée");
      setProposee(corps.proposee ?? null);
      rafraichirCompteurs();
      onFait();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  function fermer() {
    setTexte("");
    setPhotos([]);
    setHeure("MAINTENANT");
    setProposee(undefined);
    onFermer();
  }

  return (
    <Modale ouverte={ouverte} onFermer={fermer} titre={`Réponse de ${nom}`} description="Colle sa réponse, choisis l'heure, ajoute ses photos : la suite est préparée tout de suite.">
      {proposee !== undefined ? (
        <div className="space-y-3 p-4">
          {proposee ? (
            <>
              <p className="text-[14px] text-texte-2">Réponse proposée :</p>
              <CarteMessage message={proposee} nom={nom} onChange={() => fermer()} />
            </>
          ) : (
            <p className="rounded-[10px] bg-surface-2 p-3 text-[14px] text-texte-2">Rien à répondre pour l&apos;instant (un merci, un STOP, ou la suite viendra à l&apos;heure prévue).</p>
          )}
          <button type="button" onClick={fermer} className={cn(BOUTON_SECONDAIRE_M, "w-full")}>
            Fermer
          </button>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={4} placeholder="Colle ici son message" aria-label="Son message" className={CHAMP} />
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-texte-3">Reçu</p>
            <div className="flex flex-wrap gap-1.5">
              {HEURES.map((h) => (
                <button key={h.cle} type="button" onClick={() => setHeure(h.cle)} className={PUCE(heure === h.cle)}>
                  {h.libelle}
                </button>
              ))}
            </div>
            {heure === "AUTRE" ? <input type="datetime-local" value={autre} onChange={(e) => setAutre(e.target.value)} aria-label="Heure de réception" className={cn(CHAMP, "mt-2")} /> : null}
          </div>
          <label className={cn(BOUTON_SECONDAIRE_M, "w-full cursor-pointer")}>
            <Camera size={16} aria-hidden /> {photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""} choisie${photos.length > 1 ? "s" : ""}` : "Ajouter ses photos"}
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 10))} />
          </label>
          <button type="button" disabled={occupe || (!texte.trim() && !photos.length)} onClick={enregistrer} className={BOUTON_PRINCIPAL}>
            {occupe ? "Analyse…" : "Enregistrer"}
          </button>
        </div>
      )}
    </Modale>
  );
}

/* ── 📝 Note ──────────────────────────────────────────────────────────────── */

export function FeuilleNote({ suiviId, nom, ouverte, onFermer, onFait }: { suiviId: string; nom: string; ouverte: boolean; onFermer: () => void; onFait: () => void }) {
  const [texte, setTexte] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [resultat, setResultat] = useState<{ ouEnEst: OuEnEst | null; proposee: MessageVue | null } | null>(null);
  async function enregistrer() {
    setOccupe(true);
    try {
      setResultat(await envoyerJson<{ ouEnEst: OuEnEst | null; proposee: MessageVue | null }>(`/api/messagerie/conversations/${suiviId}`, "POST", { action: "note", texte }));
      toast.success("Note rangée");
      onFait();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }
  function fermer() {
    setTexte("");
    setResultat(null);
    onFermer();
  }
  return (
    <Modale ouverte={ouverte} onFermer={fermer} titre={`Note sur ${nom}`} description="Quelques mots, écrits ou dictés avec le micro du clavier. Elle ne part jamais chez le client.">
      <div className="space-y-3 p-4">
        {resultat ? (
          <>
            <LignesOuEnEst ouEnEst={resultat.ouEnEst} />
            {resultat.proposee ? <CarteMessage message={resultat.proposee} nom={nom} onChange={() => fermer()} /> : null}
            <button type="button" onClick={fermer} className={cn(BOUTON_SECONDAIRE_M, "w-full")}>
              Fermer
            </button>
          </>
        ) : (
          <>
            <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={5} placeholder="Elle signe dans 2 semaines, veut du chêne clair, son mari valide." aria-label="La note" className={CHAMP} />
            <button type="button" disabled={occupe || texte.trim().length < 2} onClick={enregistrer} className={BOUTON_PRINCIPAL}>
              <NotebookPen size={17} aria-hidden /> {occupe ? "Rangement…" : "Ranger la note"}
            </button>
          </>
        )}
      </div>
    </Modale>
  );
}

/* ── « Qu'est-ce qui s'est dit ? » ────────────────────────────────────────── */

const ISSUES = [
  { cle: "PAS_DE_REPONSE", libelle: "Pas de réponse" },
  { cle: "INTERESSE", libelle: "Intéressé, veut une simulation" },
  { cle: "VA_SIGNER", libelle: "Va signer" },
  { cle: "REFLECHIT", libelle: "Réfléchit" },
  { cle: "ECHANTILLONS", libelle: "Veut voir les échantillons" },
  { cle: "PAS_INTERESSE", libelle: "Pas intéressé" },
] as const;
const DELAIS = [
  { cle: "1S", libelle: "Dans 1 semaine" },
  { cle: "2S", libelle: "Dans 2 semaines" },
  { cle: "1M", libelle: "Dans 1 mois" },
] as const;
const MOTIFS = [
  { cle: "PRIX", libelle: "Trop cher" },
  { cle: "CONCURRENT", libelle: "Concurrent" },
  { cle: "DELAI", libelle: "Reporté" },
  { cle: "AUTRE", libelle: "Autre" },
] as const;

export type CibleAppel = { suiviId?: string | null; leadId?: string | null; dossierId?: string | null; nom: string };

export function FeuilleApresAppel({ cible, ouverte, onFermer, onFait }: { cible: CibleAppel; ouverte: boolean; onFermer: () => void; onFait: (resultat: { resume: string | null; proposee: MessageVue | null }) => void }) {
  const [issue, setIssue] = useState<(typeof ISSUES)[number]["cle"] | null>(null);
  const [delai, setDelai] = useState<(typeof DELAIS)[number]["cle"]>("2S");
  const [motif, setMotif] = useState<(typeof MOTIFS)[number]["cle"] | null>(null);
  const [note, setNote] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [proposee, setProposee] = useState<MessageVue | null | undefined>(undefined);

  async function enregistrer() {
    if (!issue) return;
    setOccupe(true);
    try {
      const corps = { issue, ...(issue === "VA_SIGNER" ? { delai } : {}), ...(issue === "PAS_INTERESSE" && motif ? { motifPerte: motif } : {}), ...(note.trim() ? { note } : {}) };
      const r = cible.suiviId
        ? await envoyerJson<{ resume: string | null; proposee: MessageVue | null }>(`/api/messagerie/conversations/${cible.suiviId}`, "POST", { action: "apres-appel", ...corps })
        : await envoyerJson<{ resume: string | null; messagerie: MessageVue | null }>("/api/messagerie/apres-appel", "POST", { ...(cible.dossierId ? { dossierId: cible.dossierId } : { leadId: cible.leadId }), ...corps }).then((x) => ({ resume: x.resume, proposee: x.messagerie }));
      toast.success(r.resume ?? "Appel noté");
      rafraichirCompteurs();
      setProposee(r.proposee);
      onFait(r);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }
  function fermer() {
    setIssue(null);
    setMotif(null);
    setNote("");
    setProposee(undefined);
    onFermer();
  }
  return (
    <Modale ouverte={ouverte} onFermer={fermer} titre="Qu'est-ce qui s'est dit ?" description={cible.nom}>
      {proposee !== undefined ? (
        <div className="space-y-3 p-4">
          {proposee ? <CarteMessage message={proposee} nom={cible.nom} onChange={() => fermer()} /> : <p className="text-[14px] text-texte-2">Appel noté. Rien à envoyer maintenant.</p>}
          <button type="button" onClick={fermer} className={cn(BOUTON_SECONDAIRE_M, "w-full")}>
            Fermer
          </button>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ISSUES.map((i) => (
              <button key={i.cle} type="button" onClick={() => setIssue(i.cle)} className={PUCE(issue === i.cle)}>
                {i.libelle}
              </button>
            ))}
          </div>
          {issue === "VA_SIGNER" ? (
            <div className="grid grid-cols-3 gap-2">
              {DELAIS.map((d) => (
                <button key={d.cle} type="button" onClick={() => setDelai(d.cle)} className={PUCE(delai === d.cle)}>
                  {d.libelle}
                </button>
              ))}
            </div>
          ) : null}
          {issue === "PAS_INTERESSE" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MOTIFS.map((m) => (
                <button key={m.cle} type="button" onClick={() => setMotif(m.cle)} className={PUCE(motif === m.cle)}>
                  {m.libelle}
                </button>
              ))}
            </div>
          ) : null}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="📝 Une note (écrite ou dictée) : teintes, budget, qui décide…" aria-label="Note" className={CHAMP} />
          <button type="button" disabled={!issue || occupe || (issue === "PAS_INTERESSE" && (!motif || (motif === "AUTRE" && !note.trim())))} onClick={enregistrer} className={BOUTON_PRINCIPAL}>
            {occupe ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      )}
    </Modale>
  );
}

/* ── Outils « + » ─────────────────────────────────────────────────────────── */

const DANS = [
  { cle: 2, libelle: "Dans 2 jours" },
  { cle: 7, libelle: "Dans 1 semaine" },
  { cle: 14, libelle: "Dans 2 semaines" },
] as const;

function aDixHeures(jours: number): Date {
  const d = new Date(Date.now() + jours * 86_400_000);
  const jour = d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
  const supposee = new Date(`${jour}T10:00:00Z`);
  const decalage = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(supposee)) - 10;
  return new Date(supposee.getTime() - decalage * 3_600_000);
}

export function FeuilleOutils({
  suiviId,
  nom,
  telephone,
  dossierId,
  leadId,
  ouverte,
  onFermer,
  onTexte,
  onPrepare,
  onNote,
  onFait,
}: {
  suiviId: string;
  nom: string;
  telephone: string | null;
  dossierId: string | null;
  leadId: string | null;
  ouverte: boolean;
  onFermer: () => void;
  /** Insère un texte (le lien) dans la zone de saisie. */
  onTexte: (texte: string) => void;
  onPrepare: (message: MessageVue) => void;
  onNote: () => void;
  onFait: () => void;
}) {
  const [vue, setVue] = useState<"OUTILS" | "RAPPEL" | "PAUSE" | "STOP">("OUTILS");
  const [quand, setQuand] = useState<number | "AUTRE">(2);
  const [autre, setAutre] = useState("");
  const [prevenir, setPrevenir] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const fermer = () => {
    setVue("OUTILS");
    onFermer();
  };
  async function poster<T>(corps: Record<string, unknown>): Promise<T | null> {
    setOccupe(true);
    try {
      const r = await envoyerJson<T>(`/api/messagerie/conversations/${suiviId}`, "POST", corps);
      rafraichirCompteurs();
      onFait();
      return r;
    } catch (erreur) {
      toast.error(messageErreur(erreur));
      return null;
    } finally {
      setOccupe(false);
    }
  }
  const date = () => (quand === "AUTRE" ? (autre ? new Date(autre) : null) : aDixHeures(quand));
  async function preparer(code: string) {
    const r = await poster<{ message: MessageVue }>({ action: "libre", code });
    if (r?.message) {
      onPrepare(r.message);
      fermer();
    }
  }

  const outil = (icone: React.ReactNode, libelle: string, aide: string, action: () => void, lien?: string) => {
    const contenu = (
      <>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-action-clair">{icone}</span>
        <span className="min-w-0">
          <span className="block text-[15px] text-texte">{libelle}</span>
          <span className="block text-[12.5px] text-texte-3">{aide}</span>
        </span>
      </>
    );
    const classe = cn("flex min-h-[56px] w-full items-center gap-3 rounded-[12px] px-2 text-left hover:bg-surface-2", TRANS);
    return lien ? (
      <a key={libelle} href={lien} onClick={action} className={classe}>
        {contenu}
      </a>
    ) : (
      <button key={libelle} type="button" disabled={occupe} onClick={action} className={classe}>
        {contenu}
      </button>
    );
  };

  const choixDate = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {DANS.map((d) => (
          <button key={d.cle} type="button" onClick={() => setQuand(d.cle)} className={PUCE(quand === d.cle)}>
            {d.libelle}
          </button>
        ))}
        <button type="button" onClick={() => setQuand("AUTRE")} className={PUCE(quand === "AUTRE")}>
          Une date
        </button>
      </div>
      {quand === "AUTRE" ? <input type="datetime-local" value={autre} onChange={(e) => setAutre(e.target.value)} aria-label="Date" className={CHAMP} /> : null}
    </div>
  );

  return (
    <Modale ouverte={ouverte} onFermer={fermer} titre={vue === "RAPPEL" ? "Rappel" : vue === "PAUSE" ? "Pause des relances" : vue === "STOP" ? "Ne plus écrire" : "Outils"} description={nom}>
      <div className="p-3">
        {vue === "OUTILS" ? (
          <div className="space-y-0.5">
            {telephone
              ? outil(<Phone size={17} />, "Appeler", "L'appel se note tout seul ; « Qu'est-ce qui s'est dit ? » au retour", () => noterDebutAppel(leadId ?? `dossier:${dossierId}`, { nom, dossierId }), `tel:${telephone}`)
              : null}
            {outil(<Link2 size={17} />, "Lien de l'espace", "Insère son lien dans le message", async () => {
              const r = await poster<{ lien: string }>({ action: "lien" });
              if (r?.lien) {
                onTexte(r.lien);
                fermer();
              }
            })}
            {dossierId ? outil(<Images size={17} />, "Simulation", "Publier un brouillon : S2 se prépare tout seul", () => fermer(), `/dossiers?dossier=${dossierId}&rubrique=photos`) : null}
            {dossierId ? outil(<FileText size={17} />, "Devis", "Mettre le devis en ligne : D1 se prépare tout seul", () => fermer(), `/dossiers?dossier=${dossierId}&rubrique=devis`) : null}
            {outil(<Star size={17} />, "Planche d'échantillons", "Q4 : « Voici quelques teintes… », joins la planche", () => preparer("Q4"))}
            {outil(<MapPin size={17} />, "Proposer une visite", "Deux créneaux de l'agenda (25 km ou moins), sinon la poste", () => preparer("Q5"))}
            {outil(<CalendarClock size={17} />, "Rappel", "Dans 2 jours, 1 ou 2 semaines, ou à une date ; relances en pause jusque-là", () => setVue("RAPPEL"))}
            {outil(<Pause size={17} />, "Pause relances", "Jusqu'à une date, sans rappel", () => setVue("PAUSE"))}
            {outil(<NotebookPen size={17} />, "Note", "Écrite ou dictée : elle est rangée", () => {
              fermer();
              onNote();
            })}
            {dossierId ? outil(<Workflow size={17} />, "Étape", "Signé, Perdu (avec le motif) ou En pause", () => fermer(), `/dossiers?dossier=${dossierId}&rubrique=etape`) : null}
            {outil(<MessageSquarePlus size={17} />, "Demander les photos", "P2 : compte comme une relance photos", () => preparer("P2"))}
            {outil(<BellRing size={17} />, "Demander un avis", "C4, avec le lien de la fiche Google", () => preparer("C4"))}
            {outil(<ShieldBan size={17} />, "Ne plus écrire", "STOP : plus aucun SMS ne part", () => setVue("STOP"))}
          </div>
        ) : vue === "RAPPEL" ? (
          <div className="space-y-3">
            {choixDate}
            <label className="flex min-h-[44px] items-center gap-2 text-[14px] text-texte-2">
              <input type="checkbox" checked={prevenir} onChange={(e) => setPrevenir(e.target.checked)} className="h-5 w-5 accent-action" /> Prévenir le client (« C&apos;est noté, je vous rappelle… »)
            </label>
            <button
              type="button"
              disabled={occupe || !date()}
              onClick={async () => {
                const le = date();
                if (!le) return;
                const r = await poster<{ message: MessageVue | null }>({ action: "rappel", le: le.toISOString(), prevenir });
                if (r) {
                  toast.success("Rappel posé, relances en pause jusque-là");
                  if (r.message) onPrepare(r.message);
                  fermer();
                }
              }}
              className={BOUTON_PRINCIPAL}
            >
              Poser le rappel
            </button>
            <button type="button" onClick={() => setVue("OUTILS")} className={cn(BOUTON_SECONDAIRE_M, "w-full")}>
              Retour
            </button>
          </div>
        ) : vue === "PAUSE" ? (
          <div className="space-y-3">
            {choixDate}
            <button
              type="button"
              disabled={occupe || !date()}
              onClick={async () => {
                const le = date();
                if (!le) return;
                if (await poster({ action: "pause", jusquau: le.toISOString() })) {
                  toast.success("Relances en pause");
                  fermer();
                }
              }}
              className={BOUTON_PRINCIPAL}
            >
              Mettre en pause
            </button>
            <button type="button" onClick={() => setVue("OUTILS")} className={cn(BOUTON_SECONDAIRE_M, "w-full")}>
              Retour
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] text-texte-2">Plus aucun SMS ne partira vers ce numéro, définitivement. Les messages préparés sont annulés.</p>
            <button
              type="button"
              disabled={occupe}
              onClick={async () => {
                if (await poster({ action: "stop" })) {
                  toast.success("STOP posé");
                  fermer();
                }
              }}
              className={cn(BOUTON_SECONDAIRE_M, "w-full border-retard/60 text-retard-texte")}
            >
              Ne plus écrire à {nom}
            </button>
            <button type="button" onClick={() => setVue("OUTILS")} className={cn(BOUTON_SECONDAIRE_M, "w-full")}>
              Retour
            </button>
          </div>
        )}
      </div>
    </Modale>
  );
}
