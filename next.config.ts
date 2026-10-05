import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build 100 % statique : le dossier `out/` est déployable tel quel sur le VPS Coolify,
  // derrière un simple Nginx. Aucune fonction serveur, aucune route dynamique.
  // Contrainte structurante : pas de routes `/[id]` ni de Route Handlers.
  // → 4 routes fixes, l'identifiant du match passe en query param (`/match?m=<uuid>`).
  output: "export",

  // `/match/?m=x` est servi par `out/match/index.html` : URL compatible avec
  // n'importe quel hébergeur statique sans règle de réécriture.
  trailingSlash: true,

  // L'app est entièrement pilotée côté client (IndexedDB + Supabase).
  // L'optimisation d'images est incompatible avec `output: 'export'` et l'app
  // n'a aucune image de contenu.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
