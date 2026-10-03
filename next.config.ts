import type { NextConfig } from "next";

// Adresses de l'ancien CRM : les écrans ont rejoint le pilotage, les liens
// (mails de notification, favoris, historique) mènent à leur équivalent.
// Redirections temporaires (307) : rien n'est mis en cache par le navigateur.
const ANCIENNES_ADRESSES: { source: string; destination: string }[] = [
  // « /leads » est redevenu un écran (section Leads, 21/09/2026) : seules ses anciennes sous-adresses redirigent.
  { source: "/leads/kanban", destination: "/leads" },
  { source: "/leads/nouveau", destination: "/leads" },
  { source: "/leads/:id", destination: "/leads?lead=:id" },
  { source: "/dashboard", destination: "/dossiers" },
  // Mission 17 (partie B) : tous les chiffres dans l'Analytique. Les liens déjà envoyés (notifications « Voir l'écran
  // Publicité », outils de l'assistant vers /synthese?du=&au=) restent joignables ; la requête d'origine suit
  // (/synthese?du=…&au=… ouvre l'Analytique sur ces dates).
  { source: "/analytics", destination: "/analytique" },
  { source: "/synthese", destination: "/analytique" },
  { source: "/publicite", destination: "/analytique?onglet=publicite" },
  { source: "/assistant", destination: "/dossiers" },
  { source: "/devis/nouveau", destination: "/dossiers" },
  { source: "/devis/:chemin*", destination: "/dossiers" },
  { source: "/factures", destination: "/finances" },
  { source: "/chantiers/:chemin*", destination: "/dossiers" },
  { source: "/commandes", destination: "/dossiers" },
  // Mission 18 (A1) : l'onglet Espaces clients est devenu le filtre « Espaces » de Dossiers (tâches, notifications et
  // favoris qui menaient à /espaces y arrivent).
  { source: "/espaces", destination: "/dossiers?espace=TOUS" },
  // Mission 18 (A3) : Dépenses est une section de Finances (liens de l'assistant, favoris, ?annee= suit). Le chemin
  // exact seulement : la saisie /depenses/nouvelle (raccourci de l'application installée) reste un écran.
  { source: "/depenses", destination: "/finances?section=depenses" },
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
