import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as mime from "./mime";
import * as texte from "./texte";

/**
 * Mission 13 (lot 7, 29/09/2026) — l'agent mail v1 (tri par les règles, lecture
 * par le modèle, synthèse) est retiré ; restent ici les fonctions pures
 * partagées avec l'onglet Mail : la lecture du texte d'un mail et le MIME.
 */

const COMPTE = "coverswap.essai@example.test";

describe("lecture du texte d'un mail", () => {
  test("HTML en texte, historique cité retiré, adresses, téléphone, code postal", () => {
    assert.equal(
      texte.htmlEnTexte("<html><head><style>p{}</style></head><body><p>Bonjour&nbsp;Lucas,</p><p>Voici le plan&#39;s <b>cuisine</b> &eacute;t&eacute;</p><script>alert(1)</script></body></html>"),
      "Bonjour Lucas,\n\nVoici le plan's cuisine été"
    );
    assert.equal(
      texte.retirerCitations("Merci, c'est d'accord pour jeudi.\n\nLe lun. 14 sept. 2026 à 10:02, Lucas <coverswap@example.test> a\nécrit :\n> Bonjour,\n> Seriez-vous disponible ?"),
      "Merci, c'est d'accord pour jeudi."
    );
    assert.deepEqual(texte.lireAdresse('"Durand, Alice" <Alice.Durand@Example.test>'), { adresse: "alice.durand@example.test", nom: "Durand, Alice" });
    assert.deepEqual(
      texte.lireAdresses('"Durand, Alice" <alice@example.test>, bob@example.test').map((adresse) => adresse.adresse),
      ["alice@example.test", "bob@example.test"]
    );
    assert.equal(texte.trouverTelephone("Rappelez-moi au 06 12 34 56 78 svp"), "06 12 34 56 78");
    assert.deepEqual(texte.trouverCodePostalVille("12 rue des Lilas\n34470 Pérols"), { codePostal: "34470", ville: "Pérols" });
    assert.equal(texte.objetSansPrefixes("RE: TR : Fwd: Devis cuisine"), "Devis cuisine");
    assert.equal(texte.estAdresseAutomatique("no-reply@marque.example"), true);
    assert.equal(texte.estAdresseAutomatique("noemie@example.test"), false);
  });

  test("mail MIME : en-têtes encodés, aucune injection d'en-tête, pièces jointes", () => {
    const brut = mime
      .construireMime({
        de: COMPTE,
        deNom: "CoverSwap",
        a: "alice@example.test",
        objet: "Réponse à votre demande\r\nBcc: pirate@example.test",
        texte: "Bonjour,\nMerci.",
        enReponseA: "<m1@example.test>",
        references: "<m0@example.test>",
        pieces: [{ nom: "devis n° 12.pdf", type: "application/pdf", contenu: Buffer.from("%PDF-1.4") }],
      })
      .toString("utf8");
    const [entetes] = brut.split("\r\n\r\n");
    assert.equal(/^Bcc:/m.test(entetes), false);
    assert.match(entetes, /^Subject: =\?UTF-8\?B\?/m);
    assert.match(entetes, /^In-Reply-To: <m1@example\.test>$/m);
    assert.match(entetes, /^References: <m0@example\.test> <m1@example\.test>$/m);
    assert.match(brut, /filename\*=UTF-8''devis%20n%C2%B0%2012\.pdf/);
  });
});
