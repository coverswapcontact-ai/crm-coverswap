// Mission 24 — chemins et réglages communs aux scripts de calibrage de gpt-image-2.5-sunburst. Tout ce qui est image
// ou client vit HORS dépôt (~/coverswap-photos/sunburst-24) ; le dépôt ne garde que le code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RACINE = path.join(os.homedir(), "coverswap-photos", "sunburst-24");
export const LOT = path.join(RACINE, "lot");
export const CADRE = path.join(RACINE, "cadre");
export const MASQUES = path.join(RACINE, "masques");
export const RENDUS = path.join(RACINE, "rendus");
export const PLANCHES = path.join(RACINE, "planches");
export const JOURNAL = path.join(RACINE, "journal.json");
process.env.UPLOADS_DIR = path.join(RACINE, "uploads");

export const MODELE = "gpt-image-2.5-sunburst";
export const BUDGET = 2.3;
export const ENVELOPPES = { exploration: 0.25 * BUDGET, correction: 0.5 * BUDGET, validation: 0.2 * BUDGET, reserve: 0.05 * BUDGET } as const;
export type Phase = keyof typeof ENVELOPPES;

export type PhotoLot = { id: string; description: string; role: "exploration" | "validation"; largeur: number; hauteur: number };
export const lireLot = (): PhotoLot[] => JSON.parse(fs.readFileSync(path.join(LOT, "lot.json"), "utf8"));

for (const d of [CADRE, MASQUES, RENDUS, PLANCHES]) fs.mkdirSync(d, { recursive: true });
