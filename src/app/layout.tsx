import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthGate } from "@/features/auth/AuthGate";
import "./globals.css";

const APP_NAME = "Stats Basket";
const APP_DESCRIPTION =
  "Saisie des statistiques de match de basketball en bord de terrain, hors-ligne.";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0f14",
  // `viewport-fit=cover` est nécessaire pour que `env(safe-area-inset-*)` vaille
  // autre chose que 0px sur iPhone. Sans lui, la barre d'actions recouvre le bas.
  width: "device-width",
  initialScale: 1,
  // Empêche le zoom automatique sur le focus d'un champ : le coach saisit vite,
  // un zoom qui saute en pleine partie est le pire des échecs d'ergonomie.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className="h-full antialiased">
      {/* Le garde-fou d'accès enveloppe *toutes* les routes, pas seulement `/` :
          `output: 'export'` interdit le verrouillage côté serveur, donc le seul
          endroit exhaustif est le composant racine. */}
      <body className="flex h-full min-h-0 flex-col bg-base text-primary">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
