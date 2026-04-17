import { type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Empty state Apple-style — centré, icône circulaire discrète, CTA optionnel.
 * Remplace les "Aucun X trouvé" tristes par une invite claire.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
  tone = "neutral",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  className?: string;
  tone?: "neutral" | "success" | "warning" | "brand";
}) {
  const toneMap = {
    neutral: { bg: "bg-gray-100", text: "text-gray-400" },
    success: { bg: "bg-emerald-50", text: "text-emerald-500" },
    warning: { bg: "bg-amber-50", text: "text-amber-500" },
    brand:   { bg: "bg-red-50",     text: "text-[#CC0000]" },
  };
  const t = toneMap[tone];

  const actionEl = actionLabel ? (
    actionHref ? (
      <Link
        href={actionHref}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#CC0000] text-white text-[13px] font-semibold hover:bg-[#AA0000] transition-colors shadow-sm"
      >
        {actionLabel}
      </Link>
    ) : (
      <button
        onClick={onAction}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#CC0000] text-white text-[13px] font-semibold hover:bg-[#AA0000] transition-colors shadow-sm"
      >
        {actionLabel}
      </button>
    )
  ) : null;

  return (
    <div className={cn("flex flex-col items-center justify-center py-14 px-6 text-center", className)}>
      <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mb-4", t.bg)}>
        <Icon className={cn("w-6 h-6", t.text)} />
      </div>
      <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="text-[13px] text-gray-400 mt-1 max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {actionEl && <div className="mt-5">{actionEl}</div>}
    </div>
  );
}
