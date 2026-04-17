#!/usr/bin/env node
/**
 * Récupère TOUS les leads Meta passés et les envoie au CRM.
 * Usage:  TOKEN=xxxxx node scripts/recover-meta-leads.mjs
 *
 * Le token DOIT avoir leads_retrieval.
 */

const TOKEN = process.env.TOKEN;
const CRM_URL = process.env.CRM_URL || "https://crm.coverswap.fr/api/webhook";
const CRM_SECRET = process.env.CRM_SECRET || "coverswap-webhook-secret";
const AD_ACCOUNT = process.env.AD_ACCOUNT || "act_621595161821553";
const GRAPH = "https://graph.facebook.com/v21.0";

if (!TOKEN) {
  console.error("ERREUR : TOKEN manquant. Usage: TOKEN=xxx node scripts/recover-meta-leads.mjs");
  process.exit(1);
}

async function graph(path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${TOKEN}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph ${path}: ${res.status} ${err}`);
  }
  return res.json();
}

function splitFullName(full) {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { prenom: "Inconnu", nom: "Inconnu" };
  if (parts.length === 1) return { prenom: parts[0], nom: parts[0] };
  return { prenom: parts[0], nom: parts.slice(1).join(" ") };
}

async function pushToCrm(lead, ad) {
  const f = {};
  for (const fd of lead.field_data || []) {
    f[fd.name] = fd.values?.[0] || "";
  }

  // full_name split, ou first_name/last_name en fallback
  let prenom, nom;
  if (f.full_name) {
    ({ prenom, nom } = splitFullName(f.full_name));
  } else {
    prenom = f.first_name || f["prénom"] || "Inconnu";
    nom = f.last_name || f.nom || "Inconnu";
  }

  // Ville : chercher toutes les clés qui contiennent "situ" ou "ville" ou "city"
  const villeKey = Object.keys(f).find((k) =>
    /situ|ville|city|o[ûu]_[eê]tes/i.test(k)
  );
  const projetKey = Object.keys(f).find((k) => /projet|project/i.test(k));
  const projetValue = (projetKey && f[projetKey] || "").toLowerCase();
  const typeProjet = projetValue.includes("cuisine") ? "CUISINE"
    : projetValue.includes("bain") || projetValue.includes("sdb") ? "SDB"
    : projetValue.includes("meuble") ? "MEUBLES"
    : projetValue.includes("pro") ? "PRO"
    : "CUISINE";

  const payload = {
    prenom,
    nom,
    telephone: f.phone_number || f["téléphone"] || "",
    email: f.email || undefined,
    ville: (villeKey && f[villeKey]) || undefined,
    source: "META_ADS",
    typeProjet,
    notes: `[RECOVERY] Lead Meta du ${new Date(lead.created_time).toLocaleString("fr-FR")} — Ad: ${ad?.name || lead.ad_id} — leadgen_id: ${lead.id}`,
  };

  if (!payload.telephone && !payload.email) {
    console.log(`  ⚠ Skip ${lead.id} (ni téléphone ni email)`);
    return "skipped";
  }

  const res = await fetch(CRM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": CRM_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`  ✗ Échec CRM pour ${payload.prenom} ${payload.nom}: ${res.status}`);
    return "error";
  }
  const body = await res.json();
  return body.deduped ? "deduped" : "created";
}

async function main() {
  console.log(`[RECOVERY] Fetching all ads from ${AD_ACCOUNT}...`);

  // 1. Lister toutes les ads (y compris pausées) — pour inclure tous les leads historiques
  const adsResp = await graph(`${AD_ACCOUNT}/ads?fields=id,name,status&limit=200`);
  const ads = adsResp.data || [];
  console.log(`[RECOVERY] ${ads.length} ads trouvées\n`);

  const stats = { created: 0, deduped: 0, skipped: 0, error: 0, total: 0 };
  const seen = new Set();

  // 2. Pour chaque ad, pull tous les leads avec pagination
  for (const ad of ads) {
    let url = `${ad.id}/leads?fields=id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name&limit=100`;
    let pageNum = 1;

    while (url) {
      try {
        const resp = await graph(url);
        const leads = resp.data || [];
        if (leads.length === 0) break;

        console.log(`[${ad.name}] page ${pageNum}: ${leads.length} leads`);

        for (const lead of leads) {
          if (seen.has(lead.id)) continue;
          seen.add(lead.id);
          stats.total++;

          const result = await pushToCrm(lead, ad);
          stats[result] = (stats[result] || 0) + 1;
          // Throttle pour éviter rate limit CRM (30/min)
          await new Promise((r) => setTimeout(r, 2500));

          // Log par ligne
          const f = {};
          for (const fd of lead.field_data || []) f[fd.name] = fd.values?.[0] || "";
          const name = `${f.first_name || "?"} ${f.last_name || "?"}`;
          const date = new Date(lead.created_time).toLocaleDateString("fr-FR");
          console.log(`  ${result === "created" ? "✓" : result === "deduped" ? "=" : "-"} ${date} ${name} ${f.phone_number || f.email || ""}`);
        }

        // Pagination
        url = resp.paging?.next
          ? resp.paging.next.replace(`${GRAPH}/`, "").replace(/[?&]access_token=[^&]+/, "")
          : null;
        pageNum++;
      } catch (err) {
        console.error(`[${ad.name}] erreur: ${err.message}`);
        break;
      }
    }
  }

  console.log("\n═══════════════════════════════════════════");
  console.log(`TOTAL LEADS UNIQUES  : ${stats.total}`);
  console.log(`✓ Nouveaux créés     : ${stats.created}`);
  console.log(`= Déjà en base       : ${stats.deduped}`);
  console.log(`- Ignorés (no contact): ${stats.skipped}`);
  console.log(`✗ Erreurs            : ${stats.error}`);
  console.log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
