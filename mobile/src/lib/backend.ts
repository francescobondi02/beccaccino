export function backendOrigin(backendUrl: string | undefined): URL {
  if (!backendUrl?.trim()) {
    throw new Error('Configura EXPO_PUBLIC_BACKEND_URL e riavvia Metro.');
  }

  let url: URL;
  try {
    url = new URL(backendUrl);
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

export async function checkBackendReadiness(
  backendUrl: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  const url = backendOrigin(backendUrl);
  const response = await fetch(new URL('/ready', url).toString(), { signal });
  if (!response.ok) {
    throw new Error(`Il server non è pronto (HTTP ${response.status}).`);
  }
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('status' in body) || body.status !== 'ready') {
    throw new Error('Il server ha restituito una risposta non riconosciuta.');
  }
}
