/**
 * Téléchargement d'un fichier généré côté client.
 *
 * La PWA est 100 % statique : il n'existe aucun endpoint pour générer un export.
 * Le fichier est donc fabriqué dans le navigateur, et le téléchargement passe par
 * un lien éphémère — c'est la seule façon de déclencher un enregistrement depuis
 * du JavaScript sans serveur.
 *
 * `revokeObjectURL` est volontairement différé : révoquer immédiatement annule
 * le téléchargement sur certains navigateurs, car le téléchargement démarre
 * seulement quand le navigateur a fini de lire l'URL.
 */

export interface DownloadOptions {
  filename: string;
  content: string;
  mime: string;
}

export function downloadText({
  filename,
  content,
  mime,
}: DownloadOptions): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * MIME avec `charset=utf-8` explicite : sans lui, certains navigateurs décodent
 * le CSV en latin-1 et les accents du nom de l'adversaire deviennent illisibles.
 */
export const CSV_MIME = "text/csv;charset=utf-8";
export const JSON_MIME = "application/json;charset=utf-8";
