import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallPrompt } from "@/features/pwa/InstallPrompt";
import { ServiceWorkerRegistrar } from "@/features/pwa/ServiceWorkerRegistration";

/**
 * Tests des composants PWA.
 *
 * Ces deux composants ont une propriété commune qui les rend difficiles à tester
 * autrement : ils dépendent d'API **du navigateur**, absentes de jsdom ou
 * invérifiables par un test E2E. `serviceWorker.register` n'existe pas dans
 * jsdom, et `beforeinstallprompt` n'est émis par aucun navigateur en test
 * automatisé.
 *
 * Les E2E de `tests/e2e/offline.spec.ts` couvrent le **résultat** — l'app
 * fonctionne sans réseau. Ces tests-unitaires couvrent les **décisions** : quand
 * enregistrer, quand proposer l'installation, que faire quand le coach refuse.
 * Le comportement restant non couvert par les E2E est exactement celui qui
 * dépende d'un dialogue natif.
 */

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Faux `navigator.serviceWorker`, avec un `register` observable. */
function stubServiceWorker() {
  const register = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register },
    configurable: true,
    writable: true,
  });
  return register;
}

/** Simule un événement `beforeinstallprompt`, avec ses deux méthodes. */
async function emitBeforeInstallPrompt() {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const userChoice = Promise.resolve({ outcome: "accepted" as const });
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, { prompt, userChoice });

  await act(async () => {
    window.dispatchEvent(event);
  });

  return { event, prompt, userChoice };
}

// ---------------------------------------------------------------------------

describe("enregistrement du service worker", () => {
  it("enregistre en production", async () => {
    const register = stubServiceWorker();

    render(<ServiceWorkerRegistrar />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("n'enregistre pas en développement", async () => {
    // Un service worker qui précache les bundles de développement servirait une
    // version périmée sans que rien ne l'indique : le coach testerait l'ancienne
    // application, et croirait à un bug.
    vi.stubEnv("NODE_ENV", "development");
    const register = stubServiceWorker();

    render(<ServiceWorkerRegistrar />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(register).not.toHaveBeenCalled();
  });

  it("n'échoue pas quand le navigateur ne gère pas les service workers", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });

    // Rendu sans erreur : c'est le contrat. Le composant ne rend rien, donc une
    // exception ici remonterait dans l'arbre et laisserait l'application à moitié
    // montée sur un navigateur ancien.
    expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow();
  });

  it("ne propage pas un échec d'enregistrement", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubServiceWorker();
    vi.mocked(navigator.serviceWorker.register).mockRejectedValue(
      new Error("sécurité insuffisante"),
    );

    render(<ServiceWorkerRegistrar />);
    await act(async () => {
      await Promise.resolve();
    });

    // Pas de réseau au premier lancement est le cas *normal* ici. Remonter
    // l'échec à l'écran afficherait une alerte pour quelque chose qui se résout
    // au lancement suivant.
    expect(warn).toHaveBeenCalled();
  });

  it("enregistre tout de suite si le document est déjà chargé", async () => {
    // jsdom est en `complete` : `load` ne se reproduira pas, donc attendre
    // l'événement reviendrait à ne jamais enregistrer.
    expect(document.readyState).toBe("complete");
    const register = stubServiceWorker();

    render(<ServiceWorkerRegistrar />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(register).toHaveBeenCalled();
  });

  it("diffère à `load` tant que le document se charge", async () => {
    // Préparer l'état « en cours de chargement » : c'est le cas le plus courant,
    // et celui où enregistrer trop tôt concurrence le téléchargement des bundles
    // que le pré-cache doit ensuite récupérer.
    Object.defineProperty(document, "readyState", {
      value: "loading",
      configurable: true,
    });

    const register = stubServiceWorker();
    const { unmount } = render(<ServiceWorkerRegistrar />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(register).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("load"));
      await Promise.resolve();
    });
    expect(register).toHaveBeenCalled();
    unmount();

    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });
  });

  it("retire l'écouteur au démontage", async () => {
    Object.defineProperty(document, "readyState", {
      value: "loading",
      configurable: true,
    });
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    stubServiceWorker();

    const { unmount } = render(<ServiceWorkerRegistrar />);
    unmount();

    // Sans retrait, un démontage suivi d'un remontage cumulerait deux
    // enregistrements — et le second viderait le pré-cache en pleine partie.
    expect(removeEventListener).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
    );

    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });
  });
});

// ---------------------------------------------------------------------------

describe("invite à installer", () => {
  /** `display-mode: standalone` : faux = l'app n'est pas installée. */
  function stubDisplayMode(standalone: boolean) {
    Object.defineProperty(window, "matchMedia", {
      value: (query: string) => ({
        matches: standalone && query.includes("standalone"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      configurable: true,
      writable: true,
    });
  }

  function stubIos(isIos: boolean) {
    Object.defineProperty(navigator, "userAgent", {
      value: isIos
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
        : "Mozilla/5.0 (Linux; Android 14) Chrome/120",
      configurable: true,
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: isIos ? 5 : 1,
      configurable: true,
    });
  }

  it("ne s'affiche pas quand l'app est déjà installée", async () => {
    stubDisplayMode(true);
    stubIos(false);

    const { container } = render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    // Déjà sur l'écran d'accueil : proposer l'installation serait absurde.
    expect(container).toBeEmptyDOMElement();
  });

  it("ne s'affiche pas sur Android avant l'événement", async () => {
    stubDisplayMode(false);
    stubIos(false);

    const { container } = render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    // Chrome n'émet `beforeinstallprompt` que si les critères d'installabilité
    // sont remplis. Sans événement, aucune invitation n'a de sens : proposer un
    // bouton « Installer » qui ne ferait rien serait pire que rien.
    expect(container).toBeEmptyDOMElement();
  });

  it("propose l'installation après `beforeinstallprompt`", async () => {
    stubDisplayMode(false);
    stubIos(false);
    render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    await emitBeforeInstallPrompt();

    expect(screen.getByRole("button", { name: "Installer" })).toBeVisible();
  });

  it("empêche le dialogue natif de s'ouvrir tout seul", async () => {
    stubDisplayMode(false);
    stubIos(false);
    render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    const { event } = await emitBeforeInstallPrompt();

    // Sans `preventDefault`, Chrome affiche son dialogue au moment de son
    // choix — souvent au pire, par exemple au milieu d'une saisie.
    expect(event.defaultPrevented).toBe(true);
  });

  it("déclenche le dialogue natif au tap", async () => {
    stubDisplayMode(false);
    stubIos(false);
    render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    const { prompt, userChoice } = await emitBeforeInstallPrompt();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Installer" }));
    });

    expect(prompt).toHaveBeenCalled();
    await expect(userChoice).resolves.toMatchObject({ outcome: "accepted" });
    // Le bouton disparaît après le choix : quoi qu'il ait décidé, l'invite a été
    // consommée et l'événement ne peut être rejoué.
    expect(screen.queryByRole("button", { name: "Installer" })).toBeNull();
  });

  it("se masque sur « Plus tard »", async () => {
    stubDisplayMode(false);
    stubIos(false);
    render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });
    await emitBeforeInstallPrompt();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Plus tard" }));
    });

    // Un refus est un refus : l'invite ne revient pas à la prochaine visite.
    expect(screen.queryByRole("button", { name: "Installer" })).toBeNull();
  });

  it("se masque si l'événement n'est plus disponible au tap", async () => {
    stubDisplayMode(false);
    stubIos(false);
    render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });
    await emitBeforeInstallPrompt();

    // Le coach appuie deux fois très vite : la référence a déjà été vidée par le
    // premier tap. Le second doit se comporter comme un refus, pas lever.
    const install = screen.getByRole("button", { name: "Installer" });
    await act(async () => {
      install.click();
    });
    await act(async () => {
      install.click();
    });

    expect(screen.queryByRole("button", { name: "Installer" })).toBeNull();
  });

  it("explique la marche à suivre sur iOS", async () => {
    stubDisplayMode(false);
    stubIos(true);

    render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    // iOS n'a **aucune** API d'installation : seul le coach peut faire
    // Partager → Sur l'écran d'accueil. L'écran doit donc l'expliquer, pas
    // afficher un bouton qui ne pourrait rien déclencher.
    expect(screen.getByText(/Sur l’écran d’accueil/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Installer" })).toBeNull();
  });

  it("reconnaît un iPad se déclarant comme un Mac", async () => {
    stubDisplayMode(false);
    Object.defineProperty(navigator, "userAgent", {
      // iPadOS 13+ se présente comme un Mac : sans le test du nombre de points de
      // contact, l'écran d'installation ne s'afficherait jamais sur iPad.
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: 5,
      configurable: true,
    });

    render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Sur l’écran d’accueil/)).toBeVisible();
  });

  it("s'efface sur iOS après « Masquer »", async () => {
    stubDisplayMode(false);
    stubIos(true);

    render(<InstallPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Masquer" }));
    });

    expect(screen.queryByText(/Sur l’écran d’accueil/)).toBeNull();
  });
});
