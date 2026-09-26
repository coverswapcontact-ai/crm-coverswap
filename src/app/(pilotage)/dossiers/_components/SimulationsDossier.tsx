"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, Eye, EyeOff, ImagePlus, Loader2, Send, Undo2, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail } from "@/lib/dossiers/types";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Pastille } from "@/components/pilotage/ui";
import { Visionneuse, type ImageVisionneuse } from "@/components/pilotage/Visionneuse";
import { Bouton, Champ, Modale, TitreSection } from "./ui";
import { cn } from "@/lib/utils";

/**
 * Les simulations du dossier, d'où qu'elles viennent (site, API, ChatGPT,
 * dépôt). Tout ce qui vient du CRM arrive en BROUILLON : Lucas choisit ce qu'il
 * publie dans l'espace du client — qui ne voit jamais un rendu raté ; le
 * client est prévenu par mail, automatiquement (mission 7 : le mail remplace
 * le SMS). Une image rendue par ChatGPT se dépose ici : elle reprend la
 * préparation (photo avant, teintes, version du prompt).
 */

type Zone = { zone: string; libelle: string; ref: string; nom: string };
type Simulation = {
  id: string;
  source: "SITE" | "API" | "CHATGPT" | "MANUEL";
  statut: "BROUILLON" | "PUBLIEE" | "MASQUEE";
  titre: string | null;
  description: string | null;
  typeLibelle: string | null;
  zones: Zone[];
  promptVersion: number | null;
  coutDollars: number | null;
  le: string;
  publieeLe: string | null;
  vueLe: string | null;
  choisie: boolean;
  commentaire: string | null;
  image: string;
  avant: string | null;
  horsEspace?: boolean;
};
type Preparation = { id: string; mode: "CHATGPT" | "API"; statut: string; typeLibelle: string; zones: { etiquette: string; ref: string; nom: string }[]; erreur: string | null; le: string; promptVersion: number | null };
type Donnees = { espace: { id: string; lien: string | null } | null; simulations: Simulation[]; preparations: Preparation[]; sms: { texte: string | null; raison?: string; dejaPrevenuLe?: string; attente?: string } };

const SOURCES: Record<Simulation["source"], { libelle: string; ton: "bleu" | "vert" | "ambre" | "neutre" }> = {
  SITE: { libelle: "Faite par le client (site)", ton: "bleu" },
  API: { libelle: "API", ton: "neutre" },
  CHATGPT: { libelle: "ChatGPT", ton: "neutre" },
  MANUEL: { libelle: "Déposée", ton: "neutre" },
};

const heure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function SimulationsDossier({ detail, onRecharger, sansTitre = false }: { detail: DossierDetail; onRecharger: () => Promise<void>; sansTitre?: boolean }) {
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [publication, setPublication] = useState<{ prevenir: boolean; texte: string } | null>(null);
  const [depot, setDepot] = useState<{ fichier: File; apercu: string } | null>(null);
  const [depotInfos, setDepotInfos] = useState({ titre: "", description: "", preparation: "auto" });
  const [occupe, setOccupe] = useState<string | null>(null);
  // Mission 12 : une simulation s'ouvre dans la visionneuse (après, puis avant), plus dans un nouvel onglet.
  const [visionneuse, setVisionneuse] = useState<{ images: ImageVisionneuse[]; index: number } | null>(null);
  function ouvrirImage(liste: Simulation[], s: Simulation, quoi: "image" | "avant") {
    const images: ImageVisionneuse[] = [];
    let index = 0;
    for (const x of liste) {
      if (x.id === s.id && quoi === "image") index = images.length;
      images.push({ id: `${x.id}-apres`, url: x.image, legende: `${x.titre ?? "Simulation"} — après` });
      if (x.avant) {
        if (x.id === s.id && quoi === "avant") index = images.length;
        images.push({ id: `${x.id}-avant`, url: x.avant, legende: `${x.titre ?? "Simulation"} — avant (photo d'origine)` });
      }
    }
    setVisionneuse({ images, index });
  }
  const entree = useRef<HTMLInputElement>(null);

  const charger = useCallback(async () => {
    try {
      setDonnees(await appelApi<Donnees>(`/api/dossiers/${detail.id}/simulations`));
    } catch (erreur) {
      toast.error("Simulations non chargées", { description: messageErreur(erreur) });
    }
  }, [detail.id]);

  useEffect(() => {
    const premier = window.setTimeout(() => void charger(), 0);
    return () => window.clearTimeout(premier);
  }, [charger]);

  // Une génération par l'API est en cours : on suit jusqu'au brouillon.
  const enCours = donnees?.preparations.some((p) => p.mode === "API" && p.statut === "EN_COURS") ?? false;
  useEffect(() => {
    if (!enCours) return;
    const minuterie = window.setInterval(() => void charger(), 5000);
    return () => window.clearInterval(minuterie);
  }, [enCours, charger]);

  const brouillons = donnees?.simulations.filter((s) => s.statut === "BROUILLON") ?? [];
  const publiees = donnees?.simulations.filter((s) => s.statut === "PUBLIEE") ?? [];
  const masquees = donnees?.simulations.filter((s) => s.statut === "MASQUEE") ?? [];
  const chatgptEnAttente = donnees?.preparations.find((p) => p.mode === "CHATGPT" && p.statut === "PREPAREE") ?? null;

  function basculer(id: string) {
    setSelection((s) => {
      const suite = new Set(s);
      if (suite.has(id)) suite.delete(id);
      else suite.add(id);
      return suite;
    });
  }

  function ouvrirPublication(ids: string[]) {
    setSelection(new Set(ids));
    // Mission 7 : plus de SMS proposé ; le client est prévenu par mail, automatiquement.
    setPublication({ prevenir: false, texte: "" });
  }

  async function publier() {
    if (!publication) return;
    setOccupe("publier");
    try {
      const resultat = await envoyerJson<{ publiees: number; mail?: { programme: boolean; raison?: string } }>(`/api/dossiers/${detail.id}/simulations/publier`, "POST", { ids: [...selection], prevenir: false });
      toast.success(`${resultat.publiees > 1 ? `${resultat.publiees} simulations publiées` : "Simulation publiée"} dans l'espace du client`, {
        description: resultat.mail?.programme ? "Le mail « Votre simulation est prête » part tout seul vers le client." : `Pas de mail : ${resultat.mail?.raison ?? "rien de nouveau publié"}`,
      });
      setPublication(null);
      setSelection(new Set());
      await Promise.all([charger(), onRecharger()]);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function changer(id: string, action: "masquer" | "afficher" | "brouillon" | "retirer") {
    setOccupe(`${action}-${id}`);
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/simulations/${id}`, "PATCH", { action });
      toast.success(action === "masquer" ? "Masquée : le client ne la voit plus" : action === "afficher" ? "À nouveau visible par le client" : action === "retirer" ? "Retirée du dossier (archivée)" : "Repassée en brouillon");
      await charger();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function deposer() {
    if (!depot) return;
    setOccupe("depot");
    try {
      const formulaire = new FormData();
      formulaire.append("image", depot.fichier);
      formulaire.append("titre", depotInfos.titre);
      formulaire.append("description", depotInfos.description);
      formulaire.append("preparation", depotInfos.preparation);
      formulaire.append("source", depotInfos.preparation === "aucune" ? "MANUEL" : "CHATGPT");
      await appelApi(`/api/dossiers/${detail.id}/simulations`, { method: "POST", body: formulaire });
      toast.success("Simulation déposée en brouillon", { description: "Relisez-la, puis publiez-la dans l'espace du client." });
      URL.revokeObjectURL(depot.apercu);
      setDepot(null);
      setDepotInfos({ titre: "", description: "", preparation: "auto" });
      await Promise.all([charger(), onRecharger()]);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  const actions = (
    <div className="flex gap-1.5">
      <Link href={`/simulateur?dossier=${detail.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7">
        <WandSparkles size={13} aria-hidden /> Simulateur
      </Link>
      <Bouton taille="sm" icone={<ImagePlus size={13} aria-hidden />} onClick={() => entree.current?.click()}>
        Déposer
      </Bouton>
    </div>
  );

  return (
    <section>
      {sansTitre ? <div className="mb-3 flex justify-end">{actions}</div> : <TitreSection action={actions}>Simulations</TitreSection>}
      <input
        ref={entree}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const fichier = e.target.files?.[0];
          if (fichier) setDepot({ fichier, apercu: URL.createObjectURL(fichier) });
          e.target.value = "";
        }}
      />

      {donnees === null ? (
        <p className="text-[13px] text-[#6B7280]">Chargement…</p>
      ) : (
        <div className="space-y-3">
          {donnees.preparations
            .filter((p) => p.mode === "API" && (p.statut === "EN_COURS" || (p.statut === "ECHEC" && Date.now() - new Date(p.le).getTime() < 86_400_000)))
            .map((p) => (
              <div key={p.id} className={cn("rounded-[10px] border-[0.5px] px-3 py-2.5 text-[12.5px]", p.statut === "ECHEC" ? "border-[#EF4444]/35 bg-[#EF4444]/[0.07] text-[#FCA5A5]" : "border-[#2A2D34] bg-[#1C1F25] text-[#D1D5DB]")}>
                {p.statut === "EN_COURS" ? (
                  <span className="flex items-center gap-2">
                    <Loader2 size={13} className="animate-spin" aria-hidden /> Génération par l&apos;API en cours ({p.typeLibelle}, {p.zones.map((z) => z.ref).join(" · ")}) — le brouillon arrive ici, en général en une minute.
                  </span>
                ) : (
                  <>Génération du {heure(p.le)} non aboutie : {p.erreur}</>
                )}
              </div>
            ))}

          {chatgptEnAttente ? (
            <div className="rounded-[10px] border-[0.5px] border-[#60A5FA]/35 bg-[#60A5FA]/[0.07] px-3 py-2.5 text-[12.5px] text-[#BFDBFE]">
              Préparé pour ChatGPT le {heure(chatgptEnAttente.le)} ({chatgptEnAttente.typeLibelle}, {chatgptEnAttente.zones.map((z) => `${z.etiquette.split(" · ")[0]} ${z.ref}`).join(", ")}, prompt v{chatgptEnAttente.promptVersion}) : déposez l&apos;image rendue, elle reprendra tout.
              <button type="button" onClick={() => entree.current?.click()} className="ml-1 font-medium text-[#93C5FD] underline underline-offset-2">
                Déposer l&apos;image
              </button>
            </div>
          ) : null}

          {donnees.simulations.length === 0 ? (
            <p className="rounded-[12px] border-[0.5px] border-dashed border-[#2A2D34] p-4 text-[13px] text-[#9CA3AF]">Aucune simulation. Préparez-en une dans le simulateur (API ou ChatGPT), ou déposez une image.</p>
          ) : null}

          {visionneuse ? <Visionneuse images={visionneuse.images} index={visionneuse.index} onIndex={(index) => setVisionneuse((v) => (v ? { ...v, index } : v))} onFermer={() => setVisionneuse(null)} /> : null}

          {brouillons.length > 0 ? (
            <Groupe
              titre={`Brouillons · ${brouillons.length}`}
              aide="Le client ne les voit pas."
              action={
                <Bouton taille="sm" variante="primaire" icone={<Send size={13} aria-hidden />} onClick={() => ouvrirPublication(selection.size > 0 ? [...selection].filter((id) => brouillons.some((b) => b.id === id)) : brouillons.map((b) => b.id))}>
                  Publier {selection.size > 0 ? `(${[...selection].filter((id) => brouillons.some((b) => b.id === id)).length})` : brouillons.length > 1 ? "tout" : ""}
                </Bouton>
              }
            >
              {brouillons.map((s) => (
                <Vignette key={s.id} s={s} selection={selection.has(s.id)} onSelection={() => basculer(s.id)} occupe={occupe} onOuvrir={(quoi) => ouvrirImage(brouillons, s, quoi)}>
                  <Bouton taille="sm" variante="primaire" onClick={() => ouvrirPublication([s.id])}>
                    Publier
                  </Bouton>
                  <Bouton taille="sm" variante="fantome" icone={<Archive size={12} aria-hidden />} chargement={occupe === `retirer-${s.id}`} onClick={() => void changer(s.id, "retirer")}>
                    Retirer
                  </Bouton>
                </Vignette>
              ))}
            </Groupe>
          ) : null}

          {publiees.length > 0 ? (
            <Groupe titre={`Dans l'espace du client · ${publiees.length}`} aide={donnees.espace ? "Visibles par le client." : "Elles y seront dès l'ouverture de son espace."}>
              {publiees.map((s) => (
                <Vignette key={s.id} s={s} occupe={occupe} onOuvrir={(quoi) => ouvrirImage(publiees, s, quoi)}>
                  {!s.horsEspace ? (
                    <Bouton taille="sm" variante="fantome" icone={<EyeOff size={12} aria-hidden />} chargement={occupe === `masquer-${s.id}`} onClick={() => void changer(s.id, "masquer")}>
                      Masquer
                    </Bouton>
                  ) : null}
                </Vignette>
              ))}
            </Groupe>
          ) : null}

          {masquees.length > 0 ? (
            <Groupe titre={`Masquées · ${masquees.length}`} aide="Retirées de la vue du client ; rien n'est effacé.">
              {masquees.map((s) => (
                <Vignette key={s.id} s={s} occupe={occupe} onOuvrir={(quoi) => ouvrirImage(masquees, s, quoi)}>
                  <Bouton taille="sm" variante="fantome" icone={<Eye size={12} aria-hidden />} chargement={occupe === `afficher-${s.id}`} onClick={() => void changer(s.id, "afficher")}>
                    Afficher
                  </Bouton>
                  <Bouton taille="sm" variante="fantome" icone={<Undo2 size={12} aria-hidden />} chargement={occupe === `brouillon-${s.id}`} onClick={() => void changer(s.id, "brouillon")}>
                    En brouillon
                  </Bouton>
                </Vignette>
              ))}
            </Groupe>
          ) : null}
        </div>
      )}

      <Modale
        ouverte={publication !== null}
        onFermer={() => setPublication(null)}
        titre={selection.size > 1 ? `Publier ${selection.size} simulations` : "Publier la simulation"}
        description="Le client la verra dans son espace, avant / après sur sa photo."
        pied={
          <Bouton variante="primaire" className="h-12 w-full text-[15px] sm:h-9 sm:text-[13px]" chargement={occupe === "publier"} onClick={() => void publier()}>
            Publier

          </Bouton>
        }
      >
        {publication ? (
          <p className="text-[13px] leading-relaxed text-[#D1D5DB]">
            Le client est prévenu par mail, automatiquement : « Votre simulation est prête », avec un bouton vers son espace. Un seul mail par publication, et seulement s&apos;il a une adresse e-mail valide.
          </p>
        ) : null}
      </Modale>

      <Modale
        ouverte={depot !== null}
        onFermer={() => setDepot(null)}
        titre="Déposer une simulation"
        description="Elle arrive en brouillon : le client ne la verra qu'après publication."
        pied={
          <Bouton variante="primaire" className="h-12 w-full text-[15px] sm:h-9 sm:text-[13px]" chargement={occupe === "depot"} onClick={() => void deposer()}>
            Déposer en brouillon
          </Bouton>
        }
      >
        {depot ? (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local */}
            <img src={depot.apercu} alt="" className="max-h-56 w-full rounded-[10px] object-contain" />
            <label className="block text-[12px] font-medium text-[#9CA3AF]">
              D&apos;où vient cette image ?
              <select value={depotInfos.preparation} onChange={(e) => setDepotInfos({ ...depotInfos, preparation: e.target.value })} className="mt-1.5 h-10 w-full rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-2 text-[14px] text-[#F2F3F5] [color-scheme:dark] sm:h-9 sm:text-[13px]">
                <option value="auto">{chatgptEnAttente ? `ChatGPT — préparation du ${heure(chatgptEnAttente.le)} (${chatgptEnAttente.typeLibelle})` : "La dernière préparation ChatGPT (s'il y en a une)"}</option>
                {donnees?.preparations
                  .filter((p) => p.mode === "CHATGPT" && p.id !== chatgptEnAttente?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      ChatGPT — {heure(p.le)} ({p.typeLibelle})
                    </option>
                  ))}
                <option value="aucune">Autre image (sans préparation)</option>
              </select>
            </label>
            <Champ libelle="Titre pour le client (facultatif)" placeholder="Chêne clair et plan effet marbre" maxLength={80} value={depotInfos.titre} onChange={(e) => setDepotInfos({ ...depotInfos, titre: e.target.value })} />
            <Champ libelle="Un mot pour le client (facultatif)" placeholder="La version la plus lumineuse" maxLength={400} value={depotInfos.description} onChange={(e) => setDepotInfos({ ...depotInfos, description: e.target.value })} />
          </div>
        ) : null}
      </Modale>
    </section>
  );
}

function Groupe({ titre, aide, action, children }: { titre: string; aide: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[12px] text-[#9CA3AF]">
          <span className="font-medium text-[#D1D5DB]">{titre}</span> · {aide}
        </p>
        {action}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</ul>
    </div>
  );
}

function Vignette({ s, selection, onSelection, occupe, onOuvrir, children }: { s: Simulation; selection?: boolean; onSelection?: () => void; occupe: string | null; onOuvrir: (quoi: "image" | "avant") => void; children?: React.ReactNode }) {
  const source = SOURCES[s.source];
  return (
    <li className={cn("overflow-hidden rounded-[10px] border-[0.5px] bg-[#1C1F25]", s.choisie ? "border-[#1D9E75]" : selection ? "border-[#5DCAA5]/70" : "border-[#2A2D34]", occupe?.endsWith(s.id) && "opacity-70")}>
      <div className="relative">
        <button type="button" onClick={() => onOuvrir("image")} className="block aspect-[3/2] w-full bg-[#16181D]" aria-label="Agrandir la simulation">
          {/* eslint-disable-next-line @next/next/no-img-element -- image privée, servie derrière la session */}
          <img src={s.image} alt={s.titre ?? "Simulation"} className="h-full w-full object-cover" loading="lazy" />
        </button>
        {onSelection ? (
          <label className="absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55">
            <input type="checkbox" checked={Boolean(selection)} onChange={onSelection} className="h-4 w-4 accent-[#1D9E75]" aria-label="Choisir pour publier" />
          </label>
        ) : null}
        {s.avant ? (
          <button type="button" onClick={() => onOuvrir("avant")} className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
            Avant
          </button>
        ) : null}
      </div>
      <div className="space-y-1.5 p-2.5">
        <p className="truncate text-[12.5px] text-[#F2F3F5]">{s.titre ?? s.typeLibelle ?? "Simulation"}</p>
        <div className="flex flex-wrap gap-1">
          <Pastille ton={source.ton}>{source.libelle}</Pastille>
          {s.promptVersion ? <Pastille>prompt v{s.promptVersion}</Pastille> : null}
          {s.coutDollars ? <Pastille>{s.coutDollars.toFixed(2).replace(".", ",")} $</Pastille> : null}
          {s.choisie ? <Pastille ton="vert">Choisie</Pastille> : s.vueLe ? <Pastille ton="bleu">Vue</Pastille> : null}
        </div>
        {s.zones.length > 0 ? <p className="text-[11.5px] leading-snug text-[#9CA3AF]">{s.zones.map((z) => `${z.libelle || z.zone} : ${z.nom || z.ref} (${z.ref})`).join(" · ")}</p> : null}
        {s.commentaire ? <p className="text-[11.5px] leading-snug text-[#D1D5DB]">« {s.commentaire} »</p> : null}
        <p className="text-[11px] text-[#6B7280]">{heure(s.publieeLe ?? s.le)}</p>
        {children ? <div className="flex flex-wrap gap-1.5 pt-0.5">{children}</div> : null}
      </div>
    </li>
  );
}

