import type { AccuseEnvoi, DemandeEnvoi, EtatDistant, FournisseurSms, SmsEntrant } from "./types";

/**
 * Fournisseur d'essai : rien ne part, tout se passe comme si. Sert au poste de
 * développement et aux essais (SMS_FOURNISSEUR=simulateur). Les envois sont
 * gardés en mémoire ; `simulerReponse` fabrique un SMS entrant que la relève
 * rendra, exactement comme le ferait un vrai fournisseur.
 */
type Envoi = DemandeEnvoi & { identifiant: string; le: Date };

const memoire = globalThis as unknown as { __smsSimules?: { envois: Envoi[]; entrants: SmsEntrant[]; compteur: number; panne: string | null } };
// Propre à ce processus : un identifiant ne resert jamais, même après une remise à zéro.
const marque = Date.now().toString(36);
const etatInterne = () => (memoire.__smsSimules ??= { envois: [], entrants: [], compteur: 0, panne: null });

export function envoisSimules(): readonly Envoi[] {
  return etatInterne().envois;
}

export function simulerReponse(numero: string, texte: string, recuLe: Date = new Date()): SmsEntrant {
  const interne = etatInterne();
  const entrant = { identifiant: `sim-in-${marque}-${++interne.compteur}`, numero, texte, recuLe };
  interne.entrants.push(entrant);
  return entrant;
}

/** Fait échouer les prochains envois (réseau coupé, fournisseur en panne) ; `null` rétablit. */
export function simulerPanne(message: string | null): void {
  etatInterne().panne = message;
}

export function viderSimulateur(): void {
  // Le compteur continue : un identifiant de message ne resert jamais.
  memoire.__smsSimules = { envois: [], entrants: [], compteur: etatInterne().compteur, panne: null };
}

export const fournisseurSimulateur: FournisseurSms = {
  nom: "simulateur",
  bidirectionnel: true,
  expediteur: () => "+33937000000",

  async envoyer(demande: DemandeEnvoi): Promise<AccuseEnvoi> {
    const interne = etatInterne();
    if (interne.panne) throw new Error(interne.panne);
    const identifiant = `sim-out-${marque}-${++interne.compteur}`;
    interne.envois.push({ ...demande, identifiant, le: new Date() });
    console.log(`[sms:simulateur] → ${demande.numero.slice(0, 6)}… : ${demande.texte.slice(0, 60)}${demande.texte.length > 60 ? "…" : ""}`);
    return { identifiant, segments: 1 };
  },

  async releverEntrants(depuis: Date): Promise<SmsEntrant[]> {
    return etatInterne().entrants.filter((e) => e.recuLe.getTime() >= depuis.getTime());
  },

  async etat(identifiant: string): Promise<EtatDistant | null> {
    return etatInterne().envois.some((e) => e.identifiant === identifiant) ? { statut: "DELIVRE", le: new Date() } : null;
  },
};
