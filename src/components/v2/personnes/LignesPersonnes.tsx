"use client";

import Link from "next/link";
import { ChevronRight, Phone, PhoneOff } from "lucide-react";
import type { Candidat } from "@/lib/assistant/recherche";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import type { ClientResume } from "@/lib/clients/types";
import type { LigneLead } from "@/lib/prospects/leads";
import { etatLead, phraseDossiersClient, phraseResultat } from "@/lib/v2/personnes";
import { situationDeCandidat } from "@/lib/v2/situation";
import { cn } from "@/lib/utils";
import { LIGNE_V2 } from "../liste/Troncature";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A4) — les lignes de Personnes v2, toutes au même dessin (deux tailles de texte, 44 px, aucun badge) :
 *  - un lead : le nom, « ville, état en phrase » (`lib/v2/personnes.ts › etatLead`), et le bouton « Appeler » (lien
 *    `tel:` ; vert sur la première ligne seulement, le contact le plus urgent, en contour ensuite — correctifs du
 *    07/10, É8 ; le début d'appel est noté, la feuille de fin d'appel revient comme en v1) ; toucher la ligne ouvre
 *    la fiche (`PanneauEntrant`) ;
 *  - un client : le nom, « ville, 2 dossiers, 1 en cours », vers sa fiche `/clients/<id>` (la v1) ;
 *  - un résultat de recherche : un dossier au format de situation de la v2 (trois lignes, `situationDeCandidat`) ; un
 *    contact ou un client : le nom et « Contact — ville, état », vers son chemin (un contact s'ouvre sur place).
 */
const LIGNE = cn("flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 px-4 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", TRANS_V2);
const NOM = "truncate text-corps-tel font-medium text-texte md:text-corps";
const SOUS = "line-clamp-2 text-petit leading-snug break-words text-texte-3";
// A6 : le bouton porte son mot (« Appeler »), pas seulement le pictogramme (règle 4), comme la ligne de Dossiers.
const APPELER = cn("mr-2 inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[8px] bg-action px-4 text-corps font-semibold text-action-texte hover:bg-action-clair focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS_V2);
const APPELER_CONTOUR = cn("mr-2 inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-trait-2 bg-surface px-4 text-corps font-medium text-texte hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS_V2);

export function LigneLeadV2({ lead, maintenant, principal = false, onOuvrir }: { lead: LigneLead; maintenant: Date; /** La première ligne de la liste : le seul « Appeler » vert. */ principal?: boolean; onOuvrir: (id: string) => void }) {
  const sous = [lead.ville, etatLead(lead, maintenant)].filter(Boolean).join(", ");
  return (
    <li data-lead={lead.id} className={cn(LIGNE_V2, "flex items-center")}>
      <button type="button" onClick={() => onOuvrir(lead.id)} aria-label={`Ouvrir la fiche : ${lead.nom}`} className={LIGNE}>
        <span className={NOM}>{lead.nom}</span>
        <span className={SOUS}>{sous}</span>
      </button>
      {lead.archiveLe ? null : lead.telephoneLien ? (
        <a href={lead.telephoneLien} onClick={() => noterDebutAppel(lead.id, { nom: lead.nom, dossierId: lead.dossierId })} aria-label={`Appeler ${lead.nom}`} title={lead.telephone ?? undefined} className={principal ? APPELER : APPELER_CONTOUR}>
          <Phone size={18} aria-hidden />
          Appeler
        </a>
      ) : (
        <span className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-texte-3" title="Pas de numéro">
          <PhoneOff size={18} aria-hidden />
        </span>
      )}
    </li>
  );
}

export function LigneClientV2({ client }: { client: ClientResume }) {
  const sous = [client.ville, phraseDossiersClient(client.nbDossiers, client.nbDossiersEnCours), client.archiveLe ? "fiche archivée" : null].filter(Boolean).join(", ");
  return (
    <li data-client={client.id} className={cn(LIGNE_V2, "flex items-center")}>
      <Link href={`/clients/${client.id}`} className={LIGNE}>
        <span className={NOM}>{client.nom}</span>
        <span className={SOUS}>{sous}</span>
      </Link>
      <ChevronRight size={18} aria-hidden className="mr-4 shrink-0 text-texte-3" />
    </li>
  );
}

export function LigneResultatV2({ candidat, maintenant, onOuvrirLead }: { candidat: Candidat; maintenant: Date; onOuvrirLead: (id: string) => void }) {
  // Correctifs du 07/10 (É10) : un dossier se lit au format de situation de la v2 ; les autres gardent leur phrase courte.
  const situation = situationDeCandidat(candidat, maintenant);
  const contenu = situation ? (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className={NOM}>{situation.quiQuoi}</span>
        <span className="shrink-0 text-petit text-texte-3">{situation.etape}</span>
      </span>
      <span className="line-clamp-2 text-corps-tel leading-snug break-words text-texte-2 md:text-corps">{situation.situation}</span>
      <span className="truncate text-petit text-texte-3">{situation.prochaineAction}</span>
    </>
  ) : (
    <>
      <span className={NOM}>{candidat.nom}</span>
      <span className={SOUS}>{phraseResultat(candidat)}</span>
    </>
  );
  return (
    <li className={cn(LIGNE_V2, "flex items-center")}>
      {candidat.type === "LEAD" && candidat.leadId ? (
        <button type="button" onClick={() => onOuvrirLead(candidat.leadId as string)} className={LIGNE}>
          {contenu}
        </button>
      ) : (
        <Link href={candidat.chemin} className={LIGNE}>
          {contenu}
        </Link>
      )}
      <ChevronRight size={18} aria-hidden className="mr-4 shrink-0 text-texte-3" />
    </li>
  );
}
