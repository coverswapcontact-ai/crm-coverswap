import type { Metadata, Viewport } from "next";

/**
 * Deux applications installables, une seule base de code :
 *   - « CoverSwap »          : le CRM complet, ouvert sur l'écran Commercial ;
 *   - « Messages CoverSwap » : la messagerie SMS, sans la navigation du CRM.
 * Chacune a son manifeste, son icône et ses écrans de démarrage. iOS lit le
 * manifeste et l'icône de la PAGE d'où l'on fait « Sur l'écran d'accueil » :
 * c'est le gabarit de chaque entrée qui porte ces métadonnées.
 */
export type ApplicationInstallable = "crm" | "messages";

/** Tailles d'écran des iPhone (points × densité) : voir scripts/generer-icones.mjs. */
const ECRANS_IPHONE = [
  [375, 667, 2],
  [414, 896, 2],
  [375, 812, 3],
  [414, 896, 3],
  [390, 844, 3],
  [428, 926, 3],
  [393, 852, 3],
  [430, 932, 3],
  [402, 874, 3],
  [440, 956, 3],
] as const;

export function metadonneesApplication(application: ApplicationInstallable): Metadata {
  const titre = application === "messages" ? "Messages" : "CoverSwap";
  return {
    manifest: `/manifest-${application}.webmanifest`,
    applicationName: application === "messages" ? "Messages CoverSwap" : "CoverSwap",
    appleWebApp: {
      capable: true,
      title: titre,
      statusBarStyle: "black-translucent",
      startupImage: ECRANS_IPHONE.map(([largeur, hauteur, densite]) => ({
        url: `/icones/demarrage-${application}-${largeur * densite}x${hauteur * densite}.png`,
        media: `(device-width: ${largeur}px) and (device-height: ${hauteur}px) and (-webkit-device-pixel-ratio: ${densite}) and (orientation: portrait)`,
      })),
    },
    icons: { icon: [{ url: `/icones/${application}-192.png`, sizes: "192x192", type: "image/png" }], apple: [{ url: `/icones/${application}-180.png`, sizes: "180x180" }] },
    other: { "mobile-web-app-capable": "yes" },
  };
}

/** Plein écran jusque sous l'encoche : les écrans réservent eux-mêmes les zones de sécurité. */
export const VUE_APPLICATION: Viewport = { themeColor: "#16181D", width: "device-width", initialScale: 1, viewportFit: "cover" };
