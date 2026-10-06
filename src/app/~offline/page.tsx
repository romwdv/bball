/**
 * Page de repli hors-ligne.
 *
 * Elle n'est atteinte que dans un cas rare et particulier : une navigation vers
 * une route **jamais ouverte**, avec le réseau absent. Tout le reste — `/`, un
 * match en cours, l'historique — est servi depuis le pré-cache, parce que le
 * service worker a précaché le HTML de chaque route au premier lancement.
 *
 * Deux conséquences expliquent son contenu.
 *
 * **Elle n'affiche aucun bouton « Réessayer ».** Le coach est en gymnase, sans
 * réseau, devant des joueurs qui attendent : un bouton qui échoue est pire
 * qu'aucun bouton. Le message dit ce qui se passe et ce qui fonctionne encore.
 *
 * **Elle est volontairement statique.** Pas de store, pas d'accès à la base, pas
 * d'`AuthGate`. Cette page doit s'afficher avant toute vérification — y compris
 * quand le téléphone est en mode avion depuis le lancement. Si elle dépendait
 * d'IndexedDB ou d'une session, elle échouerait précisément dans le seul cas où
 * elle sert. C'est la seule route du projet qui s'en passe, et c'est délibéré.
 */
export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-accent">
        Hors-ligne
      </p>
      <h1 className="text-xl font-semibold">
        Pas de réseau, pas de nouvelle page
      </h1>
      <p className="text-sm text-secondary">
        Les matchs déjà ouverts restent accessibles, et tout ce que vous
        saisissez est enregistré sur ce téléphone. La synchronisation reprendra
        dès que le réseau reviendra.
      </p>
    </main>
  );
}
