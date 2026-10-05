/**
 * Génération d'identifiants côté client.
 *
 * Le `id` d'une action est généré **avant** l'écriture locale, jamais par la base.
 * Deux raisons, toutes deux structurantes :
 *
 * 1. **Déduplication à la synchronisation.** Un upsert Supabase porte sur `id` :
 *    réessayer le même envoi ne crée pas de doublon, que l'échec soit réseau ou
 *    pas. Un identifiant généré à la volée par le serveur rendrait l'idempotence
 *    impossible.
 * 2. **Écriture optimiste.** L'action peut être affichée à l'écran avant même
 *    d'être persistée ; l'identifiant existe donc dès le geste du coach.
 */

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Identifiant unique au format UUID v4.
 *
 * `crypto.randomUUID` est utilisé quand il est disponible. En repli, on compose
 * le même format depuis `crypto.getRandomValues`, lui aussi présent sur toutes
 * les cibles (iOS 15.4+, Chrome 92+). Le format est respecté dans les deux cas :
 * les UUID sont stockés en texte, et une migration future qui chercherait à les
 * trier n'aurait pas à traiter deux conventions.
 */
export function newId(): string {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  // Les bits 4-7 de l'octet 6 (version) et 2-7 de l'octet 8 (variante) sont
  // imposés par la RFC 4122 : sans cela, l'identifiant n'est pas un UUID v4.
  // `noUncheckedIndexedAccess` voit l'accès au tableau comme `number | undefined`
  // alors que la taille est fixe à 16 : les assertions sont donc justifiées.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/** L'identifiant est-il un UUID v4 ? Utilisé par les tests et les garde-fous. */
export function isUuid(value: string): boolean {
  return UUID_V4.test(value);
}
