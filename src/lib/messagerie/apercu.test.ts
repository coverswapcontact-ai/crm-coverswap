import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { apercuDuTexte, texteDeDepart, VALEURS_EXEMPLE, variablesPermises } from "./apercu";
import { definitionMessage, lignesDuCatalogue, type VariableMessage } from "./catalogue";
import { controlerTexte } from "./controleur";
import { formuleBonjour, lienSms, pieceDe, prenomFiable, remplirTexte, type Piece, type ValeursMessage } from "./texte";

/**
 * Mission 25 (lot 3) — « chaque message s'affiche juste avec de vraies données, sur iPhone et sur Android » : les 41
 * messages et toutes leurs variantes, remplis pour des clients de toutes sortes (prénom fiable ou non, cuisine, salle
 * de bain, mobilier, local, pièce inconnue), relus par des règles fixes ; puis le lien qui ouvre Messages, dans les
 * deux formats. Et l'aperçu de Paramètres → SMS : ce qui bloque, ce qui est seulement signalé. Clients fictifs.
 */

const CLIENTS: { nom: string; prenom: string | null; piece: Piece }[] = [
  { nom: "prénom fiable, cuisine", prenom: prenomFiable([{ prenom: "marie-claire", nom: "Exemple" }]), piece: pieceDe(["CUISINE"]) },
  { nom: "sans prénom, salle de bain", prenom: prenomFiable([{ prenom: "Inconnu", nom: "Exemple" }]), piece: pieceDe(["SDB"]) },
  { nom: "prénom en deux mots, mobilier", prenom: prenomFiable([{ prenom: "Jean Exemple", nom: "Exemple" }]), piece: pieceDe(["MEUBLES"]) },
  { nom: "local professionnel", prenom: prenomFiable([{ prenom: "Élodie", nom: null }]), piece: pieceDe([], "PRO") },
  { nom: "pièce inconnue", prenom: prenomFiable([{ prenom: "Yanis", nom: "Exemple" }]), piece: pieceDe([], null) },
];

/** Des valeurs comme le CRM les écrit (lien long, moment du rappel, date et heure du chantier, créneaux de l'agenda). */
const VALEURS: Omit<ValeursMessage, "bonjour"> = {
  lien: "https://coverswap.fr/e/AB12CD-Xy3kP9qLm2Rt7vWzQ4",
  lien_avis: "https://g.page/r/CoverSwapExemple/review",
  quand_rappel: "demain matin",
  quand_reponse: "lundi matin",
  quand: "jeudi 15 octobre vers 10 h",
  date_chantier: "mardi 20 octobre",
  heure: "8 h 30",
  nombre: "3",
  creneau_1: "jeudi 15 octobre à 14 h",
  creneau_2: "vendredi 16 octobre à 10 h",
};

/** Ce qu'un texte rempli ne doit jamais montrer au client. */
const FAUTES: [RegExp, string][] = [
  [/[{}]/, "une variable non remplie"],
  [/ {2,}/, "deux espaces"],
  [/ [,.]/, "une espace avant une virgule ou un point"],
  [/\bnouveau [aeiouyàâéèêëîïôûüh]/i, "« nouveau » devant une voyelle"],
  [/\bde rénovation rénov/i, "un accord de pièce raté"],
  [/^bonjour\s+,/i, "« Bonjour , »"],
  [/\bundefined\b|\bnull\b/, "une valeur vide écrite"],
];

describe("Mission 25 (lot 3) — les 41 messages remplis avec de vraies données", () => {
  test("toutes les variantes, cinq clients : aucune faute, le contrôleur d'accord, 320 caractères au plus", () => {
    let vus = 0;
    for (const ligne of lignesDuCatalogue()) {
      const definition = definitionMessage(ligne.code);
      for (const client of CLIENTS) {
        const { texte, manquantes } = remplirTexte(ligne.texte, { bonjour: formuleBonjour(client.prenom), ...VALEURS }, client.piece);
        const ou = `${ligne.cle} (${client.nom}) : « ${texte} »`;
        assert.deepEqual(manquantes, [], ou);
        for (const [motif, faute] of FAUTES) assert.ok(!motif.test(texte), `${faute} — ${ou}`);
        assert.match(texte, /^[A-ZÀÂÉÈÊÎÔÛÇ]/, `majuscule au début — ${ou}`);
        if (!client.piece.feminin) assert.ok(!texte.includes(`${client.piece.nom} rénovée`) && !texte.includes(`nouvelle ${client.piece.nom}`), `accord au masculin — ${ou}`);
        if (!client.piece.connue) assert.ok(!/projet d'intérieur|projet de intérieur/.test(texte), `pièce inconnue — ${ou}`);
        if (client.prenom === null && texte.startsWith("Bonjour")) assert.match(texte, /^Bonjour,/, ou);
        const lienAttendu = ligne.texte.includes("{lien}") ? VALEURS.lien! : ligne.texte.includes("{lien_avis}") ? VALEURS.lien_avis! : null;
        const ecarts = controlerTexte(texte, {
          lienAttendu,
          premierContact: Boolean(definition.premierContact),
          prenom: client.prenom,
          permis: Object.values(VALEURS).filter((v): v is string => Boolean(v)),
        }).filter((e) => e.regle !== "DATE" || !/\b(demain|aujourd'hui|ce soir|la veille)\b/i.test(ligne.texte));
        assert.deepEqual(ecarts, [], ou);
        vus++;
      }
    }
    assert.equal(vus, lignesDuCatalogue().length * CLIENTS.length);
  });

  test("les accords de la pièce : féminin, masculin, voyelle, inconnue", () => {
    const s2 = texteDeDepart("S2", "defaut");
    const c3 = texteDeDepart("C3", "defaut");
    const remplir = (texte: string, piece: Piece) => remplirTexte(texte, { bonjour: "Bonjour,", ...VALEURS }, piece).texte;
    assert.match(remplir(s2, pieceDe(["CUISINE"])), /votre cuisine rénovée ici/);
    assert.match(remplir(s2, pieceDe(["MEUBLES"])), /votre mobilier rénové ici/);
    assert.match(remplir(c3, pieceDe(["SDB"])), /votre nouvelle salle de bain vous plaît/);
    assert.match(remplir(c3, pieceDe([], "PRO")), /votre nouveau local vous plaît/);
    assert.match(remplir(c3, pieceDe([], null)), /votre nouvel intérieur vous plaît/);
    assert.match(remplir(texteDeDepart("A2", "defaut"), pieceDe([], null)), /votre projet de rénovation\./);
  });

  test("Ouvrir Messages avec le texte : iPhone (&body=) et Android (?body=), le texte revient intact", () => {
    for (const ligne of lignesDuCatalogue()) {
      const texte = remplirTexte(ligne.texte, { bonjour: formuleBonjour("Zoé"), ...VALEURS }, pieceDe(["CUISINE"])).texte;
      const iphone = lienSms("+33639980018", texte, "IOS");
      const android = lienSms("+33639980018", texte, "ANDROID");
      assert.ok(iphone.startsWith("sms:+33639980018&body="), iphone);
      assert.ok(android.startsWith("sms:+33639980018?body="), android);
      for (const lien of [iphone, android]) {
        const corps = lien.slice("sms:+33639980018?body=".length);
        assert.ok(!/[\s&?#+«»]/.test(corps), `caractère non encodé dans ${ligne.cle} : ${corps}`);
        assert.equal(decodeURIComponent(corps), texte, ligne.cle);
      }
    }
  });
});

describe("Mission 25 (lot 3) — l'aperçu de Paramètres → SMS", () => {
  test("les textes validés : aucune erreur, rien à revoir", () => {
    for (const ligne of lignesDuCatalogue()) {
      const apercu = apercuDuTexte(ligne.code, ligne.variante, ligne.texte);
      assert.deepEqual(apercu.erreurs, [], ligne.cle);
      assert.deepEqual(apercu.aRevoir, [], ligne.cle);
      assert.ok(!apercu.texte.includes("{"), ligne.cle);
    }
  });

  test("bloquant : vide, variable inconnue, lien retiré, adresse écrite en dur ; signalé : deux questions, montant, présentation", () => {
    assert.deepEqual(apercuDuTexte("A2", "defaut", "  ").erreurs, ["Le texte est vide."]);
    assert.match(apercuDuTexte("A2", "defaut", "{bonjour} votre devis de {montant} ?").erreurs.join(" "), /\{montant\} : variable que le CRM ne remplit pas/);
    assert.match(apercuDuTexte("S2", "defaut", "{bonjour} votre simulation est prête !").erreurs.join(" "), /Le lien \{lien\} manque/);
    assert.match(apercuDuTexte("A2", "defaut", "{bonjour} voici https://exemple.fr").erreurs.join(" "), /Pas d'adresse écrite en dur/);
    // {lien} n'est pas permis là où le texte validé n'en a pas : le moteur ne le chercherait pas.
    assert.ok(!variablesPermises("A2", "defaut").includes("lien" as VariableMessage));
    const signale = apercuDuTexte("A2", "defaut", "{bonjour} c'est Lucas de CoverSwap. Le devis fait 1 200 € ? Vous êtes là ?");
    assert.deepEqual(signale.erreurs, []);
    assert.match(signale.aRevoir.join(" "), /2 questions/);
    assert.match(signale.aRevoir.join(" "), /montant/);
    assert.match(signale.aRevoir.join(" "), /premier contact/);
    // A1 se présente : rien à revoir pour la présentation.
    assert.ok(!apercuDuTexte("A1", "defaut", texteDeDepart("A1", "defaut").replace("Merci pour votre demande !", "Merci !")).aRevoir.some((r) => /premier contact/.test(r)));
  });

  test("l'aperçu remplit avec un client fictif : prénom, cuisine, lien d'exemple", () => {
    const apercu = apercuDuTexte("S2", "defaut", texteDeDepart("S2", "defaut"));
    assert.equal(apercu.texte, `Bonjour Camille, votre simulation est prête ! Découvrez votre cuisine rénovée ici : ${VALEURS_EXEMPLE.lien} Dites-moi ce que vous en pensez.`);
    assert.equal(apercu.longueur, apercu.texte.length);
  });
});
