/** Erreur prévue (règle métier, saisie invalide) : son message, en français,
 *  est renvoyé tel quel à l'interface avec le statut HTTP indiqué. */
export class ErreurMetier extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ErreurMetier";
    this.status = status;
  }
}
