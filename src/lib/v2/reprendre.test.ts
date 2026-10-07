import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLE_REPRENDRE, DUREE_REPRENDRE_MS, choisirReprendre, contexteDepuisAdresse, estRecent, lireValeurServeur, phraseReprendre, valeurServeur } from "./reprendre";

/** Mission 22 (A2) — « Reprendre », logique pure : quelles adresses se mémorisent, 48 h, le choix entre les deux mémoires. */
const maintenant = new Date("2026-10-06T14:30:00.000Z");
const ilYA = (heures: number) => new Date(maintenant.getTime() - heures * 3_600_000).toISOString();

describe("contexteDepuisAdresse : les adresses qui se reprennent (inchangées)", () => {
  test("dossier, contact, fiche client, mail ; rien pour les listes", () => {
    assert.deepEqual(contexteDepuisAdresse("/dossiers", "dossier=abc&espace=1"), { chemin: "/dossiers?dossier=abc", titre: "le dossier ouvert", dossierId: "abc" });
    // Correctifs du 07/10 (d1) : la rubrique ouverte revient avec le dossier.
    assert.deepEqual(contexteDepuisAdresse("/dossiers", "dossier=abc&rubrique=devis"), { chemin: "/dossiers?dossier=abc&rubrique=devis", titre: "le dossier ouvert", dossierId: "abc" });
    assert.equal(contexteDepuisAdresse("/dossiers", "rubrique=devis"), null);
    assert.deepEqual(contexteDepuisAdresse("/leads", new URLSearchParams("lead=l1")), { chemin: "/leads?lead=l1", titre: "le contact ouvert", dossierId: null });
    assert.deepEqual(contexteDepuisAdresse("/clients/c1", ""), { chemin: "/clients/c1", titre: "la fiche client", dossierId: null });
    assert.deepEqual(contexteDepuisAdresse("/mail", "mail=m1"), { chemin: "/mail?mail=m1", titre: "le mail ouvert", dossierId: null });
    for (const [chemin, recherche] of [
      ["/dossiers", ""],
      ["/leads", "vue=A_APPELER"],
      ["/clients", ""],
      ["/mail", ""],
      ["/taches", "dossier=abc"],
      ["/finances", ""],
    ]) assert.equal(contexteDepuisAdresse(chemin, recherche), null, `${chemin}?${recherche}`);
    assert.equal(CLE_REPRENDRE, "reprendre");
  });
});

describe("estRecent, valeur serveur, choix entre les deux mémoires", () => {
  test("moins de 48 h ; une date illisible ou à venir ne compte pas", () => {
    assert.equal(DUREE_REPRENDRE_MS, 48 * 3_600_000);
    assert.ok(estRecent(ilYA(2), maintenant));
    assert.ok(estRecent(ilYA(47.9), maintenant));
    assert.ok(!estRecent(ilYA(48), maintenant));
    assert.ok(!estRecent(ilYA(-1), maintenant));
    assert.ok(!estRecent("n'importe quoi", maintenant));
  });

  test("« <dossierId>|<ISO> » s'écrit et se relit ; une valeur bancale rend null", () => {
    const valeur = valeurServeur("d1", maintenant);
    assert.equal(valeur, "d1|2026-10-06T14:30:00.000Z");
    assert.deepEqual(lireValeurServeur(valeur), { dossierId: "d1", le: "2026-10-06T14:30:00.000Z" });
    for (const bancal of [null, 12, "", "d1", "|2026-10-06T14:30:00.000Z", "d1|pas une date"]) assert.equal(lireValeurServeur(bancal), null, String(bancal));
  });

  test("le plus récent l'emporte ; le même chemin prend le titre nommé du serveur ; fermé = plus rien ; vieux = rien", () => {
    const local = { chemin: "/leads?lead=l1", titre: "le contact ouvert", le: ilYA(1) };
    const serveur = { chemin: "/dossiers?dossier=d1", titre: "dossier Essai, cuisine", le: ilYA(3), dossierId: "d1" };
    assert.deepEqual(choisirReprendre(local, serveur, maintenant), local);
    assert.deepEqual(choisirReprendre({ ...local, le: ilYA(5) }, serveur, maintenant), serveur);
    assert.deepEqual(choisirReprendre(null, serveur, maintenant), serveur);
    assert.deepEqual(choisirReprendre(local, null, maintenant), local);
    const memeDossier = { chemin: "/dossiers?dossier=d1", titre: "le dossier ouvert", le: ilYA(1), dossierId: "d1" };
    assert.deepEqual(choisirReprendre(memeDossier, serveur, maintenant), { ...memeDossier, titre: "dossier Essai, cuisine" });
    assert.equal(choisirReprendre({ ...local, le: ilYA(49) }, { ...serveur, le: ilYA(50) }, maintenant), null);
    assert.equal(choisirReprendre(local, serveur, maintenant, local.le), null, "fermé à cet instant");
    assert.deepEqual(choisirReprendre(local, serveur, maintenant, ilYA(2)), local, "fermé avant : le plus récent revient");
    assert.equal(choisirReprendre({ chemin: 3 as unknown as string, titre: "x", le: ilYA(1) }, null, maintenant), null);
  });

  test("la phrase : « Reprendre : dossier Essai · cuisine — il y a 3 h »", () => {
    assert.equal(phraseReprendre({ titre: "dossier Essai, cuisine", le: ilYA(3) }, maintenant), "Reprendre : dossier Essai, cuisine — il y a 3 h");
  });
});
