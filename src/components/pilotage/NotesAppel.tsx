"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Plus } from "lucide-react";
import { LIBELLES_ISSUE, type IssueAppel } from "@/lib/commercial/constantes";
import { ETIQUETTES_APPEL, LIBELLES_ETIQUETTE_APPEL, NOTE_APPEL_OUVERTE_MS, type EtiquetteAppel, type NoteAppelVue } from "@/lib/commercial/notes-constantes";
import { cn } from "@/lib/utils";

/**
 * Notes d'appel d'un contact : un champ toujours là (pas une fenêtre), grand,
 * qui s'enregistre à la frappe et à la sortie de l'écran — un appel qui coupe
 * ou un passage à une autre appli ne perd rien. La dictée de l'iPhone y
 * fonctionne (champ natif, jamais réécrit pendant la saisie). Chaque appel a
 * sa note, datée ; les précédentes s'empilent en dessous. Sans réseau, la note
 * reste sur le téléphone et part au retour du réseau.
 *
 * Retour de l'écran d'appel d'iOS : l'appui sur le numéro retient qui l'on
 * appelle (`noterDebutAppel`) ; au retour dans l'appli, le champ de ce
 * contact revient à l'écran, prêt à écrire.
 */

export type NotesAppelRef = {
  /** Envoie ce qui attend (avant d'enregistrer l'issue de l'appel, par exemple). */
  vider: () => Promise<void>;
};

type Brouillon = { noteId: string | null; texte: string; etiquettes: EtiquetteAppel[]; appelLe: string | null };
type EtatEnvoi = { etat: "" | "en-cours" | "ok" | "attente" | "erreur"; message?: string };

const cleLocale = (leadId: string) => `note-appel:${leadId}`;
const CLE_APPEL_EN_COURS = "appel-en-cours";
const DUREE_APPEL_EN_COURS_MS = 2 * 3_600_000;

/** Appui sur le numéro d'un contact : on retient qui l'on appelle, et depuis quand. */
export function noterDebutAppel(leadId: string): void {
  try {
    localStorage.setItem(CLE_APPEL_EN_COURS, JSON.stringify({ leadId, le: new Date().toISOString() }));
  } catch {
    // stockage indisponible : le retour d'appel ne ramènera simplement pas sur la note
  }
}

function appelEnCours(): { leadId: string; le: string } | null {
  try {
    const brut = localStorage.getItem(CLE_APPEL_EN_COURS);
    if (!brut) return null;
    const appel = JSON.parse(brut) as { leadId: string; le: string };
    return Date.now() - new Date(appel.le).getTime() < DUREE_APPEL_EN_COURS_MS ? appel : null;
  } catch {
    return null;
  }
}

export function finAppel(leadId: string): void {
  try {
    if (appelEnCours()?.leadId === leadId) localStorage.removeItem(CLE_APPEL_EN_COURS);
  } catch {
    // rien
  }
}

/* ── Retour de l'écran d'appel : un seul champ reprend la main ─────────── */

type Instance = { leadId: string; priorite: number; champ: () => HTMLTextAreaElement | null };
const instances = new Set<Instance>();
let ecoute = false;

function ramenerSurLaNote() {
  const appel = appelEnCours();
  if (!appel) return;
  // Le mode appels passe devant la fiche, la fiche devant la liste ; seulement un champ visible.
  const candidats = [...instances].filter((i) => i.leadId === appel.leadId && i.champ()?.offsetParent).sort((a, b) => b.priorite - a.priorite);
  const champ = candidats[0]?.champ();
  if (!champ) return;
  window.setTimeout(() => {
    champ.scrollIntoView({ block: "center", behavior: "smooth" });
    champ.focus({ preventScroll: true });
  }, 250);
}

function ecouterRetours() {
  if (ecoute || typeof window === "undefined") return;
  ecoute = true;
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && ramenerSurLaNote());
  window.addEventListener("pageshow", ramenerSurLaNote);
}

/* ── Plusieurs blocs pour le même contact (liste et fiche ouvertes) : ils restent d'accord ── */

type Abonne = { source: symbol; recevoir: (b: Brouillon) => void };
const abonnes = new Map<string, Set<Abonne>>();

function publier(leadId: string, source: symbol, b: Brouillon) {
  for (const a of abonnes.get(leadId) ?? []) if (a.source !== source) a.recevoir(b);
}

/* ── Le bloc ───────────────────────────────────────────────────────── */

function depart(leadId: string, notes: NoteAppelVue[]): Brouillon {
  try {
    const garde = localStorage.getItem(cleLocale(leadId));
    if (garde) return JSON.parse(garde) as Brouillon;
  } catch {
    // rien de gardé
  }
  const derniere = notes[0];
  if (derniere && Date.now() - new Date(derniere.appelLe).getTime() < NOTE_APPEL_OUVERTE_MS) return { noteId: derniere.id, texte: derniere.texte, etiquettes: derniere.etiquettes, appelLe: derniere.appelLe };
  return { noteId: null, texte: "", etiquettes: [], appelLe: null };
}

const dateAppel = (iso: string) => {
  const d = new Date(iso);
  const jour = new Date().toDateString() === d.toDateString() ? "aujourd'hui" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return `${jour} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
};

export function NotesAppel({ leadId, notes, variante = "liste", ref }: { leadId: string; notes: NoteAppelVue[]; variante?: "liste" | "fiche" | "appels"; ref?: Ref<NotesAppelRef> }) {
  const [brouillon, setBrouillon] = useState<Brouillon>(() => depart(leadId, notes));
  const [envoi, setEnvoi] = useState<EtatEnvoi>({ etat: "" });
  const [enregistrees, setEnregistrees] = useState<NoteAppelVue[]>([]);
  const [focus, setFocus] = useState(false);
  const [toutes, setToutes] = useState(false);
  const courant = useRef(brouillon);
  const minuterie = useRef<number | null>(null);
  const vol = useRef<Promise<void> | null>(null);
  const encore = useRef(false);
  const champ = useRef<HTMLTextAreaElement>(null);
  const [moi] = useState(() => Symbol("notes-appel"));
  const grande = variante === "appels";
  const idChamp = `note-appel-${variante}-${leadId}`;

  /** Un envoi à la fois, toujours la dernière version ; le premier crée la note, les suivants la complètent. */
  function enregistrer(garder = false): Promise<void> {
    if (vol.current) {
      encore.current = true;
      return vol.current;
    }
    vol.current = (async () => {
      try {
        do {
          encore.current = false;
          const b = courant.current;
          if (!b.noteId && !b.texte.trim() && b.etiquettes.length === 0) {
            setEnvoi({ etat: "" });
            break;
          }
          setEnvoi({ etat: "en-cours" });
          let reponse: Response;
          try {
            reponse = await fetch(b.noteId ? `/api/leads/${leadId}/notes-appel/${b.noteId}` : `/api/leads/${leadId}/notes-appel`, {
              method: b.noteId ? "PUT" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ texte: b.texte, etiquettes: b.etiquettes, ...(b.noteId || !b.appelLe ? {} : { appelLe: b.appelLe }) }),
              keepalive: garder,
            });
          } catch {
            reponse = new Response(null, { status: 599 });
          }
          if (reponse.status >= 500 || reponse.status === 429) {
            // Réseau coupé ou serveur indisponible : la note reste ici, elle partira au retour du réseau.
            try {
              localStorage.setItem(cleLocale(leadId), JSON.stringify(courant.current));
            } catch {
              // stockage indisponible
            }
            setEnvoi({ etat: "attente" });
            return;
          }
          const corps = (await reponse.json().catch(() => ({}))) as { note?: NoteAppelVue; error?: string };
          if (!reponse.ok || !corps.note) {
            setEnvoi({ etat: "erreur", message: reponse.status === 401 ? "Session expirée : reconnecte-toi, la note est gardée ici." : (corps.error ?? `Note non enregistrée (erreur ${reponse.status}).`) });
            try {
              localStorage.setItem(cleLocale(leadId), JSON.stringify(courant.current));
            } catch {
              // stockage indisponible
            }
            return;
          }
          const note = corps.note;
          if (!courant.current.noteId) {
            courant.current = { ...courant.current, noteId: note.id, appelLe: note.appelLe };
            setBrouillon((avant) => ({ ...avant, noteId: note.id, appelLe: note.appelLe }));
          }
          publier(leadId, moi, courant.current);
          setEnregistrees((avant) => [note, ...avant.filter((n) => n.id !== note.id)]);
          if (!encore.current) {
            try {
              localStorage.removeItem(cleLocale(leadId));
            } catch {
              // rien
            }
          }
          setEnvoi({ etat: "ok" });
          if (note.texte.trim()) finAppel(leadId);
        } while (encore.current);
      } finally {
        vol.current = null;
      }
    })();
    return vol.current;
  }

  function changer(modif: (b: Brouillon) => Brouillon, delai = 1200) {
    const suite = modif(courant.current);
    // L'heure de l'appel : celle de l'appui sur le numéro s'il vient d'être appelé, sinon la première frappe.
    if (!suite.noteId && !suite.appelLe) {
      const appel = appelEnCours();
      suite.appelLe = appel?.leadId === leadId ? appel.le : new Date().toISOString();
    }
    courant.current = suite;
    setBrouillon(suite);
    publier(leadId, moi, suite);
    setEnvoi({ etat: "en-cours" });
    if (minuterie.current) window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => {
      minuterie.current = null;
      void enregistrer();
    }, delai);
  }

  function vider(garder = false): Promise<void> {
    if (minuterie.current) {
      window.clearTimeout(minuterie.current);
      minuterie.current = null;
      return enregistrer(garder);
    }
    return vol.current ?? Promise.resolve();
  }

  useImperativeHandle(ref, () => ({ vider: () => vider() }));

  // L'autre bloc du même contact a écrit : on suit (sauf si l'on est en train d'écrire ici).
  useEffect(() => {
    const abonne: Abonne = {
      source: moi,
      recevoir: (b) => {
        if (document.activeElement === champ.current) return;
        courant.current = b;
        setBrouillon(b);
      },
    };
    const liste = abonnes.get(leadId) ?? new Set<Abonne>();
    liste.add(abonne);
    abonnes.set(leadId, liste);
    return () => {
      liste.delete(abonne);
    };
  }, [leadId, moi]);

  useEffect(() => {
    const instance: Instance = { leadId, priorite: variante === "appels" ? 3 : variante === "fiche" ? 2 : 1, champ: () => champ.current };
    instances.add(instance);
    ecouterRetours();
    const surMasque = () => document.visibilityState === "hidden" && void vider(true);
    const surDepart = () => void vider(true);
    const surReseau = () => {
      try {
        if (localStorage.getItem(cleLocale(leadId))) void enregistrer();
      } catch {
        // rien
      }
    };
    document.addEventListener("visibilitychange", surMasque);
    window.addEventListener("pagehide", surDepart);
    window.addEventListener("online", surReseau);
    surReseau();
    // Ouvert juste après l'appel (mode appels, fiche) : le champ est prêt.
    if (appelEnCours()?.leadId === leadId) ramenerSurLaNote();
    return () => {
      instances.delete(instance);
      document.removeEventListener("visibilitychange", surMasque);
      window.removeEventListener("pagehide", surDepart);
      window.removeEventListener("online", surReseau);
      void vider(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, variante]);

  // « Enregistré » s'efface ; une attente ou une erreur reste affichée.
  useEffect(() => {
    if (envoi.etat !== "ok") return;
    const t = window.setTimeout(() => setEnvoi((e) => (e.etat === "ok" ? { etat: "" } : e)), 2500);
    return () => window.clearTimeout(t);
  }, [envoi]);

  const precedentes = useMemo(() => {
    const parId = new Map<string, NoteAppelVue>();
    for (const n of [...notes, ...enregistrees]) parId.set(n.id, n);
    return [...parId.values()].filter((n) => n.id !== brouillon.noteId && (n.texte.trim() || n.etiquettes.length || n.issue)).sort((a, b) => b.appelLe.localeCompare(a.appelLe));
  }, [notes, enregistrees, brouillon.noteId]);
  const visibles = toutes ? precedentes : precedentes.slice(0, grande ? 3 : 1);

  function nouvelAppel() {
    void vider().then(() => {
      const vierge: Brouillon = { noteId: null, texte: "", etiquettes: [], appelLe: null };
      courant.current = vierge;
      setBrouillon(vierge);
      publier(leadId, moi, vierge);
      setEnvoi({ etat: "" });
      champ.current?.focus();
    });
  }

  const basculer = (e: EtiquetteAppel) => changer((b) => ({ ...b, etiquettes: b.etiquettes.includes(e) ? b.etiquettes.filter((x) => x !== e) : [...b.etiquettes, e] }), 400);
  const statut =
    envoi.etat === "en-cours" ? "Enregistrement…" : envoi.etat === "ok" ? "Enregistré ✓" : envoi.etat === "attente" ? "Pas de réseau : gardée sur ce téléphone, envoyée au retour du réseau." : envoi.etat === "erreur" ? envoi.message : "";

  return (
    <div className={cn(grande ? "mt-5" : "mt-3")} onClick={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={idChamp} className={cn("font-medium text-[#9CA3AF]", grande ? "text-[13px]" : "text-[12px]")}>
          {brouillon.noteId && brouillon.appelLe ? `Note de l'appel · ${dateAppel(brouillon.appelLe)}` : "Note d'appel"}
        </label>
        {brouillon.noteId ? (
          <button type="button" onClick={nouvelAppel} className="flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12px] text-[#5DCAA5] hover:bg-[#1D9E75]/10">
            <Plus size={13} aria-hidden /> Nouvel appel
          </button>
        ) : null}
      </div>
      <textarea
        ref={champ}
        id={idChamp}
        value={brouillon.texte}
        onChange={(e) => {
          const texte = e.target.value;
          changer((b) => ({ ...b, texte }));
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          void vider();
        }}
        rows={grande ? 5 : focus || brouillon.texte ? 4 : 2}
        maxLength={8000}
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck
        enterKeyHint="enter"
        placeholder={grande ? "Ce qu'il dit, pendant ou juste après l'appel (vous pouvez dicter) : cuisine de 2015, veut changer les façades avant Noël…" : "Ce qu'il a dit au téléphone…"}
        className={cn(
          "w-full resize-y rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 py-2.5 text-[16px] leading-relaxed text-[#F2F3F5] placeholder:text-[#6B7280] focus:border-[#1D9E75]/70 focus:outline-none",
          grande ? "min-h-[140px]" : "min-h-[64px] sm:text-[14px]"
        )}
      />
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Étiquettes de l'appel">
        {ETIQUETTES_APPEL.map((e) => {
          const actif = brouillon.etiquettes.includes(e);
          return (
            <button
              key={e}
              type="button"
              aria-pressed={actif}
              onClick={() => basculer(e)}
              className={cn(
                "rounded-full border-[0.5px] px-3 font-medium",
                grande ? "h-10 text-[14px]" : "h-8 text-[12.5px]",
                actif ? "border-[#1D9E75] bg-[#1D9E75]/20 text-[#5DCAA5]" : "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#E5E7EB]"
              )}
            >
              {LIBELLES_ETIQUETTE_APPEL[e]}
            </button>
          );
        })}
      </div>
      <p className={cn("mt-1.5 min-h-[18px] text-[12px]", envoi.etat === "attente" ? "text-[#F5B454]" : envoi.etat === "erreur" ? "text-[#F87171]" : envoi.etat === "ok" ? "text-[#5DCAA5]" : "text-[#6B7280]")} aria-live="polite" role={envoi.etat === "erreur" ? "alert" : undefined}>
        {statut}
      </p>
      {precedentes.length > 0 ? (
        <div className="mt-1">
          <ol className="space-y-2">
            {visibles.map((n) => (
              <li key={n.id} className="rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#16181D]/60 px-3 py-2">
                <p className="text-[11.5px] text-[#8B919C]">
                  Appel {dateAppel(n.appelLe)}
                  {n.issue ? ` · ${LIBELLES_ISSUE[n.issue as IssueAppel] ?? n.issue}` : ""}
                  {n.dansDossier ? " · dans le dossier" : ""}
                </p>
                {n.etiquettes.length > 0 ? (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {n.etiquettes.map((e) => (
                      <span key={e} className="rounded-full bg-[#22262D] px-2 py-0.5 text-[11px] text-[#D1D5DB]">
                        {LIBELLES_ETIQUETTE_APPEL[e]}
                      </span>
                    ))}
                  </p>
                ) : null}
                {n.texte ? <p className={cn("mt-1 text-[13px] leading-snug whitespace-pre-line text-[#D1D5DB]", !toutes && "line-clamp-3")}>{n.texte}</p> : null}
              </li>
            ))}
          </ol>
          {precedentes.length > visibles.length || toutes ? (
            <button type="button" onClick={() => setToutes((t) => !t)} className="mt-1.5 h-8 text-[12px] text-[#5DCAA5] hover:underline">
              {toutes ? "Réduire" : `Voir ${precedentes.length - visibles.length === 1 ? "l'autre appel" : `les ${precedentes.length - visibles.length} autres appels`}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Les notes d'un contact chargées à l'ouverture (fiche du lead, fiche du dossier) : le bloc s'affiche une fois lues. */
export function NotesAppelDuLead({ leadId, variante = "fiche" }: { leadId: string; variante?: "liste" | "fiche" | "appels" }) {
  const [notes, setNotes] = useState<{ leadId: string; liste: NoteAppelVue[] } | null>(null);
  const [echec, setEchec] = useState(false);
  useEffect(() => {
    let actif = true;
    fetch(`/api/leads/${leadId}/notes-appel`)
      .then((r) => (r.ok ? (r.json() as Promise<{ notes: NoteAppelVue[] }>) : Promise.reject(new Error(String(r.status)))))
      .then(({ notes: liste }) => actif && setNotes({ leadId, liste }))
      // Hors ligne : le champ reste utilisable (la note partira au retour du réseau).
      .catch(() => actif && (setEchec(true), setNotes({ leadId, liste: [] })));
    return () => {
      actif = false;
    };
  }, [leadId]);
  if (!notes || notes.leadId !== leadId) return <p className="mt-3 text-[12px] text-[#6B7280]">Notes d&apos;appel…</p>;
  return (
    <>
      <NotesAppel key={leadId} leadId={leadId} notes={notes.liste} variante={variante} />
      {echec ? <p className="text-[12px] text-[#F5B454]">Notes précédentes indisponibles hors ligne.</p> : null}
    </>
  );
}
