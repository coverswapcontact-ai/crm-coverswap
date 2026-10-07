import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CoverSwap CRM",
  description: "CRM de gestion pour CoverSwap - Rénovation intérieure par revêtements adhésifs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Mission 22 (correctifs du 07/10) : la ligne de réponse (règle 6) lit les jetons de la charte, 16 px, « Annuler » en zone de 44 px ; en v1 comme en v2 (une sécurité de lisibilité, pas un écran). */}
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            classNames: {
              toast: "bg-surface! text-texte! border-trait! text-corps!",
              title: "text-corps! font-semibold!",
              description: "text-corps! text-texte-2!",
              actionButton: "bg-action! text-action-texte! min-h-11! px-4! text-corps! font-semibold!",
              cancelButton: "bg-surface-2! text-texte! min-h-11! px-4! text-corps!",
              closeButton: "bg-surface! text-texte-2! border-trait!",
            },
          }}
        />
      </body>
    </html>
  );
}
