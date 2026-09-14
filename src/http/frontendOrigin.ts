const LOCAL_FRONTEND_ORIGIN = "http://localhost:8081";

/**
 * The browser origin allowed to access the API and Socket.IO server.
 *
 * On Render's single-service deployment the platform exposes the service
 * hostname at runtime. A custom domain can always override it through FRONTEND_URL.
 */
export function frontendOrigin(): string {
  const configuredOrigin = process.env.FRONTEND_URL?.trim();
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");

  const renderHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  if (renderHostname) return `https://${renderHostname}`;

  return LOCAL_FRONTEND_ORIGIN;
}

export function hasProductionFrontendOrigin(): boolean {
  return Boolean(
    process.env.FRONTEND_URL?.trim() ||
      process.env.RENDER_EXTERNAL_HOSTNAME?.trim(),
  );
}
