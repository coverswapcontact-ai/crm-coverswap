"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Mail, MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Mission 25 (lot 6) — les boutons ronds d'un contact : 📞 Appeler (l'appel est noté, la carte « Qu'est-ce qui s'est
 * dit ? » attend au retour) · 💬 SMS (ouvre Messages sur le numéro) · ✉️ Copier le mail · 📋 Copier le numéro (fiche
 * seulement). Une copie affiche « Copié ✅ ». En tête de la fiche dossier (avec un mot sous chaque bouton) et sur chaque
 * ligne des listes Leads et Dossiers (les trois premiers, sans mot).
 */

/** « 06 12 34 56 78 » → « 0612345678 » ; « +33 6… » garde son « + ». Vide si illisible. */
export const numeroComposable = (telephone: string | null | undefined) => (telephone ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");

async function copier(texte: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    // Safari sans permission, page non sécurisée : la vieille méthode.
    try {
      const zone = document.createElement("textarea");
      zone.value = texte;
      zone.setAttribute("readonly", "");
      zone.style.position = "fixed";
      zone.style.opacity = "0";
      document.body.appendChild(zone);
      zone.select();
      const ok = document.execCommand("copy");
      zone.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

type Props = {
  nom: string;
  telephone: string | null | undefined;
  email: string | null | undefined;
  /** Le lead (fiche de lead) ou le dossier : l'appel noté s'y rattache. */
  leadId?: string | null;
  dossierId?: string | null;
  /** « fiche » : quatre boutons de 48 px, un mot dessous ; « ligne » : trois boutons de 44 px, sans mot. */
  variante?: "fiche" | "ligne";
  /** Le bouton d'appel en couleur d'action (à appeler, rappel en retard). */
  appelPrioritaire?: boolean;
  className?: string;
};

export function BoutonsContact({ nom, telephone, email, leadId = null, dossierId = null, variante = "fiche", appelPrioritaire = false, className }: Props) {
  const [copie, setCopie] = useState<"mail" | "numero" | null>(null);
  useEffect(() => {
    if (!copie) return;
    const id = window.setTimeout(() => setCopie(null), 1600);
    return () => window.clearTimeout(id);
  }, [copie]);
  const numero = numeroComposable(telephone);
  const fiche = variante === "fiche";

  async function copierCe(quoi: "mail" | "numero") {
    const texte = quoi === "mail" ? (email ?? "") : (telephone ?? "");
    if (!texte) return;
    if (await copier(texte)) setCopie(quoi);
    else toast.error("Copie impossible : sélectionne le texte à la main.", { description: texte });
  }

  const rond = cn("flex shrink-0 items-center justify-center rounded-full border-[0.5px] border-trait bg-surface-2 text-texte hover:border-trait-2 disabled:cursor-not-allowed disabled:opacity-40", fiche ? "h-12 w-12" : "h-11 w-11", TRANS);
  // Sur la fiche, un mot sous chaque bouton ; sur une ligne, le bouton seul (une fonction, pas un composant : rien ne se remonte).
  const bloc = (cle: string, bouton: ReactNode, mot: string) =>
    fiche ? (
      <div key={cle} className="flex w-14 flex-col items-center">
        {bouton}
        <span className="mt-1 text-[11.5px] leading-none text-texte-3">{mot}</span>
      </div>
    ) : (
      <Fragment key={cle}>{bouton}</Fragment>
    );

  return (
    <div className={cn("flex items-start", fiche ? "gap-3" : "gap-1.5", className)}>
      {bloc(
        "appel",
        numero ? (
          <a
            href={`tel:${numero}`}
            onClick={() => noterDebutAppel(leadId ?? (dossierId ? `dossier:${dossierId}` : numero), { nom, dossierId })}
            aria-label={`Appeler ${nom}`}
            title={telephone ?? undefined}
            className={cn(rond, appelPrioritaire && "border-transparent bg-action text-action-texte hover:bg-action-clair")}
          >
            <Phone size={fiche ? 20 : 18} aria-hidden />
          </a>
        ) : (
          <button type="button" disabled aria-label="Pas de numéro" className={rond}>
            <Phone size={fiche ? 20 : 18} aria-hidden />
          </button>
        ),
        "Appeler"
      )}
      {bloc(
        "sms",
        numero ? (
          <a href={`sms:${numero}`} aria-label={`Ouvrir Messages pour ${nom}`} className={rond}>
            <MessageSquare size={fiche ? 20 : 18} aria-hidden />
          </a>
        ) : (
          <button type="button" disabled aria-label="Pas de numéro" className={rond}>
            <MessageSquare size={fiche ? 20 : 18} aria-hidden />
          </button>
        ),
        "SMS"
      )}
      {bloc(
        "mail",
        <button type="button" disabled={!email} onClick={() => void copierCe("mail")} aria-label={email ? `Copier le mail de ${nom}` : "Pas d'e-mail"} title={email ?? undefined} className={cn(rond, copie === "mail" && "border-action/60 text-action-clair")}>
          {copie === "mail" ? <Check size={fiche ? 20 : 18} aria-hidden /> : <Mail size={fiche ? 20 : 18} aria-hidden />}
        </button>,
        copie === "mail" ? "Copié ✅" : "Mail"
      )}
      {fiche
        ? bloc(
            "numero",
            <button type="button" disabled={!telephone} onClick={() => void copierCe("numero")} aria-label={telephone ? `Copier le numéro de ${nom}` : "Pas de numéro"} className={cn(rond, copie === "numero" && "border-action/60 text-action-clair")}>
              {copie === "numero" ? <Check size={20} aria-hidden /> : <Copy size={20} aria-hidden />}
            </button>,
            copie === "numero" ? "Copié ✅" : "Numéro"
          )
        : null}
      {!fiche && copie ? (
        <span role="status" className="self-center text-[12px] whitespace-nowrap text-action-clair">
          Copié ✅
        </span>
      ) : null}
    </div>
  );
}
