"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { useAuthStore } from "@/features/auth/store";
import { claimTeam, type ClaimResult } from "@/sync/claim";
import { startSync, stopSync } from "@/sync/engine";

/**
 * Garde-fou d'accès — le compte est obligatoire (PLAN.md §5).
 *
 * Sans session, l'application **ne rend pas** les écrans de saisie : ni la
 * grille, ni l'historique, ni les statistiques. Ce n'est pas une redirection
 * vers `/`, c'est un verrou. La raison est celle du plan, et elle tient sans
 * exception : une saisie faite sans compte produirait un match que rien ne
 * synchroniserait jamais, et le coach l'aurait vérifié en fin de partie.
 *
 * `output: 'export'` interdit tout verrouillage côté serveur — pas de
 * middleware, pas de route handler. Le choix est donc reporté sur le composant
 * racine, ce qui est la seule façon d'être exhaustif : un garde posé sur chaque
 * page laisserait passer la suivante.
 *
 * L'ordre des opérations au démarrage est la partie délicate :
 *
 *   1. `init()` récupère la session (localStorage, donc disponible hors-ligne) ;
 *   2. `claimTeam()` rattache les données locales au compte — **avant** tout
 *      rendu d'écran, sinon une page lirait `teamId: "local"` et le moteur
 *      pousserait une clé qui n'est pas un `uuid` ;
 *   3. `startSync()` ouvre le cycle de 30 s.
 *
 * L'écran d'attente couvre ces deux étapes : une fraction de seconde en général,
 * le temps d'un aller-retour réseau la première fois.
 */

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const session = useAuthStore((state) => state.session);
  const recovering = useAuthStore((state) => state.recovering);
  const init = useAuthStore((state) => state.init);

  const userId = session?.userId ?? null;

  // Rattachement **en cours pour quel compte**, pas un simple booléen. Couplé au
  // `userId` et non à `session` : un rafraîchissement de jeton produit un nouvel
  // objet session sans changer de compte, et relancerait un rattachement
  // inutile — sur un terrain où le réseau est faible, une requête de plus au
  // démarrage est une seconde d'attente en plus.
  const [attachedFor, setAttachedFor] = useState<string | null>(null);
  /**
   * Compte propriétaire des données déjà présentes sur l'appareil.
   *
   * Un simple `boolean` suffirait pour l'affichage, mais le `uid` permet de nommer
   * le compte à utiliser — et surtout d'éviter qu'un second compte puisse être
   * pris pour le bon par un岔ultat.
   */
  const [conflictWith, setConflictWith] = useState<string | null>(null);

  // Dérivé, jamais stocké en booléen : un booléen ne saurait pas *quel* compte a
  // été rattaché, donc changer de session sans repasser par `null` laisserait
  // l'app ouverte sur l'équipe du compte précédent. Un identifiant comparé à
  // `userId` rend l'état impossible à désynchroniser.
  const attached = userId !== null && attachedFor === userId;

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (userId === null) {
      stopSync();
      return;
    }

    let cancelled = false;

    void claimTeam(userId)
      .then((result: ClaimResult) => {
        if (cancelled) return;
        if (result.status === "conflict") {
          setConflictWith(result.ownerId);
          return;
        }
        setConflictWith(null);
        setAttachedFor(userId);
        startSync();
      })
      .catch(() => {
        // Un rattachement raté ne doit pas bloquer l'app indéfiniment : on
        // laisse l'écran s'ouvrir, et la synchronisation repartira au cycle
        // suivant, où l'échec sera visible sur le voyant.
        if (!cancelled) setAttachedFor(userId);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (conflictWith !== null) return <ForeignAccount />;

  if (status === "loading") return <Splash label="Ouverture…" />;

  if (status === "unconfigured") return <AuthScreen />;

  if (status === "signed-out") return <AuthScreen />;

  if (recovering) return <AuthScreen />;

  if (!attached) return <Splash label="Préparation de l'équipe…" />;

  return <>{children}</>;
}

/**
 * Appareil rattaché à un autre compte.
 *
 * Un état bloquant, et non un avertissement : laisser la saisie se poursuivre
 * produirait des matchs que les politiques RLS refuseront de remonter, donc des
 * données perdues sans aucun signe. Deux issues seulement — se reconnecter avec le
 * bon compte, ou repartir d'un appareil vide.
 */
function ForeignAccount() {
  const signOut = useAuthStore((state) => state.signOut);

  return (
    <main className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">
        Cet appareil belong à un autre compte
      </h1>
      <p className="text-sm text-secondary">
        Des matchs y sont enregistrés pour un autre compte. Connectez-vous avec
        ce compte pour y retrouver, ou utilisez un autre appareil.
      </p>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
        className="min-h-tap-action rounded-xl bg-accent font-semibold text-inverse"
      >
        Revenir à la connexion
      </button>
    </main>
  );
}

function Splash({ label }: { label: string }) {
  return (
    <main className="flex flex-1 items-center justify-center text-secondary">
      {label}
    </main>
  );
}
