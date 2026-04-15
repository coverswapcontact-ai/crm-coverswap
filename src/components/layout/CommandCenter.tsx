"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList
} from "@/components/ui/command";
import { LayoutDashboard, Users, Kanban, FileText, Receipt, HardHat, Plus, Search } from "lucide-react";

interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  type: "lead" | "devis" | "facture" | "chantier";
}

export default function CommandCenter() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads?search=${encodeURIComponent(q)}&limit=5`);
        if (res.ok) {
          const data = await res.json();
          setResults((data.leads || []).map((l: any) => ({
            id: l.id, label: `${l.prenom} ${l.nom}`, sublabel: `${l.ville} - ${l.statut}`,
            href: `/leads/${l.id}`, type: "lead" as const,
          })));
        }
      } catch { setResults([]); }
    }, 300);
  }, []);

  const navigate = (href: string) => { setOpen(false); router.push(href); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Rechercher un lead, devis, chantier..." value={query} onValueChange={search} />
      <CommandList>
        <CommandEmpty>Aucun résultat.</CommandEmpty>
        <CommandGroup heading="Actions rapides">
          <CommandItem onSelect={() => navigate("/leads/nouveau")}>
            <Plus className="mr-2 h-4 w-4" /> Nouveau lead
          </CommandItem>
          <CommandItem onSelect={() => navigate("/leads/kanban")}>
            <Kanban className="mr-2 h-4 w-4" /> Voir le kanban
          </CommandItem>
          <CommandItem onSelect={() => navigate("/dashboard")}>
            <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
          </CommandItem>
        </CommandGroup>
        {results.length > 0 && (
          <CommandGroup heading="Résultats">
            {results.map((r) => (
              <CommandItem key={r.id} onSelect={() => navigate(r.href)}>
                <Users className="mr-2 h-4 w-4" />
                <div>
                  <p className="font-medium">{r.label}</p>
                  {r.sublabel && <p className="text-xs text-muted-foreground">{r.sublabel}</p>}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => navigate("/leads")}><Users className="mr-2 h-4 w-4" /> Leads</CommandItem>
          <CommandItem onSelect={() => navigate("/devis")}><FileText className="mr-2 h-4 w-4" /> Devis</CommandItem>
          <CommandItem onSelect={() => navigate("/factures")}><Receipt className="mr-2 h-4 w-4" /> Factures</CommandItem>
          <CommandItem onSelect={() => navigate("/chantiers")}><HardHat className="mr-2 h-4 w-4" /> Chantiers</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
