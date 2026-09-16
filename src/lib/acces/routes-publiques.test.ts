import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { ROUTES_PUBLIQUES, estRoutePublique } from "./routes-publiques";

const APP = path.resolve(__dirname, "..", "..", "app");

/** Chemins d'URL de toutes les pages et routes de l'application (groupes « (x) » retirés). */
function routesDeLApplication(dossier = APP, prefixe = ""): string[] {
  const resultat: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) {
      const segment = nom.startsWith("(") && nom.endsWith(")") ? "" : `/${nom}`;
      resultat.push(...routesDeLApplication(complet, prefixe + segment));
    } else if (/^(page|route)\.tsx?$/.test(nom)) {
      resultat.push(prefixe || "/");
    }
  }
  return resultat;
}

describe("routes publiques", () => {
  test("refus par défaut : pages et API métier exigent une session", () => {
    for (const chemin of [
      "/",
      "/dashboard",
      "/dossiers",
      "/api/dossiers",
      "/api/uploads/lead/sim/before.jpg",
      "/api/leads/123",
      "/api/journal",
      "/api/une-route-ajoutee-demain",
      "/api/webhookx",
      "/api/webhook/autre",
      "/api/healthcheck",
      "/api/simulate/autre",
      "/auth/signin/../../dossiers",
    ]) {
      assert.equal(estRoutePublique(chemin), false, chemin);
    }
  });

  test("les routes qui se protègent elles-mêmes restent joignables", () => {
    for (const chemin of [
      "/auth/signin",
      "/api/auth/session",
      "/api/auth/callback/credentials",
      "/api/health",
      "/api/webhook",
      "/api/webhook/meta",
      "/api/webhook/zapier",
      "/api/cron/relance",
      "/api/simulate",
    ]) {
      assert.equal(estRoutePublique(chemin), true, chemin);
    }
  });

  test("chaque entrée publique correspond à une route existante et dit comment elle se protège", () => {
    const existantes = routesDeLApplication();
    for (const route of ROUTES_PUBLIQUES) {
      assert.ok(route.protection.length > 10, route.chemin);
      if (route.chemin === "/robots.txt") continue;
      const trouvee = route.prefixe
        ? existantes.some((existante) => existante.startsWith(route.chemin))
        : existantes.includes(route.chemin);
      assert.ok(trouvee, `entrée publique sans route : ${route.chemin}`);
      if (route.prefixe) assert.ok(route.chemin.endsWith("/"), `préfixe sans « / » final : ${route.chemin}`);
    }
  });
});
