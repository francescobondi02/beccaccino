export const productionBackend = 'https://beccaccino-server.onrender.com';

// The app talks to production unless EXPO_PUBLIC_BACKEND_URL points elsewhere (e.g. .env.local in development).
export function backendOrigin(backendUrl: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(backendUrl?.trim() || productionBackend);
  } catch {
    throw new Error('EXPO_PUBLIC_BACKEND_URL deve essere un indirizzo valido.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash
  ) {
    throw new Error('Usa solo l’origine del backend, senza credenziali, percorso o parametri.');
  }
  if (!__DEV__ && url.protocol !== 'https:') {
    throw new Error('Le build di distribuzione richiedono un backend HTTPS.');
  }
  return url;
}
