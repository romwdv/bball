/**
 * Formatage des dates pour l'affichage.
 *
 * Isolé dans son propre module parce que trois écrans l'utilisent (accueil,
 * création de match, saisie) et qu'un composant de page ne doit jamais être
 * importé par un autre : `src/app/page.tsx` est une route Next, l'importer
 * depuis une page tirait le composant entier dans le bundle de la seconde.
 */

/** `2026-10-05` → `05/10/2026`. Le format ISO n'est pas lisible en bord de terrain. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (year === undefined || month === undefined || day === undefined)
    return iso;
  return `${day}/${month}/${year}`;
}

/** Date du jour au format `YYYY-MM-DD`, en heure locale. */
export function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
