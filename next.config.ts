import type { NextConfig } from "next";

// Adresses de l'ancien CRM : les écrans ont rejoint le pilotage, les liens
// (mails de notification, favoris, historique) mènent à leur équivalent.
// Redirections temporaires (307) : rien n'est mis en cache par le navigateur.
const ANCIENNES_ADRESSES: { source: string; destination: string }[] = [
  // « /leads » est redevenu un écran (section Leads, 21/09/2026) : seules ses anciennes sous-adresses redirigent.
  { source: "/leads/kanban", destination: "/leads" },
  { source: "/leads/nouveau", destination: "/leads" },
  { source: "/leads/:id", destination: "/leads?lead=:id" },
  { source: "/prospection", destination: "/prospects?onglet=demarchage" },
  { source: "/dashboard", destination: "/dossiers" },
  { source: "/analytics", destination: "/synthese" },
  { source: "/assistant", destination: "/dossiers" },
  { source: "/devis/nouveau", destination: "/dossiers" },
  { source: "/devis/:chemin*", destination: "/numeros" },
  { source: "/factures", destination: "/finances" },
  { source: "/chantiers/:chemin*", destination: "/dossiers" },
  { source: "/commandes", destination: "/dossiers" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@libsql/client"],
  async redirects() {
    return [
      // « Nouveau devis » d'un lead : le dossier se crée pré-rempli depuis ce lead.
      { source: "/devis/nouveau", has: [{ type: "query", key: "leadId", value: "(?<lead>.+)" }], destination: "/dossiers?lead=:lead", permanent: false },
      ...ANCIENNES_ADRESSES.map((adresse) => ({ ...adresse, permanent: false })),
    ];
  },
};

export default nextConfig;
