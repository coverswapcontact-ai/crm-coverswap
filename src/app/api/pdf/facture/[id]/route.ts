import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { formatEuros } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const facture = await prisma.facture.findUnique({
    where: { id },
    include: { devis: { include: { lead: true } } },
  });

  if (!facture) {
    return NextResponse.json({ error: "Facture non trouvée" }, { status: 404 });
  }

  const devis = facture.devis;
  const lead = devis.lead;

  const statutLabel = facture.statut === "SOLDEE"
    ? "SOLDÉE"
    : facture.statut === "ACOMPTE_RECU"
    ? "ACOMPTE REÇU"
    : facture.statut === "IMPAYEE"
    ? "IMPAYÉE"
    : "ACOMPTE EN ATTENTE";

  const statutColor = facture.statut === "SOLDEE"
    ? "#16a34a"
    : facture.statut === "ACOMPTE_RECU"
    ? "#2563eb"
    : facture.statut === "IMPAYEE"
    ? "#dc2626"
    : "#ca8a04";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${facture.numero}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .logo { font-size: 24px; font-weight: bold; color: #CC0000; }
    .company-info { font-size: 12px; color: #666; line-height: 1.6; }
    .facture-info { text-align: right; }
    .facture-numero { font-size: 18px; font-weight: bold; color: #CC0000; }
    .statut-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; color: white; background: ${statutColor}; }
    .client-block { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
    .client-block h3 { margin: 0 0 10px 0; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #1a1a1a; color: white; padding: 12px; text-align: left; }
    td { padding: 12px; border-bottom: 1px solid #eee; }
    .total-row { font-weight: bold; font-size: 18px; }
    .total-amount { color: #CC0000; font-size: 22px; font-weight: bold; }
    .mention { color: #CC0000; font-weight: bold; font-size: 12px; margin: 10px 0; }
    .payment-status { margin-top: 30px; padding: 20px; border: 1px solid #eee; border-radius: 8px; }
    .payment-status h3 { margin: 0 0 15px 0; }
    .payment-line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
    .payment-check { color: #16a34a; font-weight: bold; }
    .payment-pending { color: #ca8a04; }
    .rib { background: #f9f9f9; padding: 15px; border-radius: 4px; font-size: 12px; margin-top: 20px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">COVER SWAP</div>
      <div class="company-info">
        Lucas Villemin<br>
        73 rue Simone Veil, 34470 Pérols<br>
        Tél : 06 70 35 28 69<br>
        Email : coverswap.contact@gmail.com<br>
        SIRET : 94518036200010<br>
        APE : 4334Z
      </div>
    </div>
    <div class="facture-info">
      <div class="facture-numero">${facture.numero}</div>
      <p>Date : ${new Date(facture.createdAt).toLocaleDateString("fr-FR")}</p>
      <p>Devis associé : ${devis.numero}</p>
      <p><span class="statut-badge">${statutLabel}</span></p>
    </div>
  </div>

  <div class="client-block">
    <h3>Client</h3>
    <p><strong>${lead.prenom} ${lead.nom}</strong></p>
    <p>${lead.ville}${lead.codePostal ? ` (${lead.codePostal})` : ""}</p>
    ${lead.telephone ? `<p>Tél : ${lead.telephone}</p>` : ""}
    ${lead.email ? `<p>Email : ${lead.email}</p>` : ""}
  </div>

  <table>
    <thead>
      <tr>
        <th>Désignation</th>
        <th>QTE</th>
        <th>PU HT</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Revêtement adhésif Cover Styl' — Réf. ${devis.reference}<br><small style="color:#666">Fourniture et pose</small></td>
        <td>${devis.mlTotal} ml</td>
        <td>${formatEuros(devis.prixMatiere / devis.mlTotal)}</td>
        <td>${formatEuros(devis.prixMatiere)}</td>
      </tr>
      <tr>
        <td>Main d'œuvre et pose</td>
        <td>${devis.mlTotal} ml</td>
        <td>100,00 €</td>
        <td>${formatEuros(100 * devis.mlTotal)}</td>
      </tr>
      ${devis.fraisDeplacement > 0 ? `
      <tr>
        <td>Frais de déplacement</td>
        <td>1</td>
        <td>${formatEuros(devis.fraisDeplacement)}</td>
        <td>${formatEuros(devis.fraisDeplacement)}</td>
      </tr>` : ""}
    </tbody>
  </table>

  <p class="mention">TVA NON APPLICABLE, ARTICLE 293 B DU CGI</p>

  <table>
    <tbody>
      <tr class="total-row">
        <td>TOTAL TTC</td>
        <td class="total-amount" style="text-align:right">${formatEuros(facture.montantTotal)}</td>
      </tr>
    </tbody>
  </table>

  <div class="payment-status">
    <h3>État des paiements</h3>
    <div class="payment-line">
      <span>Acompte 30% — ${formatEuros(devis.acompte30)}</span>
      <span class="${facture.acompteRecu ? "payment-check" : "payment-pending"}">
        ${facture.acompteRecu
          ? `Reçu le ${facture.acompteDate ? new Date(facture.acompteDate).toLocaleDateString("fr-FR") : ""}`
          : "En attente"}
      </span>
    </div>
    <div class="payment-line">
      <span>Solde 70% — ${formatEuros(devis.solde70)}</span>
      <span class="${facture.soldeRecu ? "payment-check" : "payment-pending"}">
        ${facture.soldeRecu
          ? `Reçu le ${facture.soldeDate ? new Date(facture.soldeDate).toLocaleDateString("fr-FR") : ""}`
          : "En attente"}
      </span>
    </div>
  </div>

  <div class="rib">
    <strong>Coordonnées bancaires :</strong><br>
    IBAN : FR76 1610 6700 2096 0145 0427 085<br>
    BIC : AGRIFRPP861
  </div>

  <script>window.print();</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
