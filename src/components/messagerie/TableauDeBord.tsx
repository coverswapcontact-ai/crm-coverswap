import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { TableauMessagerie } from "@/lib/messagerie/tableau";
import { cn } from "@/lib/utils";
import { TRANS } from "@/components/pilotage/ui";

/**
 * Mission 25 (lot 7) — le tableau de bord de la messagerie, semaine par semaine : ce que les messages produisent (taux
 * de réponse, délai), ce qui en a été fait (préparés, envoyés, reportés, refusés, non confirmés), ce que la garde de
 * silence a retenu et pourquoi, le taux de STOP (alerte au-dessus de 3 %), les devis signés après une relance, le coût
 * de l'IA du mois. Rendu par le serveur ; les chiffres viennent de la base, rien n'est estimé.
 */

const pourcent = (t: number | null) => (t === null ? "—" : `${Math.round(t * 1000) / 10} %`.replace(".", ","));
const heures = (h: number | null) => (h === null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${String(h).replace(".", ",")} h` : `${Math.round(h / 24)} j`);
const semaine = (iso: string) => `sem. du ${new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" })}`;
const euros = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

const CELLULE = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

export function TableauDeBord({ tableau }: { tableau: TableauMessagerie }) {
  const lignes: { libelle: string; valeur: (s: TableauMessagerie["semaines"][number]) => string; alerte?: (s: TableauMessagerie["semaines"][number]) => boolean }[] = [
    { libelle: "Messages préparés", valeur: (s) => String(s.prepares) },
    { libelle: "Envoyés", valeur: (s) => String(s.envoyes) },
    { libelle: "Reportés (Plus tard)", valeur: (s) => String(s.reportes) },
    { libelle: "Refusés (Ne pas envoyer)", valeur: (s) => String(s.refuses) },
    { libelle: "Non confirmés à 19 h 30", valeur: (s) => String(s.nonConfirmes) },
    { libelle: "Taux de réponse (7 jours)", valeur: (s) => `${pourcent(s.reponses.taux)} (${s.reponses.repondus}/${s.reponses.envoyes})` },
    { libelle: "Délai moyen de réponse", valeur: (s) => heures(s.reponses.delaiMoyenHeures) },
    { libelle: "STOP", valeur: (s) => `${s.stop.nombre} · ${pourcent(s.stop.taux)}`, alerte: (s) => s.stop.taux !== null && s.stop.taux > 0.03 },
    { libelle: "Devis signés après une relance", valeur: (s) => String(s.signesApresRelance) },
  ];
  const retenues = [...new Set(tableau.semaines.flatMap((s) => s.retenues.map((r) => r.motif)))];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 md:px-8">
      <Link href="/messagerie" className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-[14px] text-texte-2 hover:text-texte", TRANS)}>
        <ArrowLeft size={16} aria-hidden /> Messagerie
      </Link>
      <h1 className="mt-1 text-[22px] font-semibold text-texte">Tableau de bord de la messagerie</h1>
      <p className="mt-1 text-[14px] text-texte-3">Les quatre dernières semaines, la semaine en cours d&apos;abord. Une réponse = le client a écrit (SMS, espace, mail) dans les 7 jours qui suivent l&apos;envoi.</p>
      {tableau.alerteStop ? <p className="mt-3 rounded-[12px] border-[0.5px] border-retard/40 bg-surface p-3 text-[14px] text-retard-texte">La semaine passée, plus de 3 % des clients contactés ont répondu STOP : regarde quels messages les déclenchent.</p> : null}

      <section className="mt-5 overflow-x-auto rounded-[12px] border-[0.5px] border-trait bg-surface">
        <table className="w-full min-w-[560px] text-[13.5px]">
          <thead className="border-b-[0.5px] border-trait text-[12px] text-texte-3">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Semaine</th>
              {tableau.semaines.map((s) => (
                <th key={s.debut} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {semaine(s.debut)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.libelle} className="border-t-[0.5px] border-trait first:border-t-0">
                <th scope="row" className="px-3 py-2 text-left font-normal text-texte-2">
                  {l.libelle}
                </th>
                {tableau.semaines.map((s) => (
                  <td key={s.debut} className={cn(CELLULE, l.alerte?.(s) ? "font-medium text-retard-texte" : "text-texte")}>
                    {l.valeur(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <h2 className="mt-7 text-[16px] font-semibold text-texte">Relances retenues par la garde de silence</h2>
      {retenues.length ? (
        <section className="mt-2 overflow-x-auto rounded-[12px] border-[0.5px] border-trait bg-surface">
          <table className="w-full min-w-[560px] text-[13.5px]">
            <tbody>
              {retenues.map((motif) => (
                <tr key={motif} className="border-t-[0.5px] border-trait first:border-t-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-texte-2">
                    {motif}
                  </th>
                  {tableau.semaines.map((s) => (
                    <td key={s.debut} className={cn(CELLULE, "text-texte")}>
                      {s.retenues.find((r) => r.motif === motif)?.nombre ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="mt-2 text-[14px] text-texte-3">Aucune relance retenue sur ces quatre semaines.</p>
      )}

      <h2 className="mt-7 text-[16px] font-semibold text-texte">Taux de réponse par message</h2>
      {tableau.parMessage.length ? (
        <section className="mt-2 overflow-x-auto rounded-[12px] border-[0.5px] border-trait bg-surface">
          <table className="w-full min-w-[480px] text-[13.5px]">
            <thead className="border-b-[0.5px] border-trait text-[12px] text-texte-3">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Message</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Envoyés</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Réponses</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Délai moyen</th>
              </tr>
            </thead>
            <tbody>
              {tableau.parMessage.map((m) => (
                <tr key={m.code} className="border-t-[0.5px] border-trait first:border-t-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-texte-2">
                    {m.libelle}
                  </th>
                  <td className={cn(CELLULE, "text-texte")}>{m.envoyes}</td>
                  <td className={cn(CELLULE, "text-texte")}>
                    {pourcent(m.taux)} ({m.repondus})
                  </td>
                  <td className={cn(CELLULE, "text-texte")}>{heures(m.delaiMoyenHeures)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="mt-2 text-[14px] text-texte-3">Aucun message envoyé sur ces quatre semaines.</p>
      )}

      <p className="mt-7 text-[14px] text-texte-2">
        IA de la messagerie ce mois-ci : <span className="font-medium text-texte tabular-nums">{euros(tableau.coutIaMois)}</span> sur {euros(tableau.budgetIa)} de plafond.
      </p>
    </div>
  );
}
