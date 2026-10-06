/**
 * Mission 22 (A5) — le menu « Plus » de la v2 : « À valider » dit en phrase ce qui attend (« À valider — 3 en
 * attente »), jamais en badge ni en nombre rouge (règle 8 : un seul compteur, sur Aujourd'hui). Règle pure, testée.
 */
export function phraseEnAttente(enAttente: number | null | undefined): string | null {
  if (typeof enAttente !== "number" || !Number.isFinite(enAttente) || enAttente < 1) return null;
  return `${Math.trunc(enAttente)} en attente`;
}

/** Le libellé d'une entrée de « Plus » : « À valider — 3 en attente », ou le libellé seul quand rien n'attend. */
export function libelleDansPlus(libelle: string, enAttente?: number | null): string {
  const phrase = phraseEnAttente(enAttente);
  return phrase ? `${libelle} — ${phrase}` : libelle;
}
