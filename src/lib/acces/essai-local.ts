/**
 * Mission 22 — la garde dure de l'essai local : `CRM_ESSAI_LOCAL=1`.
 *
 * Posée dans `.env.local` du poste (jamais sur Railway), elle remplace TOUT envoi sortant — alertes (Telegram, ntfy,
 * push web, mail), mails aux clients (Gmail, Resend), SMS, conversions Meta, écritures Google (Gmail, Agenda, Drive),
 * Stripe, passerelle du site, modèles payants (OpenAI, Anthropic) — par une ligne de journal « rien n'est parti ».
 * Elle suffit à elle seule : avec une copie des vraies données en local (connexion Google et abonnements push présents
 * en base), aucune variable vide ne protège, la garde si.
 *
 * Module sans dépendance (importé par les entonnoirs d'envoi, le gabarit et `instrumentation.ts`). Lecture paresseuse
 * de l'environnement, jamais au chargement du module. Le registre des envois refusés (les 50 derniers) sert au test
 * de garde et au bandeau.
 */
export type EnvoiRefuse = { canal: string; resume: string; le: Date };

const REGISTRE_MAX = 50;
const memoire = globalThis as unknown as { __coverswapEnvoisRefuses?: EnvoiRefuse[] };
const registre = () => (memoire.__coverswapEnvoisRefuses ??= []);

/** Vrai quand le poste est en essai local : aucun envoi ne doit partir. */
export function essaiLocal(): boolean {
  return process.env.CRM_ESSAI_LOCAL === "1";
}

/**
 * Mission 23 (L4a) — la seule levée de la garde : la campagne de calibrage (`npm run simulateur:calibrer`, lancée à la
 * main, `CALIBRAGE_23_PAYANT=1` sur sa ligne de commande) lève la garde pour OpenAI images et vision, dans SON processus
 * seulement (rien n'est écrit, `.env.local` n'est ni lu ni modifié) ; tous les autres canaux restent coupés. Jamais
 * appelée par l'application.
 */
export type CanalLevable = "openai-images" | "openai-vision";
const memoireLevees = globalThis as unknown as { __coverswapGardesLevees?: Set<CanalLevable> };
const levees = () => (memoireLevees.__coverswapGardesLevees ??= new Set());

export function leverGardePourCanaux(canaux: readonly CanalLevable[]): void {
  for (const c of canaux) levees().add(c);
}
export function retablirGarde(): void {
  levees().clear();
}
export function gardeLevee(canal: CanalLevable): boolean {
  return levees().has(canal);
}

/** Le message du bandeau et des journaux : une seule formulation partout. */
export const MESSAGE_ESSAI_LOCAL = "Base d'essai — rien ne part";

/**
 * À appeler à l'entonnoir d'un canal quand `essaiLocal()` : journalise, range dans le registre, et rend un résultat
 * neutre explicite que l'appelant peut renvoyer tel quel ou compléter.
 */
export function refuserEnvoi(canal: string, resume: string): { essaiLocal: true; detail: string } {
  console.warn(`[essai local] ${canal} : rien n'est parti — ${resume}`);
  const lignes = registre();
  lignes.push({ canal, resume, le: new Date() });
  if (lignes.length > REGISTRE_MAX) lignes.splice(0, lignes.length - REGISTRE_MAX);
  return { essaiLocal: true, detail: "essai local : rien n'est parti" };
}

/** Les envois refusés par la garde (les 50 derniers, du plus ancien au plus récent). */
export function envoisRefuses(): readonly EnvoiRefuse[] {
  return registre();
}

/** Essais seulement : vide le registre. */
export function oublierEnvoisRefuses(): void {
  registre().length = 0;
}
