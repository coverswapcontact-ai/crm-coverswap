"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Bouton de suppression avec confirmation inline (2 clics).
 * 1er clic → passe en mode "Confirmer ?" (rouge, pulsant)
 * 2e clic → envoie DELETE à `url`
 * Clic hors zone → annule la confirmation
 *
 * Usage :
 *   <DeleteRowButton
 *     url={`/api/devis/${devisId}`}
 *     entityLabel="devis"
 *     onDeleted={() => router.refresh()}
 *   />
 */
export default function DeleteRowButton({
  url,
  entityLabel = "ligne",
  className,
  size = "sm",
  onDeleted,
  disabled = false,
  method = "DELETE",
  body,
}: {
  url: string;
  entityLabel?: string;
  className?: string;
  size?: "sm" | "md";
  onDeleted?: () => void;
  disabled?: boolean;
  method?: "DELETE" | "POST";
  body?: unknown;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside → cancel confirmation
  useEffect(() => {
    if (!confirming) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [confirming]);

  // Auto-cancel after 4s
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!confirming) {
      setConfirming(true);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      toast.success(`${capitalize(entityLabel)} supprime`);
      setConfirming(false);
      if (onDeleted) onDeleted();
      else router.refresh();
    } catch (err) {
      console.error("Delete error:", err);
      toast.error(`Erreur suppression ${entityLabel}`);
    } finally {
      setLoading(false);
    }
  }

  const dims = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const iconDims = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div ref={containerRef} className="inline-flex">
      <button
        type="button"
        onClick={handleDelete}
        disabled={disabled || loading}
        title={confirming ? `Confirmer suppression ${entityLabel}` : `Supprimer ${entityLabel}`}
        className={cn(
          "inline-flex items-center justify-center rounded-lg transition-all",
          dims,
          confirming
            ? "bg-red-500 text-white hover:bg-red-600 animate-pulse px-2 gap-1 w-auto"
            : "text-gray-400 hover:text-red-500 hover:bg-red-50",
          disabled && "opacity-40 cursor-not-allowed",
          className
        )}
      >
        {loading ? (
          <Loader2 className={cn(iconDims, "animate-spin")} />
        ) : confirming ? (
          <>
            <Check className={iconDims} />
            <span className="text-[11px] font-semibold">Confirmer</span>
          </>
        ) : (
          <Trash2 className={iconDims} />
        )}
      </button>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
