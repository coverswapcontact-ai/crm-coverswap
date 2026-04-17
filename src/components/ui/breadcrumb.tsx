import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Breadcrumb Apple-style — discret, typographique, cliquable.
 * Usage:
 *   <Breadcrumb items={[
 *     { label: "Leads", href: "/leads" },
 *     { label: "Martin Dupont" },
 *   ]} />
 */
export default function Breadcrumb({
  items,
  className,
  showHome = true,
}: {
  items: BreadcrumbItem[];
  className?: string;
  showHome?: boolean;
}) {
  const allItems: BreadcrumbItem[] = showHome
    ? [{ label: "Accueil", href: "/dashboard" }, ...items]
    : items;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center gap-1 text-[12px] text-gray-400 flex-wrap", className)}
    >
      {allItems.map((item, i) => {
        const isLast = i === allItems.length - 1;
        const content = (
          <span
            className={cn(
              "inline-flex items-center gap-1 transition-colors",
              isLast
                ? "text-gray-700 font-medium"
                : "hover:text-gray-900 cursor-pointer"
            )}
          >
            {i === 0 && showHome && <Home className="w-3 h-3" />}
            {item.label}
          </span>
        );
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {item.href && !isLast ? <Link href={item.href}>{content}</Link> : content}
            {!isLast && <ChevronRight className="w-3 h-3 text-gray-300" />}
          </span>
        );
      })}
    </nav>
  );
}
