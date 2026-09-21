/** Types de la bibliothèque de prompts, partagés par l'écran (sans dépendance serveur). */
export type StatistiquesVersion = { simulations: number; publiees: number; masquees: number; choisies: number };
export type VersionVue = { numero: number; note: string | null; auteur: string | null; le: string; courante: boolean; longueur: number; stats: StatistiquesVersion };
export type PromptVue = { typeSurface: string; libelle: string; zones: string[]; versionCourante: number; texte: string; misAJourLe: string; versions: VersionVue[] };
