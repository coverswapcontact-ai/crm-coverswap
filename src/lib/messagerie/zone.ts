/**
 * Mission 25 — la zone d'un client : à 25 km ou moins de Pérols (visite avec les échantillons), au-delà (échantillons par
 * la poste), ou inconnue. Table embarquée, sans service externe : les communes autour de Montpellier, avec leur code
 * postal et leurs coordonnées (à la centaine de mètres près ; le rayon de 25 km se lit à vol d'oiseau). Pur.
 *
 * Un code postal hors de l'Hérault et du Gard : au-delà, sans hésiter. Un code de l'Hérault ou du Gard absent de la
 * table, ou partagé entre une commune proche et une lointaine sans ville lisible : inconnue (le moteur prend alors la
 * variante « au-delà », qui ne promet aucune visite).
 */

export type Zone = "PROCHE" | "LOIN" | "INCONNUE";
export const LIBELLES_ZONE: Record<Zone, string> = { PROCHE: "à 25 km ou moins", LOIN: "au-delà de 25 km", INCONNUE: "zone inconnue" };

export const RAYON_KM = 25;
const PEROLS = { lat: 43.5636, lon: 3.9536 };

/** [code postal, commune, latitude, longitude] */
const COMMUNES: readonly [string, string, number, number][] = [
  ["34470", "Pérols", 43.5636, 3.9536],
  ["34000", "Montpellier", 43.6108, 3.8767],
  ["34070", "Montpellier", 43.5947, 3.8603],
  ["34080", "Montpellier", 43.6197, 3.8306],
  ["34090", "Montpellier", 43.6328, 3.8597],
  ["34970", "Lattes", 43.5675, 3.9008],
  ["34970", "Boirargues", 43.5772, 3.9419],
  ["34130", "Mauguio", 43.6164, 4.0083],
  ["34130", "Saint-Aunès", 43.6403, 3.9653],
  ["34130", "Mudaison", 43.6331, 4.0378],
  ["34130", "Candillargues", 43.6206, 4.07],
  ["34130", "Lansargues", 43.6528, 4.0753],
  ["34130", "Valergues", 43.6672, 4.0631],
  ["34280", "Carnon", 43.548, 3.979],
  ["34280", "La Grande-Motte", 43.5614, 4.0853],
  ["34250", "Palavas-les-Flots", 43.5283, 3.9283],
  ["34750", "Villeneuve-lès-Maguelone", 43.5333, 3.8606],
  ["34430", "Saint-Jean-de-Védas", 43.5775, 3.8261],
  ["34170", "Castelnau-le-Lez", 43.6333, 3.9],
  ["34920", "Le Crès", 43.6481, 3.9397],
  ["34830", "Clapiers", 43.6583, 3.8889],
  ["34830", "Jacou", 43.6608, 3.9122],
  ["34980", "Montferrier-sur-Lez", 43.6672, 3.8578],
  ["34980", "Saint-Clément-de-Rivière", 43.6833, 3.8433],
  ["34980", "Saint-Gély-du-Fesc", 43.6928, 3.8053],
  ["34980", "Combaillaux", 43.6694, 3.7683],
  ["34790", "Grabels", 43.6481, 3.8031],
  ["34990", "Juvignac", 43.6131, 3.8108],
  ["34680", "Saint-Georges-d'Orques", 43.6111, 3.7814],
  ["34880", "Lavérune", 43.59, 3.8056],
  ["34570", "Pignan", 43.5833, 3.7647],
  ["34570", "Murviel-lès-Montpellier", 43.605, 3.7378],
  ["34570", "Saussan", 43.5717, 3.7733],
  ["34570", "Vailhauquès", 43.6744, 3.7231],
  ["34690", "Fabrègues", 43.5508, 3.7764],
  ["34660", "Cournonsec", 43.5494, 3.7058],
  ["34660", "Cournonterral", 43.5583, 3.7197],
  ["34560", "Montbazin", 43.5167, 3.6967],
  ["34560", "Poussan", 43.4889, 3.6711],
  ["34770", "Gigean", 43.4997, 3.7114],
  ["34110", "Mireval", 43.5083, 3.8008],
  ["34110", "Vic-la-Gardiole", 43.4911, 3.7972],
  ["34110", "Frontignan", 43.4483, 3.7556],
  ["34540", "Balaruc-les-Bains", 43.4417, 3.6775],
  ["34540", "Balaruc-le-Vieux", 43.4628, 3.6858],
  ["34200", "Sète", 43.4028, 3.6928],
  ["34140", "Mèze", 43.4253, 3.605],
  ["34670", "Baillargues", 43.6614, 4.0128],
  ["34670", "Saint-Brès", 43.6669, 4.03],
  ["34740", "Vendargues", 43.6564, 3.97],
  ["34820", "Teyran", 43.6853, 3.9286],
  ["34820", "Assas", 43.7033, 3.9022],
  ["34820", "Guzargues", 43.7175, 3.9203],
  ["34160", "Castries", 43.6797, 3.985],
  ["34160", "Saint-Geniès-des-Mourgues", 43.6975, 4.0331],
  ["34160", "Sussargues", 43.7128, 4.0011],
  ["34160", "Beaulieu", 43.73, 4.0247],
  ["34160", "Restinclières", 43.7231, 4.0386],
  ["34160", "Saint-Drézéry", 43.7306, 3.9761],
  ["34160", "Montaud", 43.7489, 3.9542],
  ["34730", "Prades-le-Lez", 43.6983, 3.8642],
  ["34730", "Saint-Vincent-de-Barbeyrargues", 43.7036, 3.8603],
  ["34270", "Les Matelles", 43.7286, 3.8131],
  ["34270", "Saint-Mathieu-de-Tréviers", 43.7697, 3.8572],
  ["34400", "Lunel", 43.6756, 4.1356],
  ["34400", "Lunel-Viel", 43.6797, 4.0928],
  ["34400", "Saint-Just", 43.6589, 4.1158],
  ["34400", "Saint-Nazaire-de-Pézan", 43.6372, 4.1214],
  ["34400", "Saint-Christol", 43.7283, 4.0789],
  ["34400", "Saint-Sériès", 43.7244, 4.1103],
  ["34400", "Villetelle", 43.7317, 4.1347],
  ["34590", "Marsillargues", 43.6644, 4.1758],
  ["34150", "Aniane", 43.6858, 3.5856],
  ["34150", "Gignac", 43.6522, 3.5508],
  ["34800", "Clermont-l'Hérault", 43.6275, 3.4325],
  ["34190", "Ganges", 43.9339, 3.7083],
  ["34120", "Pézenas", 43.4594, 3.4233],
  ["34300", "Agde", 43.3108, 3.4758],
  ["34500", "Béziers", 43.3442, 3.2158],
  ["34700", "Lodève", 43.7314, 3.3194],
  ["30240", "Le Grau-du-Roi", 43.5372, 4.1361],
  ["30220", "Aigues-Mortes", 43.5667, 4.1925],
  ["30220", "Saint-Laurent-d'Aigouze", 43.6333, 4.1944],
  ["30470", "Aimargues", 43.6847, 4.2103],
  ["30600", "Vauvert", 43.6942, 4.2769],
  ["30660", "Gallargues-le-Montueux", 43.7186, 4.1736],
  ["30250", "Aubais", 43.7547, 4.145],
  ["30250", "Sommières", 43.7853, 4.0897],
  ["30000", "Nîmes", 43.8367, 4.3601],
  ["30900", "Nîmes", 43.8367, 4.3601],
];

/** Distance à vol d'oiseau, en kilomètres (haversine). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

/** « Saint-Jean-de-Védas » → « saint jean de vedas » ; « St Jean » → « saint jean ». */
export function normaliserCommune(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’\-_.,]/g, " ")
    .replace(/\bste\b/g, "sainte")
    .replace(/\bst\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}

const parCommune = new Map<string, number>();
for (const [, nom, lat, lon] of COMMUNES) parCommune.set(normaliserCommune(nom), distanceKm(PEROLS, { lat, lon }));

function zoneDeDistance(km: number): Zone {
  return km <= RAYON_KM ? "PROCHE" : "LOIN";
}

export type LectureZone = { zone: Zone; km: number | null; commune: string | null };

/**
 * La zone d'après la ville et le code postal (l'un ou l'autre peut manquer, « Non renseignée » compte pour rien).
 * La ville prime quand elle est dans la table ; sinon le code postal tranche s'il ne désigne que des communes du
 * même côté du rayon.
 */
export function zoneDe(ville: string | null | undefined, codePostal: string | null | undefined): LectureZone {
  const nom = ville ? normaliserCommune(ville) : "";
  const cp = (codePostal ?? "").replace(/\s/g, "");
  if (nom && parCommune.has(nom)) {
    const km = parCommune.get(nom)!;
    return { zone: zoneDeDistance(km), km: Math.round(km), commune: COMMUNES.find(([, n]) => normaliserCommune(n) === nom)![1] };
  }
  // Ville écrite avec son code (« 34470 Pérols ») ou un quartier (« Montpellier Port Marianne ») : le début suffit.
  if (nom) {
    for (const [cle, km] of parCommune) {
      if (nom.startsWith(`${cle} `) || nom.endsWith(` ${cle}`)) return { zone: zoneDeDistance(km), km: Math.round(km), commune: COMMUNES.find(([, n]) => normaliserCommune(n) === cle)![1] };
    }
  }
  const cpDansLaVille = nom.match(/\b(\d{5})\b/)?.[1];
  const code = /^\d{5}$/.test(cp) ? cp : cpDansLaVille ?? "";
  if (!code) return { zone: "INCONNUE", km: null, commune: null };
  const candidates = COMMUNES.filter(([c]) => c === code);
  if (candidates.length) {
    const distances = candidates.map(([, , lat, lon]) => distanceKm(PEROLS, { lat, lon }));
    const zones = new Set(distances.map(zoneDeDistance));
    if (zones.size === 1) return { zone: [...zones][0], km: Math.round(Math.min(...distances)), commune: candidates.length === 1 ? candidates[0][1] : null };
    return { zone: "INCONNUE", km: null, commune: null };
  }
  if (!code.startsWith("34") && !code.startsWith("30")) return { zone: "LOIN", km: null, commune: null };
  return { zone: "INCONNUE", km: null, commune: null };
}
