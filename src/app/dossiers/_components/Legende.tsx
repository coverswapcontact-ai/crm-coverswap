"use client";

import { ArrowRight, X } from "lucide-react";
import { ETAPES_ACTIVES, ETAPES_SORTIE, LIBELLES_ETAPE } from "@/lib/dossiers/constants";
import { PastilleRetard } from "./CarteDossier";
import { BadgeMain, BarreProgression } from "./Indicateurs";
import { Bouton, PastilleEtape } from "./ui";

function Rubrique({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-medium text-[#F2F3F5]">{titre}</h3>
      <div className="space-y-2 text-[12px] leading-relaxed text-[#9CA3AF]">{children}</div>
    </div>
  );
}

function Ligne({ repere, children }: { repere: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5">
      <span className="flex min-w-[92px] shrink-0 items-center pt-px">{repere}</span>
      <span>{children}</span>
    </p>
  );
}

/** Légende repliable de l'écran /dossiers. */
export function Legende({ onFermer }: { onFermer: () => void }) {
  return (
    <section
      id="legende-dossiers"
      aria-label="Légende"
      className="mt-3 rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">Légende</h2>
        <Bouton variante="fantome" taille="icone" aria-label="Fermer la légende" onClick={onFermer} className="-mt-1 -mr-2">
          <X size={15} />
        </Bouton>
      </div>

      <div className="mt-3 grid gap-5 lg:grid-cols-2">
        <Rubrique titre="Couleur des étapes">
          <p>Du froid au chaud à mesure qu&apos;on approche de l&apos;encaissement, l&apos;objectif.</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {ETAPES_ACTIVES.map((etape, index) => (
              <span key={etape} className="flex items-center gap-1.5">
                <PastilleEtape etape={etape} libelle={LIBELLES_ETAPE[etape]} />
                {index < ETAPES_ACTIVES.length - 1 ? <ArrowRight size={11} className="text-[#4B5160]" aria-hidden /> : null}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Hors parcours, en gris :</span>
            {ETAPES_SORTIE.map((etape) => (
              <PastilleEtape key={etape} etape={etape} libelle={LIBELLES_ETAPE[etape]} />
            ))}
          </div>
        </Rubrique>

        <Rubrique titre="Qui a la main">
          <Ligne repere={<BadgeMain main="MOI" />}>
            Une action de ma part est attendue. Liseré blanc à gauche de la carte.
          </Ligne>
          <Ligne repere={<BadgeMain main="CLIENT" />}>Le dossier est entre les mains du client.</Ligne>
          <Ligne repere={<BadgeMain main="A_RELANCER" />}>
            J&apos;attends le client mais la prochaine action est dépassée : à moi de relancer.
          </Ligne>
          <p>Le filtre « À faire » ne garde que les dossiers où j&apos;ai la main, retards compris.</p>
        </Rubrique>

        <Rubrique titre="Retard">
          <Ligne repere={<PastilleRetard className="ml-1" />}>
            Prochaine action dépassée. Liseré rouge : le dossier est prioritaire dans tous les cas, même quand
            j&apos;attends le client, et il figure toujours dans « À faire ».
          </Ligne>
        </Rubrique>

        <Rubrique titre="Progression">
          <BarreProgression etape="RELANCE" etapeAvantSortie={null} className="max-w-[320px]" />
          <p>
            Une barre par étape, pleine à l&apos;encaissement. L&apos;écart avant l&apos;avant-dernier segment marque
            la facturation. Dossier perdu ou en pause : barre grise, arrêtée à l&apos;étape quittée.
          </p>
        </Rubrique>
      </div>
    </section>
  );
}
