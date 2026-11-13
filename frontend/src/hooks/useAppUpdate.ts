import { useEffect } from "react";
import { toast } from "sonner";

export function useAppUpdate() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let active = true;
    let notified = false;

    const check = async () => {
      if (document.visibilityState === "hidden" || notified) return;

      try {
        const response = await fetch("/version.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`Version check failed: ${response.status}`);
        const data: unknown = await response.json();
        if (
          !data || typeof data !== "object" || !("version" in data) ||
          typeof data.version !== "string" || !data.version
        ) {
          throw new Error("Invalid app version");
        }
        if (!active || notified || data.version === import.meta.env.VITE_APP_VERSION) return;

        notified = true;
        toast("Aggiornamento disponibile", {
          id: "app-update",
          duration: Infinity,
          description: "Ricarica la pagina quando vuoi, anche a fine partita.",
          action: {
            label: "Ricarica",
            onClick: () => window.location.reload(),
          },
        });
      } catch (error) {
        console.warn("Unable to check for app updates:", error);
      }
    };

    void check();
    const interval = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
}
