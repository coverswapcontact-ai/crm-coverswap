"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, FileText, ImagePlus, Loader2, TriangleAlert, Upload, X } from "lucide-react";

/**
 * Mission 17 (partie C) — le formulaire du lien de dépôt, mobile d'abord :
 * appareil photo ou choix de plusieurs fichiers, compression dans le navigateur
 * (2 000 px, JPEG 85 % ; HEIC et PDF partent tels quels, le serveur convertit
 * le HEIC), puis UNE soumission : elle consomme le lien et reçoit une clé
 * d'envoi, avec laquelle les fichiers partent un par un (barre de progression).
 */

type Choisi = { id: string; fichier: File; apercu: string | null };
type Resultat = { nom: string; ok: boolean; message: string };
type Phase = "choix" | "preparation" | "envoi" | "fini";

const mo = (octets: number) => (octets >= 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(octets / 1024))} Ko`);
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

async function compresser(fichier: File, cote: number, qualite: number): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/i.test(fichier.type)) return fichier; // HEIC, PDF : tels quels
  try {
    const image = await createImageBitmap(fichier, { imageOrientation: "from-image" });
    const echelle = Math.min(1, cote / Math.max(image.width, image.height));
    const largeur = Math.round(image.width * echelle);
    const hauteur = Math.round(image.height * echelle);
    const toile = document.createElement("canvas");
    toile.width = largeur;
    toile.height = hauteur;
    const contexte = toile.getContext("2d");
    if (!contexte) return fichier;
    contexte.fillStyle = "#ffffff";
    contexte.fillRect(0, 0, largeur, hauteur);
    contexte.drawImage(image, 0, 0, largeur, hauteur);
    image.close();
    const blob = await new Promise<Blob | null>((resoudre) => toile.toBlob(resoudre, "image/jpeg", qualite));
    if (!blob || blob.size >= fichier.size) return fichier;
    return new File([blob], fichier.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return fichier;
  }
}

function envoyer(url: string, fichier: File, cle: string, progression: (octets: number) => void): Promise<{ statut: number; corps: Record<string, unknown> }> {
  return new Promise((resoudre) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Cle-Depot", cle);
    xhr.setRequestHeader("X-Nom-Fichier", encodeURIComponent(fichier.name));
    xhr.upload.onprogress = (e) => progression(e.loaded);
    xhr.onload = () => {
      let corps: Record<string, unknown> = {};
      try {
        corps = JSON.parse(xhr.responseText);
      } catch {
        corps = { error: "Réponse illisible du serveur." };
      }
      resoudre({ statut: xhr.status, corps });
    };
    xhr.onerror = () => resoudre({ statut: 0, corps: { error: "Réseau coupé pendant l'envoi." } });
    xhr.send(fichier);
  });
}

export function FormulaireDepot(props: { jeton: string; titre: string; expireLe: string; fichiersMax: number; octetsMaxFichier: number; octetsMaxDepot: number; photosSeules: boolean; compression: { cote: number; qualite: number } }) {
  const [choisis, setChoisis] = useState<Choisi[]>([]);
  const [phase, setPhase] = useState<Phase>("choix");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoyes, setEnvoyes] = useState(0);
  const [total, setTotal] = useState(1);
  const [resultats, setResultats] = useState<Resultat[]>([]);
  const appareil = useRef<HTMLInputElement>(null);
  const galerie = useRef<HTMLInputElement>(null);
  const url = `/api/depot/${encodeURIComponent(props.jeton)}`;
  const unSeul = props.fichiersMax === 1;

  const apercus = useRef<string[]>([]);
  useEffect(() => () => apercus.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function ajouter(liste: FileList | null) {
    if (!liste) return;
    setErreur(null);
    const nouveaux = Array.from(liste).map((fichier) => ({ id: `${fichier.name}-${fichier.size}-${Math.random().toString(36).slice(2)}`, fichier, apercu: /^image\/(jpeg|png|webp|gif)$/i.test(fichier.type) ? URL.createObjectURL(fichier) : null }));
    apercus.current.push(...nouveaux.flatMap((n) => (n.apercu ? [n.apercu] : [])));
    setChoisis((avant) => {
      const tous = unSeul ? nouveaux.slice(-1) : [...avant, ...nouveaux];
      if (tous.length > props.fichiersMax) setErreur(`${props.fichiersMax} fichiers au plus par dépôt : les suivants sont ignorés.`);
      return tous.slice(0, props.fichiersMax);
    });
  }

  async function soumettre() {
    if (choisis.length === 0) return;
    setErreur(null);
    setPhase("preparation");
    const prets: File[] = [];
    for (const c of choisis) prets.push(await compresser(c.fichier, props.compression.cote, props.compression.qualite));
    const tropLourd = prets.find((f) => f.size > props.octetsMaxFichier);
    if (tropLourd) {
      setErreur(`« ${tropLourd.name} » dépasse ${mo(props.octetsMaxFichier)} : retire-le.`);
      setPhase("choix");
      return;
    }
    const somme = prets.reduce((s, f) => s + f.size, 0);
    if (somme > props.octetsMaxDepot) {
      setErreur(`Trop lourd pour un seul dépôt (${mo(somme)} ; ${mo(props.octetsMaxDepot)} au plus) : retire des fichiers.`);
      setPhase("choix");
      return;
    }
    // La soumission : le lien est consommé ici, une seule fois.
    const ouverture = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tailles: prets.map((f) => f.size) }) }).catch(() => null);
    const corps = ((await ouverture?.json().catch(() => null)) ?? {}) as { cle?: string; error?: string };
    if (!ouverture?.ok || !corps.cle) {
      setErreur(corps.error ?? "Envoi impossible : vérifie le réseau et réessaie.");
      setPhase(ouverture && ouverture.status === 410 ? "fini" : "choix");
      return;
    }
    setPhase("envoi");
    setTotal(somme || 1);
    let deja = 0;
    const faits: Resultat[] = [];
    for (const fichier of prets) {
      const r = await envoyer(url, fichier, corps.cle, (octets) => setEnvoyes(deja + octets));
      deja += fichier.size;
      setEnvoyes(deja);
      faits.push(r.statut === 200 ? { nom: fichier.name, ok: true, message: String(r.corps.destination ?? "enregistré") + (Array.isArray(r.corps.avertissements) && r.corps.avertissements.length ? ` — ${r.corps.avertissements.join(" ")}` : "") } : { nom: fichier.name, ok: false, message: String(r.corps.error ?? "refusé") });
      setResultats([...faits]);
    }
    setPhase("fini");
  }

  const retirer = (id: string) => setChoisis((avant) => avant.filter((c) => c.id !== id));
  const accepte = props.photosSeules ? "image/*,.heic,.heif" : "image/*,application/pdf,.heic,.heif,.pdf";
  const reussis = resultats.filter((r) => r.ok).length;

  return (
    <div className="mt-4">
      <h1 className="text-[15px] font-medium leading-snug">{props.titre}</h1>
      <p className="mt-1 text-[12.5px] text-texte-3">
        Valable jusqu&apos;à {heure(props.expireLe)}, pour un seul envoi{unSeul ? " d'un fichier" : ` (${props.fichiersMax} fichiers au plus)`}. Photos (JPEG, PNG, WebP, HEIC) {props.photosSeules ? "" : "et PDF"}, {mo(props.octetsMaxFichier)} par fichier.
      </p>

      {phase === "fini" ? (
        <div className="mt-5 space-y-3">
          {resultats.length > 0 ? (
            <p className="flex items-center gap-2 text-[14px] font-medium text-action-clair">
              <CheckCircle2 className="size-5" /> {reussis === resultats.length ? `C'est enregistré : ${reussis} fichier${reussis > 1 ? "s" : ""}.` : `${reussis} sur ${resultats.length} enregistré${reussis > 1 ? "s" : ""}.`}
            </p>
          ) : null}
          {erreur ? <p className="text-[13px] leading-relaxed text-attention-texte">{erreur}</p> : null}
          <ul className="space-y-1.5">
            {resultats.map((r, i) => (
              <li key={i} className={`rounded-[8px] border-[0.5px] px-3 py-2 text-[12.5px] leading-snug ${r.ok ? "border-trait text-texte-2" : "border-attention/40 text-attention-texte"}`}>
                <span className="font-medium">{r.nom}</span> : {r.message}
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] text-texte-3">Tu peux fermer cette page. Le lien a servi : pour déposer d&apos;autres fichiers, demande un nouveau lien à l&apos;assistant.</p>
        </div>
      ) : (
        <>
          <input ref={appareil} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { ajouter(e.target.files); e.target.value = ""; }} />
          <input ref={galerie} type="file" accept={accepte} multiple={!unSeul} className="hidden" onChange={(e) => { ajouter(e.target.files); e.target.value = ""; }} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={phase !== "choix"} onClick={() => appareil.current?.click()} className="flex h-12 items-center justify-center gap-2 rounded-[10px] border-[0.5px] border-trait bg-surface text-[14px] font-medium active:bg-trait disabled:opacity-50">
              <Camera className="size-4.5" /> Photo
            </button>
            <button type="button" disabled={phase !== "choix"} onClick={() => galerie.current?.click()} className="flex h-12 items-center justify-center gap-2 rounded-[10px] border-[0.5px] border-trait bg-surface text-[14px] font-medium active:bg-trait disabled:opacity-50">
              <ImagePlus className="size-4.5" /> {unSeul ? "Choisir" : "Choisir des fichiers"}
            </button>
          </div>

          {choisis.length > 0 ? (
            <ul className="mt-4 grid grid-cols-3 gap-2">
              {choisis.map((c) => (
                <li key={c.id} className="relative aspect-square overflow-hidden rounded-[8px] border-[0.5px] border-trait bg-fond">
                  {c.apercu ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.apercu} alt={c.fichier.name} className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[10.5px] text-texte-3">
                      <FileText className="size-5" />
                      <span className="line-clamp-2 break-all">{c.fichier.name}</span>
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-[10px] text-white">{mo(c.fichier.size)}</span>
                  {phase === "choix" ? (
                    <button type="button" aria-label={`Retirer ${c.fichier.name}`} onClick={() => retirer(c.id)} className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white">
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-[8px] border-[0.5px] border-dashed border-trait px-3 py-6 text-center text-[12.5px] text-texte-3">Aucun fichier choisi.</p>
          )}

          {erreur ? (
            <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-attention-texte">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {erreur}
            </p>
          ) : null}

          {phase === "envoi" || phase === "preparation" ? (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-action transition-[width]" style={{ width: `${phase === "preparation" ? 3 : Math.min(100, Math.round((envoyes / total) * 100))}%` }} />
              </div>
              <p className="mt-1.5 text-[12px] text-texte-3">{phase === "preparation" ? "Préparation des photos…" : `Envoi : ${mo(envoyes)} sur ${mo(total)} (${resultats.length}/${choisis.length} fichier${choisis.length > 1 ? "s" : ""})`}</p>
            </div>
          ) : null}

          <button type="button" disabled={choisis.length === 0 || phase !== "choix"} onClick={() => void soumettre()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-action text-[15px] font-medium text-white active:bg-action disabled:opacity-50">
            {phase === "choix" ? <Upload className="size-4.5" /> : <Loader2 className="size-4.5 animate-spin" />}
            {phase === "choix" ? `Envoyer${choisis.length ? ` (${choisis.length})` : ""}` : "Envoi en cours…"}
          </button>
          <p className="mt-2 text-center text-[11.5px] text-texte-3">Le lien sert une seule fois : choisis tous tes fichiers avant d&apos;envoyer.</p>
        </>
      )}
    </div>
  );
}
