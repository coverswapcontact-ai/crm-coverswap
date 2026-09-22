"use client";

import Link from "next/link";
import { ExternalLink, FolderOpen, Phone, StickyNote } from "lucide-react";
import { BadgeMain } from "@/app/(pilotage)/dossiers/_components/Indicateurs";
import type { ContexteClient as Contexte } from "@/lib/mail/contexte";
import { cn } from "@/lib/utils";

/**
 * Le client à côté du mail : sa fiche, chaque projet (étape, qui a la main,
 * devis et paiement, simulations, espace), la dernière note d'appel. Une
 * colonne sur ordinateur, un volet sur téléphone.
 */

const euros = (montant: number) => `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

function Ligne({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <span className="shrink-0 text-[#8B919C]">{libelle}</span>
      <span className="min-w-0 text-right text-[#E5E7EB]">{children}</span>
    </div>
  );
}

export function ContexteClient({ contexte, className }: { contexte: Contexte; className?: string }) {
  const { contact } = contexte;
  const lienFiche = contact.clientId ? `/clients/${contact.clientId}` : contact.leadId ? `/leads?lead=${contact.leadId}` : null;
  return (
    <section aria-label="Contexte du client" className={cn("space-y-4", className)}>
      <div>
        <p className="text-[11px] font-medium tracking-wide text-[#8B919C] uppercase">{contact.type === "CLIENT" ? "Client" : "Lead"}</p>
        <p className="mt-0.5 text-[16px] font-medium text-[#F2F3F5]">{contact.nom}</p>
        <p className="mt-0.5 text-[12.5px] text-[#9CA3AF]">{[contact.ville, contact.source].filter(Boolean).join(" · ") || "—"}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {contact.telephone ? (
            <a href={`tel:${contact.telephone.replace(/\s/g, "")}`} className="inline-flex h-9 items-center gap-1.5 rounded-full border-[0.5px] border-[#2A2D34] px-3 text-[12.5px] text-[#D1D5DB] hover:border-[#3A3E47]">
              <Phone size={12} aria-hidden /> {contact.telephone}
            </a>
          ) : null}
          {lienFiche ? (
            <Link href={lienFiche} className="inline-flex h-9 items-center gap-1.5 rounded-full border-[0.5px] border-[#2A2D34] px-3 text-[12.5px] text-[#D1D5DB] hover:border-[#3A3E47]">
              <ExternalLink size={12} aria-hidden /> Fiche
            </Link>
          ) : null}
        </div>
      </div>

      {contexte.projets.length === 0 ? <p className="text-[12.5px] text-[#8B919C]">Pas encore de projet (dossier) ouvert.</p> : null}
      {contexte.projets.map((p) => (
        <div key={p.dossierId} className="space-y-1.5 rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-[13.5px] font-medium text-[#F2F3F5]">{p.nom}</p>
            <BadgeMain main={p.main} motif={p.mainMotif} />
          </div>
          <Ligne libelle="Étape">{p.etapeLibelle}</Ligne>
          {p.mainMotif ? <p className="text-[12px] text-[#9CA3AF]">{p.mainMotif}</p> : null}
          {p.prochaineAction ? <Ligne libelle="Prochaine action">{p.prochaineAction}{p.prochaineActionDate ? ` · ${jour(p.prochaineActionDate)}` : ""}</Ligne> : null}
          {p.devis ? (
            <Ligne libelle="Devis">
              {p.devis.numero} · {euros(p.devis.totalTtc)} {p.devis.signeLe ? `· signé le ${jour(p.devis.signeLe)}` : `· lu ${p.devis.consultations} fois`}
            </Ligne>
          ) : null}
          {p.paiement ? (
            <Ligne libelle="Paiement">
              {p.paiement.regle ? "Réglé" : `${euros(p.paiement.recu)} reçus · reste ${euros(p.paiement.reste)}`}
              {p.paiement.acompte !== null && !p.paiement.regle ? ` · acompte ${p.paiement.acompteRecu ? "payé" : "attendu"}` : ""}
            </Ligne>
          ) : null}
          <Ligne libelle="Simulations">
            {p.simulations.publiees} publiée{p.simulations.publiees > 1 ? "s" : ""}
            {p.simulations.faitesParLeClient ? ` · ${p.simulations.faitesParLeClient} par le client` : ""}
          </Ligne>
          {p.simulations.choisie ? <p className="text-[12px] text-[#5DCAA5]">Choisie : {p.simulations.choisie}</p> : null}
          {p.espace ? (
            <Ligne libelle="Espace">
              {p.espace.etat}
              {p.espace.derniereVisite ? ` · vu le ${jour(p.espace.derniereVisite)}` : " · jamais ouvert"}
            </Ligne>
          ) : (
            <Ligne libelle="Espace">pas encore ouvert</Ligne>
          )}
          {p.dateChantier ? <Ligne libelle="Chantier">{jour(p.dateChantier)}</Ligne> : null}
          <Link href={`/dossiers?dossier=${p.dossierId}`} className="mt-1 inline-flex h-9 items-center gap-1.5 text-[12.5px] text-[#5DCAA5] hover:underline">
            <FolderOpen size={13} aria-hidden /> Ouvrir le dossier
          </Link>
        </div>
      ))}

      {contexte.derniereNoteAppel ? (
        <div className="rounded-[11px] border-[0.5px] border-[#2A2D34] p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#9CA3AF]">
            <StickyNote size={12} aria-hidden /> Dernière note d&apos;appel · {jour(contexte.derniereNoteAppel.le)}
          </p>
          {contexte.derniereNoteAppel.texte ? <p className="mt-1 text-[13px] whitespace-pre-wrap text-[#E5E7EB]">{contexte.derniereNoteAppel.texte}</p> : null}
          {contexte.derniereNoteAppel.etiquettes.length || contexte.derniereNoteAppel.issue ? (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {[contexte.derniereNoteAppel.issue, ...contexte.derniereNoteAppel.etiquettes].filter(Boolean).map((e) => (
                <span key={e} className="rounded-full border-[0.5px] border-[#2A2D34] px-2 py-0.5 text-[11px] text-[#B4BAC4]">
                  {e}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
