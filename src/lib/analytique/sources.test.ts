import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { familleDe, familleDuLead, hoteDe, nomDeProvenance } from "./sources";
import type { Famille } from "./types";

/**
 * Mission 17 (partie B) — les familles de source (docs/ANALYTIQUE.md § 2), une seule définition : IA testée avant Meta
 * et le SEO sur l'hôte complet, Meta payant contre réseaux organiques, Google Ads par gclid ou cpc, fiche Google,
 * direct, autre ; puis la famille d'un lead. Module pur : aucune base, aucun réseau.
 */

describe("familleDe : une visite", () => {
  test("les assistants (IA), sur l'hôte complet, avant Meta et le SEO", () => {
    const cas: [Parameters<typeof familleDe>[0], Famille][] = [
      [{ referent: "chatgpt.com" }, "ia"],
      [{ source: "chatgpt.com", medium: "referral" }, "ia"],
      [{ referent: "https://www.perplexity.ai/search?q=covering" }, "ia"],
      [{ referent: "perplexity.ai" }, "ia"],
      [{ referent: "gemini.google.com" }, "ia"],
      [{ referent: "claude.ai" }, "ia"],
      [{ referent: "copilot.microsoft.com" }, "ia"],
      [{ referent: "meta.ai" }, "ia"],
      [{ referent: "chat.mistral.ai" }, "ia"],
      [{ source: "chatgpt" }, "ia"],
    ];
    for (const [entree, attendue] of cas) assert.equal(familleDe(entree), attendue, JSON.stringify(entree));
  });

  test("Meta payant (utm) contre réseaux organiques (lien partagé sans utm)", () => {
    assert.equal(familleDe({ source: "meta", medium: "cpc", campagne: "cuisine-sept" }), "meta");
    assert.equal(familleDe({ source: "fb", medium: "paid" }), "meta");
    assert.equal(familleDe({ source: "instagram", medium: "paid_social" }), "meta");
    assert.equal(familleDe({ source: "facebook", campagne: "cuisine-sept" }), "meta", "source Meta et campagne sans medium : une publicité");
    assert.equal(familleDe({ source: "meta/paid" }), "meta", "ancienne source courte du site");
    assert.equal(familleDe({ referent: "l.facebook.com" }), "reseaux");
    assert.equal(familleDe({ referent: "lm.facebook.com" }), "reseaux");
    assert.equal(familleDe({ referent: "l.instagram.com" }), "reseaux");
    assert.equal(familleDe({ source: "facebook", medium: "social" }), "reseaux");
    assert.equal(familleDe({ referent: "t.co" }), "reseaux");
    assert.equal(familleDe({ referent: "www.linkedin.com" }), "reseaux");
    assert.equal(familleDe({ referent: "youtube.com" }), "reseaux");
  });

  test("Google : organique = SEO, gclid ou cpc = Google Ads, fiche = Fiche Google", () => {
    assert.equal(familleDe({ referent: "www.google.com" }), "seo");
    assert.equal(familleDe({ referent: "google.fr" }), "seo");
    assert.equal(familleDe({ source: "google", medium: "organic" }), "seo");
    assert.equal(familleDe({ referent: "bing.com" }), "seo");
    assert.equal(familleDe({ referent: "duckduckgo.com" }), "seo");
    assert.equal(familleDe({ referent: "www.google.com", gclid: true }), "google-ads");
    assert.equal(familleDe({ gclid: true }), "google-ads");
    assert.equal(familleDe({ source: "google", medium: "cpc" }), "google-ads");
    assert.equal(familleDe({ source: "google/ppc" }), "google-ads");
    assert.equal(familleDe({ source: "gbp", medium: "organic" }), "fiche-google");
    assert.equal(familleDe({ source: "google-business" }), "fiche-google");
    assert.equal(familleDe({ referent: "business.google.com" }), "fiche-google");
    assert.equal(familleDe({ referent: "maps.google.fr" }), "fiche-google");
    // Un lien depuis Gmail n'est pas du SEO ; « googleads » n'est pas le mot « google ».
    assert.equal(familleDe({ referent: "mail.google.com" }), "autre");
    assert.equal(familleDe({ referent: "googleads.g.doubleclick.net" }), "autre");
  });

  test("direct, navigation interne, autre", () => {
    assert.equal(familleDe({}), "direct");
    assert.equal(familleDe({ source: "", referent: null }), "direct");
    assert.equal(familleDe({ source: "direct" }), "direct");
    assert.equal(familleDe({ referent: "coverswap.fr" }), "direct", "une page du site vers une autre");
    assert.equal(familleDe({ referent: "www.coverswap.fr" }), "direct");
    assert.equal(familleDe({ source: "newsletter", medium: "email" }), "autre");
    assert.equal(familleDe({ referent: "leboncoin.fr" }), "autre");
    assert.equal(familleDe({ referent: "metamorphose.fr" }), "autre");
    assert.equal(familleDe({ source: "bing", medium: "cpc" }), "autre", "publicité payante d'un autre moteur : ni SEO ni Google Ads");
  });

  test("hôte et nom de la provenance", () => {
    assert.equal(hoteDe("https://www.Perplexity.ai/search?q=x"), "perplexity.ai");
    assert.equal(hoteDe("l.facebook.com"), "l.facebook.com");
    assert.equal(hoteDe("pas un hôte"), "");
    assert.equal(nomDeProvenance({ source: "meta", medium: "paid" }), "meta/paid");
    assert.equal(nomDeProvenance({ referent: "www.chatgpt.com" }), "chatgpt.com");
    assert.equal(nomDeProvenance({}), "");
  });
});

describe("familleDuLead", () => {
  test("Lead.source META_ADS, puis canal, puis parcours, puis la source du lead", () => {
    assert.equal(familleDuLead({ source: "META_ADS", canal: "google.com" }), "meta");
    assert.equal(familleDuLead({ source: "SITE_DEVIS", canal: "chatgpt.com" }), "ia");
    assert.equal(familleDuLead({ source: "SITE_SIMULATEUR", canal: "meta/paid" }), "meta");
    assert.equal(familleDuLead({ source: "SITE_DEVIS", canal: null, parcours: { famille: "seo" } }), "seo");
    assert.equal(familleDuLead({ source: "SITE_DEVIS", canal: "", parcours: { referent: "gemini.google.com" } }), "ia");
    assert.equal(familleDuLead({ source: "INSTAGRAM" }), "reseaux");
    assert.equal(familleDuLead({ source: "REFERENCE" }), "autre");
    assert.equal(familleDuLead({ source: "SITE_CONTACT" }), "direct");
  });
});
