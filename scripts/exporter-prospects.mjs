#!/usr/bin/env node
/**
 * Exporte les agents et les prospects de démarchage d'une base SQLite locale
 * vers un fichier JSON à importer dans le pilotage (Prospects → Démarchage →
 * « Importer »). L'import ajoute ce qui manque et n'écrase rien : rejouable.
 *
 * Usage : node scripts/exporter-prospects.mjs [base.db] [fichier.json]
 *   base.db      défaut : prisma/dev.db
 *   fichier.json défaut : ../a-importer/prospects-AAAA-MM-JJ.json (hors du dépôt)
 *
 * Lecture seule (requêtes SELECT). Le fichier contient les coordonnées des
 * établissements : il ne doit jamais entrer dans le dépôt, qui est public.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

// Doit rester égal à FORMAT_EXPORT_PROSPECTS (src/lib/prospects/demarchage.ts).
const FORMAT = "coverswap-prospects/1";
const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const base = path.resolve(process.argv[2] ?? path.join(DEPOT, "prisma", "dev.db"));
const jour = new Date().toISOString().slice(0, 10);
const sortie = path.resolve(process.argv[3] ?? path.join(DEPOT, "..", "a-importer", `prospects-${jour}.json`));

if (!existsSync(base)) {
  console.error(`Base introuvable : ${base}`);
  process.exit(1);
}
if (sortie === DEPOT || sortie.startsWith(DEPOT + path.sep)) {
  console.error("Refusé : le fichier d'export ne doit pas être écrit dans le dépôt (public).");
  process.exit(1);
}

// SQLite rend les dates en millisecondes (ou en texte) et les booléens en 0/1,
// parfois en BigInt : on normalise, et une colonne absente d'une base ancienne vaut null.
const nombre = (valeur) => (valeur === null || valeur === undefined ? null : Number(valeur));
const texte = (valeur) => (valeur === null || valeur === undefined ? null : String(valeur));
const booleen = (valeur) => Boolean(Number(valeur ?? 0));
function date(valeur) {
  if (valeur === null || valeur === undefined) return null;
  const brut = typeof valeur === "bigint" ? Number(valeur) : valeur;
  const lue = new Date(typeof brut === "string" && /^\d+$/.test(brut) ? Number(brut) : brut);
  return Number.isNaN(lue.getTime()) ? null : lue.toISOString();
}

const prisma = new PrismaClient({ datasources: { db: { url: `file:${base.split(path.sep).join("/")}` } } });
try {
  const agents = await prisma.$queryRawUnsafe("SELECT * FROM AgentProfile ORDER BY slug");
  const prospects = await prisma.$queryRawUnsafe("SELECT * FROM Prospect ORDER BY createdAt");
  const activites = await prisma.$queryRawUnsafe("SELECT * FROM ProspectActivity ORDER BY createdAt");
  const brouillons = Number((await prisma.$queryRawUnsafe("SELECT count(*) AS n FROM EmailDraft"))[0].n);

  const slugDe = new Map(agents.map((agent) => [agent.id, agent.slug]));
  const activitesDe = new Map();
  for (const activite of activites) {
    const liste = activitesDe.get(activite.prospectId) ?? [];
    liste.push({ type: String(activite.type), details: texte(activite.details), createdAt: date(activite.createdAt) });
    activitesDe.set(activite.prospectId, liste);
  }

  const archives = prospects.filter((prospect) => prospect.archiveLe !== null && prospect.archiveLe !== undefined).length;
  const fichier = {
    format: FORMAT,
    exporteLe: new Date().toISOString(),
    agents: agents.map((agent) => ({ slug: agent.slug, nom: agent.nom, actif: booleen(agent.actif), config: texte(agent.config) ?? "{}" })),
    prospects: prospects.map((prospect) => ({
      agentSlug: slugDe.get(prospect.agentProfileId),
      googlePlaceId: prospect.googlePlaceId,
      nom: prospect.nom,
      adresse: texte(prospect.adresse),
      ville: texte(prospect.ville),
      codePostal: texte(prospect.codePostal),
      telephone: texte(prospect.telephone),
      siteWeb: texte(prospect.siteWeb),
      email: texte(prospect.email),
      emailType: texte(prospect.emailType) ?? "INCONNU",
      noteGoogle: nombre(prospect.noteGoogle),
      nbAvis: nombre(prospect.nbAvis),
      siret: texte(prospect.siret),
      anneeCreation: nombre(prospect.anneeCreation),
      statut: prospect.statut,
      score: nombre(prospect.score) ?? 0,
      scoreDetails: texte(prospect.scoreDetails),
      signalPrincipal: texte(prospect.signalPrincipal),
      angleSuggere: texte(prospect.angleSuggere),
      avisBruts: texte(prospect.avisBruts),
      fermetureHebdo: texte(prospect.fermetureHebdo),
      optOut: booleen(prospect.optOut),
      optOutAt: date(prospect.optOutAt),
      archiveLe: date(prospect.archiveLe),
      archiveMotif: texte(prospect.archiveMotif),
      createdAt: date(prospect.createdAt),
      activites: activitesDe.get(prospect.id) ?? [],
    })),
  };

  mkdirSync(path.dirname(sortie), { recursive: true });
  writeFileSync(sortie, JSON.stringify(fichier, null, 1), "utf8");
  const parStatut = {};
  for (const prospect of prospects) parStatut[prospect.statut] = (parStatut[prospect.statut] ?? 0) + 1;
  console.log(`Export écrit : ${sortie}`);
  console.log(`  agents : ${agents.map((agent) => agent.slug).join(", ") || "aucun"}`);
  console.log(`  prospects : ${prospects.length} (${Object.entries(parStatut).map(([statut, n]) => `${statut} ${n}`).join(", ")}${archives ? `, dont ${archives} archivés` : ""})`);
  console.log(`  activités : ${activites.length}`);
  if (brouillons > 0) console.warn(`  ATTENTION : ${brouillons} brouillon(s) d'e-mail non exportés (aucun écran ne les utilise).`);
} finally {
  await prisma.$disconnect();
}
