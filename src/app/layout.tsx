import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthGate } from "@/features/auth/AuthGate";
import { ServiceWorkerRegistrar } from "@/features/pwa/ServiceWorkerRegistration";
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
  // Chemin déclaré explicitement, et non laissé à la convention : le manifeste
  // est une route (`/manifest.json`) puisque `app/manifest.json` est prérendue.
  // C'est ce chemin que Nginx doit servir en `no-cache`, donc il doit figurer dans
  // le code plutôt que se déduire de la structure des dossiers.
  manifest: "/manifest.json",
  icons: {
    // Le favicon multi-tailles est déposé par `app/favicon.ico` et déclaré par
    // Next seul. Le déclarer ici aussi produirait deux liens `rel="icon"`, et le
    // navigateur en choisirait un au hasard.
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    // iOS ignore `icon` et ne lit que `apple-touch-icon`. Sans cette entrée, il
    // fait une capture d'écran de la page — avec la barre d'adresse, donc
    //prise pour une application non installée alors qu'elle l'est.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
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
      <body className="flex h-full min-h-0 flex-col bg-base text-primary">
        {/* Le garde-fou d'accès enveloppe *toutes* les routes, pas seulement `/` :
            `output: 'export'` interdit le verrouillage côté serveur, donc le seul
            endroit exhaustif est le composant racine. La route `/~offline` est la
            seule exception, et la raison y est documentée. */}
        <AuthGate>{children}</AuthGate>

        {/* Enregistre le service worker. Ne rend aucun élément : le composant ne
            fait qu'un effet, et le placer ici garantit un enregistrement unique
            pour toute l'application — un second enregistrement viderait le
            pré-cache en cours de partie. */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
