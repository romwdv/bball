"use client";

import { useEffect } from "react";

/**
 * Enregistrement du service worker.
 *
 * Le composant ne porte volontairement pas le nom `ServiceWorkerRegistration` :
 * c'est un type global de TypeScript, et l'utiliser comme nom de composant
 * masquerait la confusion plutôt que de la révéler.
 *
 * Monté **une seule fois**, dans `layout.tsx`, et nulle part ailleurs. Un
 * enregistrement répété n'est pas idempotent côté navigateur : il réinstalle le
 * worker et vide son pré-cache, ce qui se traduit par une app inutilisable
 * hors-ligne pendant une seconde, en plein match.
 *
 * Trois décisions, chacune dictée par une contrainte du navigateur.
 *
 * **L'enregistrement attend le chargement.** Avant `load`, un enregistrement
 * concurrence le téléchargement des bundles qu'il doit précacher : sur une
 * connexion de gymnase, la moitié du pré-cache échoue et l'app ne démarre jamais
 * hors-ligne ensuite.
 *
 * **Un échec n'est pas une erreur visible.** Pas de réseau au premier lancement
 * est le cas *normal* ici, pas la panne. Remonter l'échec à l'écran afficherait
 * une alerte au coach pour quelque chose qui se résoudra tout seul au prochain
 * lancement en ligne.
 *
 * **La production seulement.** En développement, un service worker précache les
 * bundles de développement, qui changent à chaque modification : le coach testerait
 * l'ancienne version, sans le savoir. `process.env.NODE_ENV` est figé au build,
 * donc la condition est vraie ou fausse à jamais — pas une lecture à chaque rendu.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (error) {
        // Journalisé et non propagé : un `throw` ici ferait échouer le rendu de
        // toute l'app alors qu'elle fonctionne parfaitement en ligne.
        console.warn("Enregistrement du service worker impossible", error);
      }
    };

    const onLoad = () => {
      if (!cancelled) void register();
    };

    // `document.readyState` peut déjà valoir `complete` au moment de l'effet —
    // cas d'un retour en arrière cache, ou d'une navigation rapide. Dans ce cas
    // `load` ne se reproduira pas et le service worker ne serait jamais
    // enregistré.
    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", onLoad);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
    };
  }, []);

  return null;
}
