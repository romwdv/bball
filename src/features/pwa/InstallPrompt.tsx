"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Invite à installer l'application.
 *
 * iOS et Android n'offrent pas la même chose, et c'est la raison pour laquelle il
 * y a deux écrans dans un seul composant.
 *
 * **Android / Chrome** : l'événement `beforeinstallprompt` est capté, et le
 * dialogue natif d'installation ne peut être déclenché que depuis ce gestionnaire.
 * Le stocker est donc obligatoire — l'événement ne se produit qu'une fois, et
 * le laisser filer le perd définitivement pour cette session. Le bouton appelle
 * alors `prompt()`, qui ouvre le dialogue natif.
 *
 * **iOS / Safari** : **aucune API n'existe**. `beforeinstallprompt` ne se produit
 * jamais, et Safari n'a pas d'équivalent. Le seul chemin est « Partager →
 * Sur l'écran d'accueil », que seul l'utilisateur peut faire. L'écran se contente
 * donc de l'expliquer, étape par étape.
 *
 * Une troisième situation : **déjà installée**. Le banner disparaît alors — et
 * c'est la seule chose que le navigateur dise, via `display-mode: standalone`.
 */
type Platform =
  /** Rien à proposer : déjà installée, ou navigateur sans support. */
  | "none"
  /** L'événement de promesse a été capturé : un vrai dialogue est possible. */
  | "native"
  /** iOS : il faut expliquer la marche à suivre. */
  | "ios";

/** Interface de l'événement, que les types DOM de TypeScript ne décrivent pas. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Safari sur iOS se distingue par le moteur, pas par l'agent utilisateur.
 *
 * Tester `navigator.userAgent.includes("Safari")` exclurait Chrome sur iOS — qui,
 * lui, **a** `beforeinstallprompt` et peut installer l'app nativement. La
 * distinction juste est « le moteur est WebKit et il n'y a pas de module », ce que
 * `standalone` permet de vérifier indirectement.
 */
function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  // iPadOS 13+ se déclare comme un Mac : sans ce test, un iPad passerait pour un
  // Mac et l'écran d'installation ne s'afficherait jamais.
  const iPadOs =
    navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent);
  return ios || iPadOs;
}

/** L'application tourne-t-elle déjà en fenêtre autonome ? */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS ne remonte pas `display-mode` avant iOS 16.4 : ce marqueur posé par
    // Safari est le seul signal disponible, et il fait autorité.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function InstallPrompt() {
  /**
   * Plateforme réellement offerte au coach.
   *
   * Démarre à la détection — iOS, ou « rien » — puis passe à `"native"` quand
   * l'événement d'installation est capturé. Un seul état, pas deux : les deux
   * sources d'information décrivent la même chose, et deux états exigeraient de
   * les réconcilier, donc une troisième combinaison impossible à représenter.
   */
  const [platform, setPlatform] = useState<Platform>("none");
  const [dismissed, setDismissed] = useState(false);
  const promptEventRef = useRef<BeforeInstallPromptEvent | null>(null);

  // L'état est lu au montage, jamais pendant le rendu : `isStandalone` et
  // `isIos` interrogent le navigateur, et les appeler dans le corps du composant
  // renverrait une valeur différente d'un rendu à l'autre.
  //
  // `installed` est distinct de « rien à proposer » : c'est le seul cas où
  // l'écoute de l'événement est inutile, puisqu'aucun dialogue natif ne peut
  // plus être demandé.
  const [installed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return isStandalone();
  });
  const [onIos] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return isIos();
  });

  useEffect(() => {
    // Déjà installée : plus rien à proposer, et surtout plus rien à écouter.
    if (installed) return;

    // ⚠️ L'écoute est posée **inconditionnellement**, y compris sur Android.
    // L'ignorer parce qu'aucune invitation n'est encore affichée était un bug :
    // l'événement ne se produit qu'une fois, et rien ne le rejoue. Le coach
    // n'aurait donc jamais vu le bouton « Installer » sur Android — le seul
    // navigateur où un dialogue natif existe.
    const onBeforeInstall = (event: Event) => {
      // Sans `preventDefault`, Chrome affiche son propre dialogue — à un moment
      // que l'application ne choisit pas, souvent au pire. Le convoquer permet
      // de le proposer au bon endroit, et de ne pas le proposer du tout.
      event.preventDefault();
      // Une `ref`, pas un état : l'événement est une donnée, pas un rendu. Dans
      // un état, il serait consommé au premier tap et perdu au deuxième, alors
      // qu'il n'est utilisable qu'une fois.
      promptEventRef.current = event as BeforeInstallPromptEvent;
      setPlatform("native");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, [installed]);

  // Deux sources décrivent la même chose : l'invite est affichée si iOS le permet
  // par gestes manuels, **ou** si un dialogue natif a été capturé. `platform`
  // ne change qu'à l'arrivée de l'événement, donc pas de réconciliation à faire.
  const visible: Platform =
    platform === "native" ? "native" : onIos ? "ios" : "none";

  if (visible === "none" || dismissed) return null;

  if (visible === "ios") {
    return (
      <aside
        aria-label="Installation sur l’écran d’accueil"
        className="flex flex-col gap-2 rounded-xl border border-edge bg-raised px-4 py-3 text-sm"
      >
        <p className="font-medium">
          Ajoutez l’app à l’écran d’accueil pour l’ouvrir sans navigateur.
        </p>
        {/* Les deux gestes réels sur iOS : le bouton de partage du Safari, puis
            la ligne « Sur l'écran d'accueil » du menu qui s'ouvre. Écrire « le
            bouton + » serait faux sur iOS 16, où le partage est une icône. */}
        <p className="text-xs text-secondary">
          Touchez Partager, puis « Sur l’écran d’accueil ». L’app s’ouvrira
          ensuite en plein écran, et fonctionnera sans connexion.
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="min-h-tap-min self-start rounded-lg border border-edge px-3 text-xs text-secondary"
        >
          Masquer
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Installation de l'application"
      className="flex items-center gap-2 rounded-xl border border-edge bg-raised px-4 py-3"
    >
      <span className="flex-1 text-sm">Ajoutez l’app à l’écran d’accueil.</span>
      <button
        type="button"
        onClick={async () => {
          const event = promptEventRef.current;
          // L'événement ne peut être consommé qu'une fois : le rappeler après
          // l'avoir montré ferait lever une erreur sur le tap suivant. Vider la
          // référence **avant** d'attendre est donc l'ordre sûr — si le coach appuie
          // deux fois vite, le second tap prend le chemin « plus tard » au lieu de
          // lever.
          if (event === null) {
            setDismissed(true);
            return;
          }
          promptEventRef.current = null;
          await event.prompt();
          await event.userChoice;
          setDismissed(true);
        }}
        className="min-h-tap-min rounded-lg bg-accent px-4 text-sm font-medium text-inverse"
      >
        Installer
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="min-h-tap-min rounded-lg border border-edge px-3 text-xs text-secondary"
      >
        Plus tard
      </button>
    </aside>
  );
}
