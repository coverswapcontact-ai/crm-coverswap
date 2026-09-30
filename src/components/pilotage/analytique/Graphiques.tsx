"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { Courbe, Format, Serie } from "@/lib/analytique/types";
import { cn } from "@/lib/utils";
import { formaterValeur, jourAxe, jourLongSemaine } from "./format";

/**
 * Mission 17 (partie B) — les courbes dans le temps (recharts) : une ligne par série, une aire discrète sous la
 * première (maquette : Meta), quadrillage pointillé, axes lisibles, infobulle à la valeur exacte (jour de la semaine
 * calculé, jamais recopié). Deux grandeurs d'unités différentes (dépense en euros et leads, clics et position) ne
 * partagent jamais un axe : `separer` trace une petite courbe par série.
 */

const AXE = {
  fill: "#6B7280",
  fontSize: 11,
  fontFamily: "var(--font-sans), Inter, sans-serif",
} as const;

/** Format d'une série d'après sa clé (le contrat ne le porte pas) : euros pour une dépense, position pour une position. */
export function formatDeSerie(cle: string, formats?: Record<string, Format>): Format {
  if (formats?.[cle]) return formats[cle];
  if (/depense|cout|encaiss|montant|euros|budget/i.test(cle)) return "euros";
  if (/position/i.test(cle)) return "position";
  if (/ctr|taux/i.test(cle)) return "pourcent";
  return "nombre";
}

/** Les graduations de l'axe Y, courtes : « 1 234 », « 20 € », « 12 % ». */
function graduation(valeur: number, format: Format): string {
  if (format === "euros")
    return formaterValeur(valeur, "euros", {
      decimales: Math.abs(valeur) < 10 && !Number.isInteger(valeur) ? 1 : 0,
    });
  if (format === "pourcent") return formaterValeur(valeur, "pourcent", { decimales: 0 });
  if (format === "position") return formaterValeur(valeur, "decimal", { decimales: 1 });
  return formaterValeur(valeur, "nombre");
}

/** La largeur de l'axe Y d'après sa plus longue graduation (« 3 500 € » ne se coupe pas). */
function largeurAxe(lignes: Ligne[], series: Serie[], format: Format): number {
  const max = Math.max(0, ...lignes.flatMap((l) => series.map((s) => Math.abs(Number(l[s.cle] ?? 0)))));
  return Math.max(28, Math.round(graduation(max, format).length * 6.6) + 10);
}

/** Libellés courts de la légende au téléphone (maquette : « Meta », « Site »), par clé de série. */
export const LIBELLES_COURTS_SERIE: Record<string, string> = {
  meta: "Meta",
  "google-ads": "Google Ads",
  seo: "SEO",
  "fiche-google": "Fiche",
  ia: "IA",
  reseaux: "Réseaux",
  direct: "Direct",
  autre: "Autres",
};

function Legende({ series, compact }: { series: Serie[]; compact?: boolean }) {
  return (
    <ul className={cn("flex flex-wrap items-center text-[#D1D5DB]", compact ? "gap-x-4 gap-y-1 text-[12px]" : "gap-x-[18px] gap-y-1 text-[13px]")}>
      {series.map((serie, index) => (
        <li key={serie.cle} className="flex items-center gap-[7px]">
          <span
            className={cn("h-[3px] rounded-[2px]", compact ? "w-3" : "w-3.5")}
            style={
              index >= 2
                ? {
                    backgroundImage: `repeating-linear-gradient(90deg, ${serie.couleur} 0 4px, transparent 4px 7px)`,
                  }
                : { background: serie.couleur }
            }
            aria-hidden
          />
          {compact ? (LIBELLES_COURTS_SERIE[serie.cle] ?? serie.libelle) : serie.libelle}
        </li>
      ))}
    </ul>
  );
}

type Ligne = { jour: string } & Record<string, number | string>;

function Bulle({
  active,
  label,
  lignes,
  series,
  formats,
}: Pick<TooltipContentProps, "active" | "label"> & {
  lignes: Ligne[];
  series: Serie[];
  formats: Record<string, Format>;
}) {
  if (!active || label === undefined) return null;
  const ligne = lignes.find((l) => l.jour === String(label));
  if (!ligne) return null;
  const valeurs = series.map((serie) => ({
    serie,
    valeur: Number(ligne[serie.cle] ?? 0),
  }));
  const nonNulles = valeurs.filter((v) => v.valeur !== 0);
  const texte = (v: { serie: Serie; valeur: number }) =>
    formaterValeur(v.valeur, formats[v.serie.cle] ?? "nombre", {
      decimales: formats[v.serie.cle] === "euros" ? 2 : undefined,
    });
  return (
    <div className="rounded-[8px] border border-[#3A3E47] bg-[#22262D] px-3 py-2 shadow-none" role="status">
      <p className="text-[11px] text-[#9CA3AF]">{jourLongSemaine(String(label))}</p>
      {series.length === 1 ? (
        <p className="mt-1 text-[13px] text-[#F2F3F5]">{texte(valeurs[0])}</p>
      ) : series.length <= 3 ? (
        <p className="mt-1 text-[13px] whitespace-nowrap text-[#F2F3F5]">{nonNulles.length === 0 ? "Aucun" : nonNulles.map((v) => `${texte(v)} ${v.serie.libelle}`).join(" · ")}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5 text-[13px]">
          {valeurs.map((v) => (
            <li key={v.serie.cle} className="flex items-center gap-2 whitespace-nowrap">
              <span className="h-[3px] w-3 rounded-[2px]" style={{ background: v.serie.couleur }} aria-hidden />
              <span className="font-heading tabular-nums text-[#F2F3F5]">{texte(v)}</span>
              <span className="text-[#9CA3AF]">{v.serie.libelle}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Trace({ lignes, series, formats, hauteur, compact, aire }: { lignes: Ligne[]; series: Serie[]; formats: Record<string, Format>; hauteur: number; compact: boolean; aire: boolean }) {
  const format = formats[series[0]?.cle] ?? "nombre";
  const inverse = series.length === 1 && format === "position";
  const ticks = compact && lignes.length > 2 ? [lignes[0].jour, lignes[Math.floor((lignes.length - 1) / 2)].jour, lignes[lignes.length - 1].jour] : undefined;
  const resume = series.map((serie) => `${serie.libelle} : ${lignes.map((l) => formaterValeur(Number(l[serie.cle] ?? 0), formats[serie.cle] ?? "nombre")).join(", ")}`).join(" ; ");
  return (
    <div className="w-full" role="img" aria-label={`Courbe par jour, du ${lignes[0]?.jour ?? ""} au ${lignes[lignes.length - 1]?.jour ?? ""}. ${resume}`}>
      <div style={{ height: hauteur }}>
        <ComposedChart
          responsive
          data={lignes}
          style={{ width: "100%", height: hauteur }}
          margin={{
            top: 8,
            right: compact ? 2 : 8,
            bottom: 0,
            left: compact ? 2 : 0,
          }}
        >
          <CartesianGrid vertical={false} stroke="#2A2D34" strokeDasharray={compact ? "6 10" : "3 5"} />
          <ReferenceLine y={inverse ? undefined : 0} stroke="#2A2D34" ifOverflow="extendDomain" />
          <XAxis
            hide={compact}
            dataKey="jour"
            tickFormatter={jourAxe}
            tick={AXE}
            axisLine={false}
            tickLine={false}
            ticks={ticks}
            interval={ticks ? 0 : lignes.length <= 12 ? 0 : "preserveStartEnd"}
            minTickGap={compact ? 8 : 20}
            tickMargin={10}
            padding={{ left: compact ? 0 : 12, right: compact ? 0 : 12 }}
          />
          <YAxis
            hide={compact}
            width={largeurAxe(lignes, series, format)}
            tick={AXE}
            axisLine={false}
            tickLine={false}
            tickCount={4}
            allowDecimals={format !== "nombre"}
            reversed={inverse}
            domain={inverse ? ["dataMin - 0.5", "dataMax + 0.5"] : [0, "auto"]}
            tickFormatter={(valeur: number) => graduation(valeur, format)}
          />
          <Tooltip
            cursor={{ stroke: "#3A3E47", strokeWidth: 1 }}
            isAnimationActive={false}
            content={(props: TooltipContentProps) => <Bulle active={props.active} label={props.label} lignes={lignes} series={series} formats={formats} />}
            wrapperStyle={{ outline: "none", zIndex: 10 }}
          />
          {aire && series[0] ? (
            <Area type="linear" dataKey={series[0].cle} stroke="none" fill={series[0].couleur} fillOpacity={compact ? 0.12 : 0.1} isAnimationActive={false} activeDot={false} tooltipType="none" />
          ) : null}
          {series.map((serie, index) => (
            <Line
              key={serie.cle}
              type="linear"
              dataKey={serie.cle}
              name={serie.libelle}
              stroke={serie.couleur}
              strokeWidth={index === 0 ? 2.2 : index === 1 ? 2 : 1.6}
              strokeDasharray={index >= 2 ? "4 4" : undefined}
              strokeLinejoin="round"
              dot={false}
              activeDot={{
                r: 4.5,
                fill: "#16181D",
                stroke: serie.couleur,
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </div>
      {/* Téléphone : trois dates sous la courbe (début, milieu, fin), comme la maquette ; jamais coupées au bord. */}
      {ticks ? (
        <div className="mt-1.5 flex justify-between text-[11px] text-[#6B7280]" aria-hidden>
          {ticks.map((jour) => (
            <span key={jour}>{jourAxe(jour)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CourbeTemps({
  courbe,
  hauteur = 260,
  compact = false,
  formats,
  separer = false,
  aire = true,
  legende = true,
  seriesMasquees = [],
}: {
  courbe: Courbe;
  hauteur?: number;
  compact?: boolean;
  formats?: Record<string, Format>;
  separer?: boolean;
  aire?: boolean;
  legende?: boolean;
  /** Séries non tracées (téléphone : la maquette ne garde que Meta et Site). */
  seriesMasquees?: string[];
}) {
  const series = courbe.series.filter((serie) => !seriesMasquees.includes(serie.cle));
  const lignes: Ligne[] = courbe.points.map((point) => ({
    jour: point.jour,
    ...point.valeurs,
  }));
  const formatsSeries = Object.fromEntries(courbe.series.map((serie) => [serie.cle, formatDeSerie(serie.cle, formats)]));
  if (lignes.length === 0 || series.length === 0) return <p className="text-[13px] text-[#6B7280]">Pas encore de données sur la période.</p>;

  if (separer) {
    return (
      <div className={cn("grid gap-4", series.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {series.map((serie) => (
          <figure key={serie.cle} className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-center gap-[7px] text-[13px] text-[#D1D5DB]">
              <span className="h-[3px] w-3.5 rounded-[2px]" style={{ background: serie.couleur }} aria-hidden />
              {serie.libelle}
              {formatsSeries[serie.cle] === "position" ? <span className="text-[12px] text-[#6B7280]">(plus haut, c&apos;est mieux)</span> : null}
            </figcaption>
            <Trace
              lignes={lignes}
              series={[serie]}
              formats={formatsSeries}
              hauteur={compact ? 130 : Math.round(hauteur * 0.7)}
              compact={compact}
              aire={aire && formatsSeries[serie.cle] !== "position"}
            />
          </figure>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Trace lignes={lignes} series={series} formats={formatsSeries} hauteur={hauteur} compact={compact} aire={aire} />
      {legende && compact ? <Legende series={series} compact /> : null}
    </div>
  );
}

/** La légende d'une courbe, à placer dans l'en-tête de la carte (ordinateur). */
export function LegendeCourbe({ courbe, seriesMasquees = [] }: { courbe: Courbe; seriesMasquees?: string[] }) {
  return <Legende series={courbe.series.filter((serie) => !seriesMasquees.includes(serie.cle))} />;
}
