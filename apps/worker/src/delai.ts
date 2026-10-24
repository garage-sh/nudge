/**
 * Rend le résultat de `appel`, ou rejette avec l'erreur d'`expiration` si `delaiMs`
 * s'écoule avant : le signal passé à `appel` est alors annulé avec cette même erreur,
 * pour que l'appel en cours ne continue pas de courir.
 */
export async function avecDelai<T>(
  delaiMs: number,
  expiration: () => Error,
  appel: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const annulation = new AbortController();
  let minuteur: NodeJS.Timeout | undefined;
  const expire = new Promise<never>((_, reject) => {
    minuteur = setTimeout(() => {
      const erreur = expiration();
      annulation.abort(erreur);
      reject(erreur);
    }, delaiMs);
  });
  try {
    return await Promise.race([appel(annulation.signal), expire]);
  } finally {
    clearTimeout(minuteur);
  }
}
