import type { Metadata, Viewport } from "next";
import { VUE_APPLICATION, metadonneesApplication } from "@/lib/application/installation";

/**
 * Application installable « Messages CoverSwap » : la messagerie SMS seule, sans
 * la navigation du CRM, avec son propre manifeste et sa propre icône. C'est
 * l'entrée que Lucas met à la place de sa messagerie sur l'écran d'accueil.
 */
export const metadata: Metadata = { ...metadonneesApplication("messages"), title: "Messages — CoverSwap" };
export const viewport: Viewport = VUE_APPLICATION;

export default function MessagerieLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-[100dvh] w-full overflow-hidden bg-[#16181D] text-[#F2F3F5] antialiased selection:bg-[#1D9E75]/30">{children}</div>;
}
