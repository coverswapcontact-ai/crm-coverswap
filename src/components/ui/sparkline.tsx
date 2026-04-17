"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Sparkline mini-graph — courbe fine Apple-style pour KPI cards.
 * Affiche une série de valeurs numériques sans axes ni légende.
 */
export default function Sparkline({
  data,
  color = "#CC0000",
  height = 48,
  className,
  formatTooltip,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  className?: string;
  formatTooltip?: (v: number, label: string) => string;
}) {
  if (!data || data.length === 0) {
    return <div style={{ height }} className={cn("w-full", className)} />;
  }

  const gradId = `spark-${color.replace("#", "")}`;

  return (
    <div style={{ height }} className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0}   />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: color, strokeOpacity: 0.15, strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const p = payload[0];
              const v = p.value as number;
              const l = p.payload?.label as string;
              const text = formatTooltip ? formatTooltip(v, l) : `${l}: ${v}`;
              return (
                <div className="rounded-lg bg-gray-900 text-white text-[11px] px-2 py-1 shadow-lg">
                  {text}
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
