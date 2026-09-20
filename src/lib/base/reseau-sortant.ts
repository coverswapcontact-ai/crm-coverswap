import dns from "node:dns";
import net from "node:net";

/**
 * Réseau sortant : l'hébergeur n'a pas d'IPv6. Sans ce réglage, `fetch` essaie
 * chaque adresse 250 ms (sélection automatique de famille) et abandonne dès que
 * la latence dépasse ce délai — vu le 21/09/2026 vers Telegram : TCP en 155 ms,
 * `fetch failed ← ETIMEDOUT`. IPv4 d'abord, et une vraie patience par adresse.
 */
export function reglerReseauSortant(): void {
  dns.setDefaultResultOrder("ipv4first");
  net.setDefaultAutoSelectFamilyAttemptTimeout(2500);
}
