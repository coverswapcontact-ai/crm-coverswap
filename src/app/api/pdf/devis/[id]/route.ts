import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { formatEuros } from "@/lib/utils";

export async function GET(
  request: NextRequest,
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

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${devis.numero}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .logo { font-size: 24px; font-weight: bold; color: #CC0000; }
    .company-info { font-size: 12px; color: #666; line-height: 1.6; }
    .devis-info { text-align: right; }
    .devis-numero { font-size: 18px; font-weight: bold; color: #CC0000; }
    .client-block { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
    .client-block h3 { margin: 0 0 10px 0; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #1a1a1a; color: white; padding: 12px; text-align: left; }
    td { padding: 12px; border-bottom: 1px solid #eee; }
    .total-row { font-weight: bold; font-size: 18px; }
    .total-amount { color: #CC0000; font-size: 22px; font-weight: bold; }
    .mention { color: #CC0000; font-weight: bold; font-size: 12px; margin: 10px 0; }
    .conditions { font-size: 11px; color: #666; line-height: 1.8; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
    .signature { margin-top: 40px; display: flex; justify-content: space-between; }
    .signature-box { width: 45%; border: 1px solid #ccc; padding: 20px; min-height: 80px; border-radius: 4px; }
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
    <div class="devis-info">
      <div class="devis-numero">${devis.numero}</div>
      <p>Date : ${new Date(devis.createdAt).toLocaleDateString("fr-FR")}</p>
      <p>Valable jusqu'au : ${new Date(devis.expiresAt).toLocaleDateString("fr-FR")}</p>
    </div>
  </div>

  <div class="client-block">
    <h3>Client</h3>
    <p><strong>${devis.lead.prenom} ${devis.lead.nom}</strong></p>
    <p>${devis.lead.ville}${devis.lead.codePostal ? ` (${devis.lead.codePostal})` : ""}</p>
    ${devis.lead.telephone ? `<p>Tél : ${devis.lead.telephone}</p>` : ""}
    ${devis.lead.email ? `<p>Email : ${devis.lead.email}</p>` : ""}
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
        <td class="total-amount" style="text-align:right">${formatEuros(devis.prixVente)}</td>
      </tr>
    </tbody>
  </table>

  <div class="conditions">
    <strong>Conditions de paiement :</strong><br>
    • Acompte de 30% à la signature : <strong>${formatEuros(devis.acompte30)}</strong><br>
    • Solde de 70% à réception des travaux : <strong>${formatEuros(devis.solde70)}</strong><br><br>
    <strong>Délai d'intervention :</strong> Sous 2 à 4 semaines après réception de l'acompte.<br>
    <strong>Validité du devis :</strong> 30 jours.
  </div>

  <div class="rib">
    <strong>Coordonnées bancaires :</strong><br>
    IBAN : FR76 1610 6700 2096 0145 0427 085<br>
    BIC : AGRIFRPP861
  </div>

  <div class="signature">
    <div class="signature-box">
      <small style="color:#666">Le prestataire</small><br><br>
      Lucas Villemin — CoverSwap
    </div>
    <div class="signature-box">
      <small style="color:#666">Le client — Bon pour accord</small><br>
      <small style="color:#999">Date et signature</small>
    </div>
  </div>

  <script>window.print();</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
