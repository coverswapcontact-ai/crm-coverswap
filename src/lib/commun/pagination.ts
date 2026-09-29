/**
 * Mission 13 (26/09/2026), lot 6 — les listes se chargent une page à la fois
 * (50 par défaut). La page est numérotée à partir de 1 ; `skip`/`take` sont
 * prêts pour Prisma.
 */
export const PAR_PAGE = 50;

export type Tranche = { page: number; parPage: number; skip: number; take: number };

export function tranche(page?: number | string | null, parPage?: number | string | null): Tranche {
  const taille = Math.min(Math.max(Math.round(Number(parPage) || PAR_PAGE), 1), 200);
  const numero = Math.max(Math.round(Number(page) || 1), 1);
  return { page: numero, parPage: taille, skip: (numero - 1) * taille, take: taille };
}

/** `?page=2&parPage=50` d'une adresse. */
export function lirePage(parametres: URLSearchParams): Tranche {
  return tranche(parametres.get("page"), parametres.get("parPage"));
}
