import React from "react";
import { Document, Font, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
// Style d’un nœud react-pdf (le type n’est pas réexporté par @react-pdf/renderer).
type Style = Exclude<NonNullable<React.ComponentProps<typeof View>["style"]>, unknown[]>;
import { PDFDocument } from "pdf-lib";
import { EMETTEUR, type LigneDocument, type TypeDocument } from "@/lib/dossiers/constants";
import { dateEnLettres } from "@/lib/dossiers/dates";
import {
  calculerMontants,
  formatCentimes,
  libelleQuantite,
  totalLigneCentimes,
  versCentimes,
} from "@/lib/dossiers/montants";

// ─────────────────────────────────────────────────────────────────
// Gabarit PDF unique des devis et factures (module Dossiers).
// Les deux ne diffèrent que par le titre et le bloc de conditions.
// A4 portrait, Helvetica ; marges 17 mm, ou 10 mm en haut et 8 mm en bas
// (mode compact) quand le contenu déborde sur une seconde page.
// ─────────────────────────────────────────────────────────────────

// Pas de césure automatique : react-pdf couperait « revê-tement ».
Font.registerHyphenationCallback((mot) => [mot]);

const mm = (valeur: number) => (valeur * 72) / 25.4;

const NOIR = "#000000";
const BORDURE = 0.8;
const COTES = mm(17);
const MARGES = {
  normal: { haut: mm(17), bas: mm(17) },
  compact: { haut: mm(10), bas: mm(8) },
};
const HAUTEUR_PIED = 20; // deux lignes en 7,5 pt
const ECART_PIED = 8;

const LARGEUR_DESIGNATION = mm(98);
const LARGEUR_QTE = mm(22);
const LARGEUR_PU = mm(27);
const LARGEUR_TOTAL = mm(29);
const LARGEUR_TABLEAU = LARGEUR_DESIGNATION + LARGEUR_QTE + LARGEUR_PU + LARGEUR_TOTAL;

// Helvetica standard = encodage WinAnsi : les espaces fines ou insécables
// (sortie de Intl.NumberFormat) s'affichent en « / », et un caractère hors
// WinAnsi (emoji…) ne s'affiche pas. On normalise le texte saisi.
const WINANSI_ETENDU = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

function pourPdf(texte: string): string {
  return Array.from(
    texte
      .normalize("NFC")
      .replace(/[\u00A0\u2007\u2009\u202F]/g, " ")
      .replace(/[\u2010\u2011]/g, "-")
  )
    .filter((car) => {
      const code = car.codePointAt(0) ?? 0;
      return car === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WINANSI_ETENDU.has(car);
    })
    .join("");
}

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: NOIR,
    paddingLeft: COTES,
    paddingRight: COTES,
  },
  titre: { fontFamily: "Helvetica-Bold", fontSize: 13, textAlign: "center", marginBottom: 10 },
  gras: { fontFamily: "Helvetica-Bold" },

  entete: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  logo: {
    width: mm(32),
    height: mm(23.6),
    backgroundColor: NOIR,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMarque: { flexDirection: "row", alignItems: "flex-end" },
  logoCs: { fontFamily: "Helvetica-Bold", fontSize: 26, color: "#FFFFFF", lineHeight: 1 },
  logoCarre: { width: mm(3.4), height: mm(3.4), backgroundColor: "#E30613", marginLeft: 2, marginBottom: 2.5 },
  logoNom: { fontFamily: "Helvetica-Bold", fontSize: 6.5, color: "#FFFFFF", letterSpacing: 1.2, marginTop: 4 },
  emetteur: { fontSize: 10, lineHeight: 1.25 },
  email: { fontFamily: "Helvetica-Bold", color: "#0563C1", textDecoration: "underline" },
  telephone: { fontSize: 10, marginTop: 6 },
  siret: { fontSize: 7.5, marginTop: 2 },
  filet: { borderBottomWidth: 0.6, borderBottomColor: "#BFBFBF", marginTop: 6, marginBottom: 10 },

  client: { fontSize: 10, lineHeight: 1.25 },
  objet: { fontSize: 10, marginTop: 8, marginBottom: 10 },

  // Chaque cellule porte ses bordures haute, droite et basse (plus la gauche
  // pour la première de la rangée), et les rangées se chevauchent d'une
  // épaisseur : la grille reste fermée quand le tableau passe sur une
  // seconde page.
  tableau: { width: LARGEUR_TABLEAU },
  rangeeEntete: { flexDirection: "row" },
  rangee: { flexDirection: "row", marginTop: -BORDURE },
  premiereCellule: { borderLeftWidth: BORDURE },
  cellule: {
    borderTopWidth: BORDURE,
    borderRightWidth: BORDURE,
    borderBottomWidth: BORDURE,
    borderColor: NOIR,
    paddingVertical: 3,
    paddingHorizontal: 4,
    justifyContent: "center",
    fontSize: 9,
  },
  entetePrestations: { fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "center" },
  sousDesignation: { fontFamily: "Helvetica-BoldOblique", fontSize: 9 },
  centre: { textAlign: "center" },
  droite: { textAlign: "right" },
  section: { backgroundColor: "#E8E8E8", fontFamily: "Helvetica-Bold" },
  totalHt: { fontFamily: "Helvetica-BoldOblique", fontSize: 10.5 },
  tva: { fontFamily: "Helvetica-BoldOblique", fontSize: 9 },
  totalTtc: { fontFamily: "Helvetica-Bold", fontSize: 12, color: "#C00000" },

  noteMl: { fontFamily: "Helvetica-BoldOblique", fontSize: 7.5, marginTop: 8 },
  noteMlTexte: { fontFamily: "Helvetica-BoldOblique", fontSize: 9, marginTop: 3, lineHeight: 1.25 },

  conditions: { marginTop: 10 },
  conditionsTitre: { fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 3 },
  puce: { flexDirection: "row", alignItems: "flex-start", marginTop: 2 },
  carre: { width: 3.5, height: 3.5, backgroundColor: NOIR, marginTop: 3.2, marginLeft: 2, marginRight: 6 },
  textePuce: { fontSize: 9, flex: 1, lineHeight: 1.25 },
  signature: { fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "right", marginTop: 12 },

  pied: { position: "absolute", left: COTES, right: COTES, fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  piedColonnes: { flexDirection: "row", marginTop: 2 },
  piedColonne: { flex: 1 },
});

export type DonneesDocumentPdf = {
  type: TypeDocument;
  numero: string;
  dateEmission: Date;
  objet: string;
  lignes: LigneDocument[];
  acomptePct: number | null;
  noteMl: boolean;
  client: { nom: string; adresse: string; codePostal: string; ville: string };
};

function puces(donnees: DonneesDocumentPdf): string[] {
  const { totalTtcCentimes, acompteCentimes, soldeCentimes } = calculerMontants(donnees.lignes, donnees.acomptePct);
  const modes = "Paiement par virement – chèque ou espèces";
  if (donnees.type === "FACTURE") {
    return [`Montant total à régler : ${formatCentimes(totalTtcCentimes)} TTC`, "Paiement à réception de facture", modes];
  }
  const reglement =
    acompteCentimes > 0
      ? [
          `Acompte de ${donnees.acomptePct}% à la signature du devis, soit ${formatCentimes(acompteCentimes)} TTC`,
          ...(soldeCentimes > 0
            ? [`Solde de ${formatCentimes(soldeCentimes)} TTC à régler à la réception des travaux`]
            : []),
        ]
      : [`Montant de ${formatCentimes(totalTtcCentimes)} TTC à régler à la réception des travaux`];
  return [...reglement, modes, "Devis valable 30 jours à compter de la date d'émission"];
}

function Cellule({
  largeur,
  premiere = false,
  style,
  children,
}: {
  largeur: number;
  premiere?: boolean;
  style?: Style;
  children: React.ReactNode;
}) {
  const styles: Style[] = [s.cellule, { width: largeur }];
  if (premiere) styles.push(s.premiereCellule);
  if (style) styles.push(style);
  return <View style={styles}>{children}</View>;
}

export function DocumentPdf({ donnees, compact }: { donnees: DonneesDocumentPdf; compact: boolean }) {
  const marges = compact ? MARGES.compact : MARGES.normal;
  const { totalHtCentimes, totalTtcCentimes } = calculerMontants(donnees.lignes, donnees.acomptePct);
  const libelleType = donnees.type === "DEVIS" ? "DEVIS" : "FACTURE";
  const largeurLibelleTotal = LARGEUR_DESIGNATION + LARGEUR_QTE + LARGEUR_PU;

  return (
    <Document
      title={pourPdf(`${libelleType === "DEVIS" ? "Devis" : "Facture"} ${donnees.numero} — ${donnees.client.nom}`)}
      author={EMETTEUR.raisonSociale}
      creator="CRM CoverSwap"
      producer="CRM CoverSwap"
      language="fr-FR"
    >
      <Page
        size="A4"
        style={[s.page, { paddingTop: marges.haut, paddingBottom: marges.bas + HAUTEUR_PIED + ECART_PIED }]}
      >
        <Text style={s.titre}>
          {libelleType} N° {donnees.numero} du {dateEnLettres(donnees.dateEmission)}
        </Text>

        <View style={s.entete}>
          <View style={s.logo}>
            <View style={s.logoMarque}>
              <Text style={s.logoCs}>CS</Text>
              <View style={s.logoCarre} />
            </View>
            <Text style={s.logoNom}>COVER SWAP</Text>
          </View>
          <View style={s.emetteur}>
            <Text style={s.gras}>{EMETTEUR.raisonSociale}</Text>
            <Text>{EMETTEUR.gerant}</Text>
            <Text>{EMETTEUR.adresse}</Text>
            <Text>{EMETTEUR.codePostalVille}</Text>
            <Link src={`mailto:${EMETTEUR.email}`} style={s.email}>
              {EMETTEUR.email}
            </Link>
          </View>
        </View>
        <Text style={s.telephone}>{EMETTEUR.telephone}</Text>
        <Text style={s.siret}>{EMETTEUR.ligneSiret}</Text>
        <View style={s.filet} />

        <View style={s.client}>
          <Text style={s.gras}>Client :</Text>
          <Text>{pourPdf(donnees.client.nom)}</Text>
          <Text>{pourPdf(donnees.client.adresse)}</Text>
          <Text>{pourPdf(`${donnees.client.codePostal} ${donnees.client.ville}`)}</Text>
        </View>
        <Text style={s.objet}>
          <Text style={s.gras}>Objet : </Text>
          {pourPdf(donnees.objet)}
        </Text>

        <View style={s.tableau}>
          <View style={s.rangeeEntete} wrap={false}>
            <Cellule largeur={LARGEUR_DESIGNATION} premiere>
              <Text style={s.entetePrestations}>DESIGNATION</Text>
            </Cellule>
            <Cellule largeur={LARGEUR_QTE}>
              <Text style={s.entetePrestations}>QTE</Text>
            </Cellule>
            <Cellule largeur={LARGEUR_PU}>
              <Text style={s.entetePrestations}>PU HT (€)</Text>
            </Cellule>
            <Cellule largeur={LARGEUR_TOTAL}>
              <Text style={s.entetePrestations}>TOTAL HT (€)</Text>
            </Cellule>
          </View>

          {donnees.lignes.map((ligne, index) =>
            ligne.type === "SECTION" ? (
              // minPresenceAhead : un bandeau de section ne reste jamais seul en bas de page.
              <View key={index} style={s.rangee} wrap={false} minPresenceAhead={36}>
                <Cellule largeur={LARGEUR_TABLEAU} premiere style={s.section}>
                  <Text>{pourPdf(ligne.libelle)}</Text>
                </Cellule>
              </View>
            ) : (
              <View key={index} style={s.rangee} wrap={false}>
                <Cellule largeur={LARGEUR_DESIGNATION} premiere>
                  <Text>{pourPdf(ligne.designation)}</Text>
                  {ligne.sousDesignation ? (
                    <Text style={s.sousDesignation}>({pourPdf(ligne.sousDesignation)})</Text>
                  ) : null}
                </Cellule>
                <Cellule largeur={LARGEUR_QTE}>
                  <Text style={s.centre}>{libelleQuantite(ligne.quantite, ligne.unite)}</Text>
                </Cellule>
                <Cellule largeur={LARGEUR_PU}>
                  <Text style={s.droite}>{formatCentimes(versCentimes(ligne.prixUnitaire))}</Text>
                </Cellule>
                <Cellule largeur={LARGEUR_TOTAL}>
                  <Text style={s.droite}>{formatCentimes(totalLigneCentimes(ligne))}</Text>
                </Cellule>
              </View>
            )
          )}

          <View wrap={false}>
            <View style={s.rangee}>
              <Cellule largeur={largeurLibelleTotal} premiere>
                <Text style={s.totalHt}>TOTAL HT</Text>
              </Cellule>
              <Cellule largeur={LARGEUR_TOTAL}>
                <Text style={[s.totalHt, s.droite]}>{formatCentimes(totalHtCentimes)}</Text>
              </Cellule>
            </View>
            <View style={s.rangee}>
              <Cellule largeur={LARGEUR_TABLEAU} premiere>
                <Text style={s.tva}>{EMETTEUR.mentionTva}</Text>
              </Cellule>
            </View>
            <View style={s.rangee}>
              <Cellule largeur={largeurLibelleTotal} premiere>
                <Text style={s.totalTtc}>TOTAL TTC</Text>
              </Cellule>
              <Cellule largeur={LARGEUR_TOTAL}>
                <Text style={[s.totalTtc, s.droite]}>{formatCentimes(totalTtcCentimes)}</Text>
              </Cellule>
            </View>
          </View>
        </View>

        {donnees.noteMl ? (
          <View wrap={false}>
            <Text style={s.noteMl}>*ml = mètre linéaire</Text>
            <Text style={s.noteMlTexte}>
              Le tarif au mètre linéaire posé comprend l’intégralité de la prestation : fourniture et pose du
              revêtement, restauration éventuelle de la surface ou du meuble dégradé si nécessaire, ainsi que le
              nettoyage final.
            </Text>
          </View>
        ) : null}

        <View style={s.conditions} wrap={false}>
          <Text style={s.conditionsTitre}>Conditions de règlement :</Text>
          {puces(donnees).map((texte) => (
            <View key={texte} style={s.puce}>
              <View style={s.carre} />
              <Text style={s.textePuce}>{texte}</Text>
            </View>
          ))}
          {donnees.type === "DEVIS" ? (
            <View style={{ minHeight: compact ? mm(12) : mm(20) }}>
              <Text style={s.signature}>Signature du client précédée de la mention &quot;Bon pour accord&quot; :</Text>
            </View>
          ) : null}
        </View>

        <View fixed style={[s.pied, { bottom: marges.bas }]}>
          <Text>{EMETTEUR.ligneRib}</Text>
          <View style={s.piedColonnes}>
            <Text style={s.piedColonne}>{EMETTEUR.piedSiret}</Text>
            <Text style={[s.piedColonne, s.centre]}>{EMETTEUR.piedApe}</Text>
            <Text style={[s.piedColonne, s.droite]}>{EMETTEUR.piedNom}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export type RenduPdf = { contenu: Buffer; compact: boolean; pages: number };

async function rendre(donnees: DonneesDocumentPdf, compact: boolean): Promise<RenduPdf> {
  const contenu = await renderToBuffer(<DocumentPdf donnees={donnees} compact={compact} />);
  const pages = (await PDFDocument.load(contenu, { updateMetadata: false })).getPageCount();
  return { contenu, compact, pages };
}

/**
 * Rend le PDF. Sans mode imposé : essai en marges normales, puis en mode
 * compact si le document dépasse une page. Le document doit tenir sur une
 * page chaque fois que c'est possible.
 */
export async function rendreDocumentPdf(
  donnees: DonneesDocumentPdf,
  options: { compact?: boolean } = {}
): Promise<RenduPdf> {
  if (options.compact !== undefined) return rendre(donnees, options.compact);
  const normal = await rendre(donnees, false);
  return normal.pages <= 1 ? normal : rendre(donnees, true);
}
