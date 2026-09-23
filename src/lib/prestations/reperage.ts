import { FAMILLES, cleSousPartie, estFamille, famille, sousPartieDeCle, type Famille, type IdFamille, type SelectionPrestations, type SousPartie } from "./prestations";

/**
 * Retrouver une famille ou une sous-partie à partir de ce que Lucas dit
 * (mission 10) : « l'îlot », « CUISINE.ilot », « plan vasque », « la salle de
 * bain ». Accents et casse ignorés ; une sous-partie qui existe dans deux
 * familles (« crédence » : cuisine et salle de bain) n'est choisie que si la
 * famille est dite, ou qu'une seule des deux est cochée sur le dossier. Sinon,
 * les candidats sont rendus : l'assistant demande, il ne choisit pas.
 */

export const normaliser = (texte: string) =>
  texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ALIAS_FAMILLE: Record<string, IdFamille> = { cuisine: "CUISINE", sdb: "SDB", "salle de bain": "SDB", "salle de bains": "SDB", "salle d eau": "SDB", meubles: "MEUBLES", mobilier: "MEUBLES", meuble: "MEUBLES", dressing: "MEUBLES", pro: "PRO", professionnel: "PRO", "local professionnel": "PRO", local: "PRO", commerce: "PRO" };

export function repererFamille(texte: string): Famille | null {
  const brut = texte.trim();
  if (estFamille(brut.toUpperCase())) return famille(brut.toUpperCase() as IdFamille);
  const n = normaliser(brut);
  const id = ALIAS_FAMILLE[n] ?? FAMILLES.find((f) => normaliser(f.libelle) === n)?.id ?? null;
  return id ? famille(id) : null;
}

export type SousPartieReperee = { famille: Famille; sousPartie: SousPartie; cle: string };
export type ReperageSousPartie = { trouvee: SousPartieReperee } | { candidats: SousPartieReperee[] } | { aucune: true; proposees: SousPartieReperee[] };

const ALIAS_SOUS_PARTIE: Record<string, string> = { "meubles hauts": "facades-hautes", hauts: "facades-hautes", colonnes: "facades-basses", "meubles bas": "facades-basses", bas: "facades-basses", "plan de travail": "plan-de-travail", plan: "plan-de-travail", ilot: "ilot", "ilot central": "ilot", electromenager: "electromenager", frigo: "electromenager", "lave vaisselle": "electromenager", vasque: "meuble-vasque", placards: "portes-placard", placard: "portes-placard", dressing: "portes-dressing", tv: "meuble-tv", comptoir: "comptoir" };

function correspond(sp: SousPartie, n: string): boolean {
  const id = normaliser(sp.id);
  const libelle = normaliser(sp.libelle);
  return id === n || libelle === n || ALIAS_SOUS_PARTIE[n] === sp.id || libelle.startsWith(n) || (n.length >= 4 && libelle.includes(n));
}

/**
 * « ilot » → CUISINE.ilot ; « SDB.credence » → SDB.credence ; « crédence » seule
 * → candidats (cuisine, salle de bain) sauf si une seule famille candidate est
 * cochée ; « douche » → aucune, avec les sous-parties proposées de la famille dite.
 */
export function repererSousPartie(texte: string, contexte: { famille?: IdFamille | null; selection?: SelectionPrestations } = {}): ReperageSousPartie {
  const brut = texte.trim();
  const direct = sousPartieDeCle(brut) ?? sousPartieDeCle(brut.toUpperCase().split(".")[0] + "." + brut.split(".").slice(1).join("."));
  if (direct) return { trouvee: { ...direct, cle: cleSousPartie(direct.famille.id, direct.sousPartie.id) } };
  let familleDite: Famille | null = contexte.famille ? famille(contexte.famille) : null;
  let reste = brut;
  const sep = brut.indexOf(".");
  if (sep > 0) {
    familleDite = repererFamille(brut.slice(0, sep)) ?? familleDite;
    reste = brut.slice(sep + 1);
  } else {
    // « la crédence de la salle de bain », « îlot cuisine » : la famille peut être dans la phrase.
    for (const f of FAMILLES) {
      const noms = [f.libelle, ...Object.entries(ALIAS_FAMILLE).filter(([, id]) => id === f.id).map(([alias]) => alias)].map(normaliser);
      const n = normaliser(brut);
      const nom = noms.find((x) => x.length >= 3 && (n.endsWith(` ${x}`) || n.endsWith(` de la ${x}`) || n.endsWith(` du ${x}`) || n.startsWith(`${x} `)));
      if (nom) {
        familleDite = f;
        reste = n.replace(nom, "").replace(/\b(de la|du|de|des|la|le|les)\b/g, " ").trim();
        break;
      }
    }
  }
  const n = normaliser(reste).replace(/^(la |le |les |l |du |de la |des )/, "").trim();
  const familles = familleDite ? [familleDite] : [...FAMILLES];
  const trouvees: SousPartieReperee[] = familles.flatMap((f) => f.sousParties.filter((sp) => correspond(sp, n)).map((sp) => ({ famille: f, sousPartie: sp, cle: cleSousPartie(f.id, sp.id) })));
  // Une correspondance exacte (id ou libellé) l'emporte sur les préfixes.
  const exactes = trouvees.filter((t) => normaliser(t.sousPartie.id) === n || normaliser(t.sousPartie.libelle) === n || ALIAS_SOUS_PARTIE[n] === t.sousPartie.id);
  const retenues = exactes.length ? exactes : trouvees;
  if (retenues.length === 1) return { trouvee: retenues[0] };
  if (retenues.length > 1) {
    const cochees = contexte.selection ? retenues.filter((t) => t.famille.id in contexte.selection!) : [];
    if (cochees.length === 1) return { trouvee: cochees[0] };
    return { candidats: retenues };
  }
  const proposees = (familleDite ? [familleDite] : [...FAMILLES]).flatMap((f) => f.sousParties.map((sp) => ({ famille: f, sousPartie: sp, cle: cleSousPartie(f.id, sp.id) })));
  return { aucune: true, proposees };
}

export const libelleReperee = (r: SousPartieReperee) => `${r.famille.libelle} › ${r.sousPartie.libelle} (${r.cle})`;
