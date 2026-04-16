import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { formatEuros } from "@/lib/utils";
import { getGamme, type LigneAdditionnelle } from "@/lib/calcul-devis";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
  Font,
} from "@react-pdf/renderer";

// ── Helpers ──────────────────────────────────────────────────────────
const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function formatDateFR(d: Date): string {
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

function euros(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

// ── Styles ───────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 30,
    paddingBottom: 60,
    paddingHorizontal: 40,
    color: "#1a1a1a",
  },
  title: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 16,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 8,
  },
  logoBox: {
    width: 60,
    height: 60,
    backgroundColor: "#1a1a1a",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  logoText: { color: "#ffffff", fontSize: 18, fontFamily: "Helvetica-Bold" },
  logoLabel: { color: "#ffffff", fontSize: 5, letterSpacing: 1.5, marginTop: 2 },
  emitter: { fontSize: 9, lineHeight: 1.5 },
  emitterBold: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  phone: { fontSize: 9, marginTop: 4, marginBottom: 6 },
  siretLine: {
    fontSize: 8,
    textAlign: "center",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderColor: "#999",
    marginBottom: 12,
  },
  clientBlock: { marginVertical: 10, fontSize: 9, lineHeight: 1.5 },
  clientLabel: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  objet: {
    fontSize: 9,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderColor: "#999",
  },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    borderWidth: 0.5,
    borderColor: "#1a1a1a",
  },
  tableRow: {
    flexDirection: "row",
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#1a1a1a",
  },
  thDesig: { width: "50%", padding: 6, fontFamily: "Helvetica-Bold", fontSize: 9 },
  thQte: { width: "12%", padding: 6, fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "center" },
  thPU: { width: "19%", padding: 6, fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "right" },
  thTotal: { width: "19%", padding: 6, fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "right" },
  tdDesig: { width: "50%", padding: 6, fontSize: 9 },
  tdQte: { width: "12%", padding: 6, fontSize: 9, textAlign: "center" },
  tdPU: { width: "19%", padding: 6, fontSize: 9, textAlign: "right" },
  tdTotal: { width: "19%", padding: 6, fontSize: 9, textAlign: "right" },
  tvaRow: {
    flexDirection: "row",
    borderWidth: 0.5,
    borderColor: "#1a1a1a",
    borderTopWidth: 0,
    padding: 6,
  },
  tvaText: { fontSize: 9, fontStyle: "italic" },
  totalBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 0.5,
    borderColor: "#1a1a1a",
    padding: 10,
    marginTop: -0.5,
    marginBottom: 12,
  },
  totalLabel: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#CC0000" },
  totalValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#CC0000" },
  note: { fontSize: 8, fontStyle: "italic", marginBottom: 4 },
  prestationNote: { fontSize: 9, fontFamily: "Helvetica-Bold", fontStyle: "italic", marginBottom: 12 },
  condTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  condItem: { fontSize: 9, marginBottom: 2, paddingLeft: 10 },
  signature: {
    marginTop: 28,
    textAlign: "right",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderColor: "#999",
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#444",
    borderTopWidth: 0.5,
    borderColor: "#999",
    paddingTop: 4,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 1 },
  sectionHead: { fontFamily: "Helvetica-Bold", fontStyle: "italic", fontSize: 9 },
  refLine: { fontFamily: "Helvetica-Bold", fontStyle: "italic", fontSize: 9, marginTop: 4 },
  gammeLine: { fontSize: 8, color: "#666", marginTop: 2 },
});

// ── PDF Document ─────────────────────────────────────────────────────
interface DevisData {
  numero: string;
  reference: string;
  nomReference: string | null;
  gammeLabel: string;
  mlTotal: number;
  prixVenteHTml: number;
  totalRevetement: number;
  fraisDeplacement: number;
  prixVente: number;
  acompte30: number;
  solde70: number;
  objet: string | null;
  createdDate: string;
  expiresDate: string;
  lignes: LigneAdditionnelle[];
  lead: {
    prenom: string;
    nom: string;
    ville: string | null;
    codePostal: string | null;
    telephone: string | null;
    email: string | null;
  };
}

function DevisPDF({ d }: { d: DevisData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Footer fixe */}
        <View style={s.footer} fixed>
          <View style={s.footerRow}>
            <Text>RIB : FR76 1610 6700 2096 0145 0427 085 – BIC : AGRIFRPP861</Text>
          </View>
          <View style={s.footerRow}>
            <Text>SIRET : 94518036200010</Text>
            <Text>APE : 4334Z</Text>
            <Text>Cover Swap</Text>
          </View>
        </View>

        {/* Titre */}
        <Text style={s.title}>DEVIS N° {d.numero} du {d.createdDate}</Text>

        {/* Logo + Emetteur */}
        <View style={s.logoRow}>
          <View style={s.logoBox}>
            <Text style={s.logoText}>CS</Text>
            <Text style={s.logoLabel}>COVER SWAP</Text>
          </View>
          <View>
            <Text style={s.emitterBold}>COVER SWAP</Text>
            <Text style={s.emitter}>Monsieur Lucas VILLEMIN</Text>
            <Text style={s.emitter}>73 rue Simone Veil</Text>
            <Text style={s.emitter}>34470 Pérols</Text>
            <Text style={s.emitter}>coverswap.contact@gmail.com</Text>
          </View>
        </View>
        <Text style={s.phone}>06 70 35 28 69</Text>

        <Text style={s.siretLine}>
          SIRET : 94518036200010 00010 / Code APE : 4334Z
        </Text>

        {/* Client */}
        <View style={s.clientBlock}>
          <Text style={s.clientLabel}>Client :</Text>
          <Text style={s.clientLabel}>{(d.lead.prenom + " " + d.lead.nom).toUpperCase()}</Text>
          {d.lead.ville && <Text>{d.lead.ville.toUpperCase()}</Text>}
          {d.lead.codePostal && <Text>{d.lead.codePostal}</Text>}
          {d.lead.telephone && <Text>{d.lead.telephone}</Text>}
          {d.lead.email && <Text>{d.lead.email}</Text>}
        </View>

        {d.objet && (
          <View style={s.objet}>
            <Text><Text style={{ fontFamily: "Helvetica-Bold" }}>Objet : </Text>{d.objet}</Text>
          </View>
        )}

        {/* Tableau */}
        <View style={s.tableHeader}>
          <Text style={s.thDesig}>DESIGNATION</Text>
          <Text style={s.thQte}>QTE</Text>
          <Text style={s.thPU}>PU HT (€)</Text>
          <Text style={s.thTotal}>TOTAL HT (€)</Text>
        </View>

        {/* Ligne revêtement principal */}
        <View style={s.tableRow}>
          <View style={s.tdDesig}>
            <Text style={s.sectionHead}>REVETEMENT ADHESIF :</Text>
            <Text style={s.refLine}>
              Ref. {d.reference}{d.nomReference ? " " + d.nomReference : ""}
            </Text>
            <Text style={s.gammeLine}>Gamme : {d.gammeLabel}</Text>
          </View>
          <Text style={s.tdQte}>{d.mlTotal} ml</Text>
          <Text style={s.tdPU}>{euros(d.prixVenteHTml)}</Text>
          <Text style={s.tdTotal}>{euros(d.totalRevetement)}</Text>
        </View>

        {/* Frais déplacement */}
        {d.fraisDeplacement > 0 && (
          <View style={s.tableRow}>
            <Text style={s.tdDesig}>FRAIS DE DEPLACEMENT</Text>
            <Text style={s.tdQte}>1</Text>
            <Text style={s.tdPU}>{euros(d.fraisDeplacement)}</Text>
            <Text style={s.tdTotal}>{euros(d.fraisDeplacement)}</Text>
          </View>
        )}

        {/* Lignes additionnelles */}
        {d.lignes.map((l, i) => {
          const label: Record<string, string> = {
            MAIN_OEUVRE_EXTRA: "Main d'oeuvre supplémentaire",
            DEPLACEMENT: "Frais de déplacement",
            FOURNITURES: "Fournitures",
            DEMONTAGE_REMONTAGE: "Démontage / remontage",
            REMISE: "Remise commerciale",
            LIBRE: "",
          };
          const designation = l.designation || label[l.type] || l.type;
          return (
            <View key={i} style={s.tableRow}>
              <Text style={s.tdDesig}>{designation}</Text>
              <Text style={s.tdQte}>{l.quantite}</Text>
              <Text style={s.tdPU}>{euros(Math.abs(l.prixUnitaire))}{l.total < 0 ? " (remise)" : ""}</Text>
              <Text style={s.tdTotal}>{euros(l.total)}</Text>
            </View>
          );
        })}

        {/* TVA */}
        <View style={s.tvaRow}>
          <Text style={s.tvaText}>TVA : NON APPLICABLE, ARTICLE 293 B DU CGI</Text>
        </View>

        {/* Total TTC */}
        <View style={s.totalBar}>
          <Text style={s.totalLabel}>TOTAL TTC</Text>
          <Text style={s.totalValue}>{euros(d.prixVente)}</Text>
        </View>

        <Text style={s.note}>*ml = mètre linéaire</Text>

        <Text style={s.prestationNote}>
          Le tarif au mètre linéaire posé comprend l'intégralité de la prestation :
          fourniture et pose du revêtement, restauration éventuelle de la surface ou
          du meuble dégradé si nécessaire, ainsi que le nettoyage final.
        </Text>

        {/* Conditions */}
        <Text style={s.condTitle}>Conditions de règlement :</Text>
        <Text style={s.condItem}>• Acompte de 30% à la signature : {euros(d.acompte30)} TTC</Text>
        <Text style={s.condItem}>• Solde de {euros(d.solde70)} TTC à la réception des travaux</Text>
        <Text style={s.condItem}>• Paiement par virement, chèque ou espèces</Text>
        <Text style={s.condItem}>• Devis valable 30 jours (jusqu'au {d.expiresDate})</Text>

        {/* Signature */}
        <Text style={s.signature}>
          Signature du client précédée de la mention "Bon pour accord" :
        </Text>
      </Page>
    </Document>
  );
}

// ── Route GET ────────────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const devis = await prisma.devis.findUnique({
    where: { id },
    include: { lead: true },
  });

  if (!devis) {
    return NextResponse.json({ error: "Devis non trouvé" }, { status: 404 });
  }

  const lead = devis.lead;
  const gamme = getGamme(devis.gamme);

  let lignes: LigneAdditionnelle[] = [];
  try {
    lignes = JSON.parse(devis.lignesAdditionnelles) as LigneAdditionnelle[];
  } catch {
    lignes = [];
  }

  const totalRevetement = Math.round(devis.mlTotal * devis.prixVenteHTml * 100) / 100;

  const data: DevisData = {
    numero: devis.numero,
    reference: devis.reference,
    nomReference: devis.nomReference,
    gammeLabel: gamme.label,
    mlTotal: devis.mlTotal,
    prixVenteHTml: devis.prixVenteHTml,
    totalRevetement,
    fraisDeplacement: devis.fraisDeplacement,
    prixVente: devis.prixVente,
    acompte30: devis.acompte30,
    solde70: devis.solde70,
    objet: devis.objet,
    createdDate: formatDateFR(new Date(devis.createdAt)),
    expiresDate: formatDateFR(new Date(devis.expiresAt)),
    lignes,
    lead: {
      prenom: lead.prenom,
      nom: lead.nom,
      ville: lead.ville,
      codePostal: lead.codePostal,
      telephone: lead.telephone,
      email: lead.email,
    },
  };

  const pdfBuffer = await renderToBuffer(<DevisPDF d={data} />);
  const uint8 = new Uint8Array(pdfBuffer);

  const filename = `Devis-${devis.numero}-${lead.nom.toUpperCase()}.pdf`;

  return new Response(uint8, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
