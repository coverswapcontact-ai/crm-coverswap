"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Visionneuse d'images du CRM (mission 12) : une photo ou une simulation
 * s'ouvre en grand SANS quitter l'application. On en sort par la croix, la
 * touche Échap, un toucher en dehors de l'image ou le geste « retour » du
 * téléphone (une entrée d'historique est posée à l'ouverture). On passe d'une
 * image à l'autre du même ensemble (flèches, balayage, ← →), on zoome au
 * pincement ou d'un double toucher. Rien d'autre : pas de bibliothèque.
 */

export type ImageVisionneuse = { id: string; url: string; legende?: string | null };

type Props = {
  images: ImageVisionneuse[];
  index: number;
  onFermer: () => void;
  onIndex?: (index: number) => void;
  /** Boutons propres à l'image courante (retirer, remettre…), rendus dans la barre du bas. */
  actions?: (image: ImageVisionneuse, index: number) => React.ReactNode;
};

type Transformation = { echelle: number; x: number; y: number };
const REPOS: Transformation = { echelle: 1, x: 0, y: 0 };
const ECHELLE_MAX = 5;
const BOUTON = "inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white";

export function Visionneuse({ images, index, onFermer, onIndex, actions }: Props) {
  const image = images[index] ?? images[0];
  const [transformation, setTransformation] = useState<Transformation>(REPOS);
  const [chargee, setChargee] = useState(false);
  const pointeurs = useRef(new Map<number, { x: number; y: number }>());
  const geste = useRef<{ distance: number; echelle: number; centre: { x: number; y: number }; origine: Transformation; depart: { x: number; y: number }; balayage: boolean } | null>(null);
  const dernierToucher = useRef(0);
  const entreePoussee = useRef(false);
  const fermerRef = useRef(onFermer);
  useEffect(() => {
    fermerRef.current = onFermer;
  }, [onFermer]);

  const aller = useCallback(
    (delta: number) => {
      if (images.length < 2) return;
      const suivant = (index + delta + images.length) % images.length;
      setTransformation(REPOS);
      setChargee(false);
      onIndex?.(suivant);
    },
    [images.length, index, onIndex]
  );

  // Le geste « retour » du téléphone ferme la visionneuse au lieu de quitter l'écran :
  // une entrée d'historique est posée à l'ouverture et consommée à la fermeture.
  // (Robuste au double montage du mode strict de React : l'entrée n'est posée qu'une
  // fois, et le retour de nettoyage est différé puis annulé si le composant est remonté.)
  const monte = useRef(false);
  useEffect(() => {
    monte.current = true;
    const etatActuel = window.history.state as { visionneuse?: boolean } | null;
    if (!etatActuel?.visionneuse) window.history.pushState({ visionneuse: true }, "");
    entreePoussee.current = true;
    const surRetour = () => {
      entreePoussee.current = false;
      fermerRef.current();
    };
    window.addEventListener("popstate", surRetour);
    return () => {
      monte.current = false;
      window.removeEventListener("popstate", surRetour);
      window.setTimeout(() => {
        if (!monte.current && entreePoussee.current && (window.history.state as { visionneuse?: boolean } | null)?.visionneuse) {
          entreePoussee.current = false;
          window.history.back();
        }
      }, 0);
    };
  }, []);

  const fermer = useCallback(() => {
    if (entreePoussee.current) {
      // popstate fera le reste (fermeture + nettoyage) ; sans lui, ferme directement.
      const surete = window.setTimeout(() => fermerRef.current(), 250);
      window.addEventListener("popstate", () => window.clearTimeout(surete), { once: true });
      window.history.back();
      return;
    }
    onFermer();
  }, [onFermer]);

  useEffect(() => {
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") fermer();
      else if (evenement.key === "ArrowLeft") aller(-1);
      else if (evenement.key === "ArrowRight") aller(1);
    };
    window.addEventListener("keydown", surTouche);
    const debordement = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", surTouche);
      document.body.style.overflow = debordement;
    };
  }, [aller, fermer]);

  // Les voisines se chargent en avance : le balayage ne montre pas de trou.
  useEffect(() => {
    for (const delta of [-1, 1]) {
      const voisine = images[(index + delta + images.length) % images.length];
      if (voisine && voisine.id !== image?.id) new Image().src = voisine.url;
    }
  }, [images, index, image?.id]);

  const distanceEntre = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const bornee = (t: Transformation): Transformation => {
    const echelle = Math.min(ECHELLE_MAX, Math.max(1, t.echelle));
    if (echelle === 1) return REPOS;
    return { echelle, x: t.x, y: t.y };
  };

  function surPointeurBas(evenement: React.PointerEvent<HTMLDivElement>) {
    (evenement.currentTarget as HTMLDivElement).setPointerCapture(evenement.pointerId);
    pointeurs.current.set(evenement.pointerId, { x: evenement.clientX, y: evenement.clientY });
    const points = [...pointeurs.current.values()];
    if (points.length === 2) {
      geste.current = { distance: distanceEntre(points[0], points[1]), echelle: transformation.echelle, centre: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, origine: transformation, depart: { x: 0, y: 0 }, balayage: false };
    } else if (points.length === 1) {
      geste.current = { distance: 0, echelle: transformation.echelle, centre: points[0], origine: transformation, depart: points[0], balayage: transformation.echelle === 1 };
    }
  }

  function surPointeurBouge(evenement: React.PointerEvent<HTMLDivElement>) {
    if (!pointeurs.current.has(evenement.pointerId) || !geste.current) return;
    pointeurs.current.set(evenement.pointerId, { x: evenement.clientX, y: evenement.clientY });
    const points = [...pointeurs.current.values()];
    const g = geste.current;
    if (points.length >= 2 && g.distance > 0) {
      const distance = distanceEntre(points[0], points[1]);
      const centre = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const echelle = g.echelle * (distance / g.distance);
      setTransformation(bornee({ echelle, x: g.origine.x + (centre.x - g.centre.x), y: g.origine.y + (centre.y - g.centre.y) }));
    } else if (points.length === 1 && g.origine.echelle > 1) {
      setTransformation(bornee({ echelle: g.origine.echelle, x: g.origine.x + (points[0].x - g.depart.x), y: g.origine.y + (points[0].y - g.depart.y) }));
    }
  }

  function surPointeurHaut(evenement: React.PointerEvent<HTMLDivElement>) {
    const depart = geste.current?.depart;
    const balayage = geste.current?.balayage && pointeurs.current.size === 1;
    pointeurs.current.delete(evenement.pointerId);
    if (balayage && depart) {
      const dx = evenement.clientX - depart.x;
      const dy = evenement.clientY - depart.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        aller(dx < 0 ? 1 : -1);
        geste.current = null;
        return;
      }
      // Double toucher : zoom ×2,5 sur le point touché, ou retour à la taille normale.
      const maintenant = Date.now();
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        if (maintenant - dernierToucher.current < 320) {
          setTransformation((t) => (t.echelle > 1 ? REPOS : { echelle: 2.5, x: (window.innerWidth / 2 - evenement.clientX) * 1.5, y: (window.innerHeight / 2 - evenement.clientY) * 1.5 }));
          dernierToucher.current = 0;
        } else dernierToucher.current = maintenant;
      }
    }
    if (pointeurs.current.size === 0) geste.current = null;
    else if (pointeurs.current.size === 1) {
      const [restant] = [...pointeurs.current.values()];
      geste.current = { distance: 0, echelle: transformation.echelle, centre: restant, origine: transformation, depart: restant, balayage: false };
    }
  }

  function surMolette(evenement: React.WheelEvent<HTMLDivElement>) {
    if (!evenement.ctrlKey && !evenement.metaKey) return;
    evenement.preventDefault();
    setTransformation((t) => bornee({ ...t, echelle: t.echelle * (evenement.deltaY < 0 ? 1.15 : 1 / 1.15) }));
  }

  if (!image) return null;
  const legende = image.legende ?? "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={legende ? `${legende} — image ${index + 1} sur ${images.length}` : `Image ${index + 1} sur ${images.length}`}
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 text-white"
      onClick={(evenement) => {
        if (evenement.target === evenement.currentTarget) fermer();
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2" onClick={(evenement) => evenement.target === evenement.currentTarget && fermer()}>
        <p className="min-w-0 truncate text-[13px] text-white/80">
          {images.length > 1 ? <span className="mr-2 tabular-nums">{index + 1} / {images.length}</span> : null}
          {legende}
        </p>
        <button type="button" onClick={fermer} className={BOUTON} aria-label="Fermer">
          <X size={20} aria-hidden />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
        onPointerDown={surPointeurBas}
        onPointerMove={surPointeurBouge}
        onPointerUp={surPointeurHaut}
        onPointerCancel={surPointeurHaut}
        onWheel={surMolette}
        onClick={(evenement) => {
          if (evenement.target === evenement.currentTarget && transformation.echelle === 1) fermer();
        }}
      >
        {!chargee ? (
          <span className="absolute inset-0 flex items-center justify-center text-white/70" aria-live="polite">
            <Loader2 size={26} className="animate-spin" aria-hidden />
            <span className="sr-only">Chargement de l&apos;image</span>
          </span>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- image privée servie derrière la session, taille libre */}
        <img
          key={image.id}
          src={image.url}
          alt={legende || "Image"}
          draggable={false}
          onLoad={() => setChargee(true)}
          onError={() => setChargee(true)}
          className={cn("max-h-full max-w-full select-none object-contain", transformation.echelle === 1 && "transition-transform duration-150")}
          style={{ transform: `translate(${transformation.x}px, ${transformation.y}px) scale(${transformation.echelle})`, transformOrigin: "center", opacity: chargee ? 1 : 0 }}
        />
        {images.length > 1 ? (
          <>
            <button type="button" onClick={() => aller(-1)} className={cn(BOUTON, "absolute top-1/2 left-2 -translate-y-1/2 max-sm:hidden")} aria-label="Image précédente">
              <ChevronLeft size={22} aria-hidden />
            </button>
            <button type="button" onClick={() => aller(1)} className={cn(BOUTON, "absolute top-1/2 right-2 -translate-y-1/2 max-sm:hidden")} aria-label="Image suivante">
              <ChevronRight size={22} aria-hidden />
            </button>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onClick={(evenement) => evenement.target === evenement.currentTarget && fermer()}>
        <a href={image.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-[12.5px] text-white/70 hover:text-white">
          <ExternalLink size={13} aria-hidden />
          Ouvrir l&apos;original
        </a>
        <div className="flex items-center gap-2">
          {images.length > 1 ? (
            <span className="text-[12px] text-white/60 sm:hidden">Balayez pour passer à la suivante</span>
          ) : null}
          {actions ? actions(image, index) : null}
        </div>
      </div>
    </div>
  );
}
