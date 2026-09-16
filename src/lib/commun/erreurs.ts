/** Erreur prévue (règle métier, saisie invalide) : son message, en français,
 *  est renvoyé tel quel à l'interface avec le statut HTTP indiqué, et ses
 *  détails éventuels (paramètres à saisir…) avec lui. */
export class ErreurMetier extends Error {
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "ErreurMetier";
    this.status = status;
    this.details = details;
  }
}
