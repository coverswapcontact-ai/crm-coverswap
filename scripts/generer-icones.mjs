#!/usr/bin/env node
/**
 * Icônes et écrans de démarrage des deux applications installables :
 *   - « CoverSwap »          : le CRM complet (fond sombre, losange rouge de la marque) ;
 *   - « Messages CoverSwap » : la messagerie SMS (fond vert, bulle blanche).
 * Deux icônes qui se distinguent d'un coup d'œil sur l'écran d'accueil.
 *
 * Tout est dessiné en SVG puis rendu en PNG par sharp : `node scripts/generer-icones.mjs`.
 * Les fichiers produits (public/icones/) sont versionnés ; relancer le script
 * seulement pour changer le dessin.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SORTIE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icones");
mkdirSync(SORTIE, { recursive: true });

const SOMBRE = "#16181D";
const ROUGE = "#CC0000";
const VERT = "#1D9E75";

/** Le « C » de la marque, dessiné (aucune police requise) : un arc épais ouvert à droite. */
const lettreC = (cx, cy, rayon, epaisseur, couleur) => {
  const angle = (38 * Math.PI) / 180;
  const x = cx + rayon * Math.cos(angle);
  const yHaut = cy - rayon * Math.sin(angle);
  const yBas = cy + rayon * Math.sin(angle);
  return `<path d="M ${x} ${yHaut} A ${rayon} ${rayon} 0 1 0 ${x} ${yBas}" fill="none" stroke="${couleur}" stroke-width="${epaisseur}" stroke-linecap="butt"/>`;
};

/** Losange rouge de la marque, centré, avec son « C » blanc. `taille` = côté du carré avant rotation. */
const losange = (cx, cy, taille) => `
  <rect x="${cx - taille / 2}" y="${cy - taille / 2}" width="${taille}" height="${taille}" rx="${taille * 0.09}" transform="rotate(45 ${cx} ${cy})" fill="${ROUGE}"/>
  ${lettreC(cx, cy, taille * 0.27, taille * 0.13, "#FFFFFF")}`;

/** Icône du CRM. `marge` : part du côté laissée vide (icône « maskable » : 0.2). */
const iconeCrm = (marge = 0.12) => `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${SOMBRE}"/>
  ${losange(512, 512, 1024 * (1 - 2 * marge) * 0.62)}
</svg>`;

/** Icône de la messagerie : bulle blanche sur fond vert, le losange de la marque dedans. */
const iconeMessages = (marge = 0.12) => {
  const c = 1024 * (1 - 2 * marge);
  const x0 = 512 - c * 0.42;
  const y0 = 512 - c * 0.4;
  const l = c * 0.84;
  const h = c * 0.64;
  const r = c * 0.16;
  const queue = c * 0.16; // la pointe de la bulle, en bas à gauche
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${VERT}"/>
  <path fill="#FFFFFF" d="M ${x0 + r} ${y0} h ${l - 2 * r} a ${r} ${r} 0 0 1 ${r} ${r} v ${h - 2 * r} a ${r} ${r} 0 0 1 ${-r} ${r} h ${-(l * 0.45)} l ${-queue} ${queue} v ${-queue} h ${-(l - 2 * r - l * 0.45 - queue)} a ${r} ${r} 0 0 1 ${-r} ${-r} v ${-(h - 2 * r)} a ${r} ${r} 0 0 1 ${r} ${-r} z"/>
  ${losange(512, y0 + h / 2, c * 0.3)}
</svg>`;
};

/** Écran de démarrage : le même fond que l'application, l'emblème au centre, le nom dessous. */
const demarrage = (largeur, hauteur, application) => {
  const cote = Math.round(Math.min(largeur, hauteur) * 0.3);
  const cx = largeur / 2;
  const cy = hauteur / 2 - cote * 0.2;
  const embleme =
    application === "messages"
      ? `<svg x="${cx - cote / 2}" y="${cy - cote / 2}" width="${cote}" height="${cote}" viewBox="0 0 1024 1024">${iconeMessages(0.04).replace(/<\/?svg[^>]*>/g, "").replace(`<rect width="1024" height="1024" fill="${VERT}"/>`, `<rect width="1024" height="1024" rx="230" fill="${VERT}"/>`)}</svg>`
      : losange(cx, cy, cote * 0.62);
  const nom = application === "messages" ? "Messages" : "CoverSwap";
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}">
  <rect width="${largeur}" height="${hauteur}" fill="${SOMBRE}"/>
  ${embleme}
  <text x="${cx}" y="${cy + cote * 0.78}" text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="${Math.round(cote * 0.2)}" font-weight="600" fill="#F2F3F5" letter-spacing="-1">${nom}</text>
  ${application === "messages" ? `<text x="${cx}" y="${cy + cote * 1.02}" text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="${Math.round(cote * 0.11)}" fill="#8B919C">CoverSwap</text>` : ""}
</svg>`;
};

/** Tailles d'écran des iPhone (points × densité), portrait. */
export const ECRANS_IPHONE = [
  { largeur: 375, hauteur: 667, densite: 2 }, // SE, 8
  { largeur: 414, hauteur: 896, densite: 2 }, // XR, 11
  { largeur: 375, hauteur: 812, densite: 3 }, // X, XS, 11 Pro, 12/13 mini
  { largeur: 414, hauteur: 896, densite: 3 }, // XS Max, 11 Pro Max
  { largeur: 390, hauteur: 844, densite: 3 }, // 12, 13, 14
  { largeur: 428, hauteur: 926, densite: 3 }, // 12/13 Pro Max, 14 Plus
  { largeur: 393, hauteur: 852, densite: 3 }, // 14 Pro, 15, 15 Pro, 16
  { largeur: 430, hauteur: 932, densite: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { largeur: 402, hauteur: 874, densite: 3 }, // 16 Pro
  { largeur: 440, hauteur: 956, densite: 3 }, // 16 Pro Max
];

const rendre = (svg, fichier, taille) => sharp(Buffer.from(svg)).resize(taille, taille).png({ compressionLevel: 9 }).toFile(path.join(SORTIE, fichier));

for (const [application, dessin] of [
  ["crm", iconeCrm],
  ["messages", iconeMessages],
]) {
  await rendre(dessin(), `${application}-180.png`, 180); // apple-touch-icon
  await rendre(dessin(), `${application}-192.png`, 192);
  await rendre(dessin(), `${application}-512.png`, 512);
  await rendre(dessin(0.2), `${application}-masquable-512.png`, 512);
  for (const ecran of ECRANS_IPHONE) {
    const [l, h] = [ecran.largeur * ecran.densite, ecran.hauteur * ecran.densite];
    await sharp(Buffer.from(demarrage(l, h, application))).png({ compressionLevel: 9, palette: true }).toFile(path.join(SORTIE, `demarrage-${application}-${l}x${h}.png`));
  }
}
// Pastille monochrome des notifications (Android) et favicon de l'onglet.
await rendre(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 1024 1024">${lettreC(512, 512, 300, 150, "#FFFFFF")}</svg>`, "pastille-96.png", 96);
console.log("Icônes et écrans de démarrage écrits dans public/icones/");
