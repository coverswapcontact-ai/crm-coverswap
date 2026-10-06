import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EntreeJournal } from "@/lib/chronologie/journal-types";
import { GROUPES_VISIBLES, basculerFiltre, clePersonne, compteEnMots, filtrer, grouperParPersonne } from "./journal";

/** Mission 22 (A1) — la logique pure de l'écran du journal : groupes par personne, système à part, filtre, compte. */
function entree(partiel: Partial<EntreeJournal> & Pick<EntreeJournal, "id" | "le">): EntreeJournal {
  return { famille: "DOSSIER", type: "NOTE_AJOUTEE", titre: partiel.id, texte: null, direction: "INTERNE", lien: null, messageId: null, dossierId: null, clientNom: null, clientId: null, leadId: null, occurrences: 1, acteur: null, filtre: "CLIENTS", ...partiel };
}

describe("grouperParPersonne", () => {
  test("le client réunit ses leads et ses dossiers ; un lead seul, un dossier seul ; le système en dernier ; groupes et lignes du plus récent au plus ancien", () => {
    const groupes = grouperParPersonne([
      entree({ id: "a", le: "2026-10-06T10:00:00.000Z", clientId: "c1", clientNom: "Nadia Essai", dossierId: "d1" }),
      entree({ id: "sys", le: "2026-10-06T12:00:00.000Z", filtre: "SYSTEME", acteur: "le système" }),
      entree({ id: "b", le: "2026-10-06T11:00:00.000Z", leadId: "l2", clientNom: "Omar Appel" }),
      entree({ id: "c", le: "2026-10-05T10:00:00.000Z", clientId: "c1", leadId: "l1", clientNom: "Nadia Essai" }),
      entree({ id: "d", le: "2026-10-06T09:00:00.000Z", dossierId: "d3", clientNom: "Paul Autre" }),
    ]);
    assert.deepEqual(
      groupes.map((g) => [g.cle, g.nom, g.lien, g.entrees.map((e) => e.id)]),
      [
        ["lead:l2", "Omar Appel", "/leads?lead=l2", ["b"]],
        ["client:c1", "Nadia Essai", "/clients/c1", ["a", "c"]],
        ["dossier:d3", "Paul Autre", "/dossiers?dossier=d3", ["d"]],
        ["systeme", "Système", null, ["sys"]],
      ]
    );
  });

  test("clePersonne : client avant lead avant dossier ; sans rien, le système ; un groupe sans nom se dit « Sans nom »", () => {
    assert.equal(clePersonne({ clientId: "c", leadId: "l", dossierId: "d", clientNom: null }), "client:c");
    assert.equal(clePersonne({ clientId: null, leadId: "l", dossierId: "d", clientNom: null }), "lead:l");
    assert.equal(clePersonne({ clientId: null, leadId: null, dossierId: "d", clientNom: null }), "dossier:d");
    assert.equal(clePersonne({ clientId: null, leadId: null, dossierId: null, clientNom: null }), "systeme");
    assert.equal(grouperParPersonne([entree({ id: "x", le: "2026-10-06T10:00:00.000Z", dossierId: "d9" })])[0].nom, "Sans nom");
  });

  test("cinq groupes visibles avant « Voir les N autres » (règle 2)", () => {
    assert.equal(GROUPES_VISIBLES, 5);
  });
});

describe("filtre et compte", () => {
  test("un seul filtre actif, ou aucun : cliquer l'actif le retire ; filtrer garde le filtre demandé, tout sans filtre", () => {
    assert.equal(basculerFiltre(null, "ARGENT"), "ARGENT");
    assert.equal(basculerFiltre("ARGENT", "ARGENT"), null);
    assert.equal(basculerFiltre("ARGENT", "SYSTEME"), "SYSTEME");
    const liste = [entree({ id: "1", le: "2026-10-06T10:00:00.000Z", filtre: "ARGENT" }), entree({ id: "2", le: "2026-10-06T10:00:00.000Z", filtre: "CLIENTS" })];
    assert.deepEqual(filtrer(liste, "ARGENT").map((e) => e.id), ["1"]);
    assert.deepEqual(filtrer(liste, null).map((e) => e.id), ["1", "2"]);
  });

  test("le compte en mots", () => {
    assert.deepEqual([compteEnMots(0), compteEnMots(1), compteEnMots(6)], ["rien de nouveau", "1 chose", "6 choses"]);
  });
});
