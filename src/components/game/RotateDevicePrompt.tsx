import { useState } from "react";
import { Maximize2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canEnterGameFullscreen, enterGameFullscreen } from "@/lib/fullscreen";

// Shown by CSS only on portrait phones; playing in portrait stays possible.
export default function RotateDevicePrompt() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section className="arcade-rotate-prompt" aria-labelledby="rotate-prompt-title">
      <RotateCw className="arcade-rotate-icon" aria-hidden="true" />
      <h2 id="rotate-prompt-title">Gira il telefono</h2>
      <p>Il tavolo dà il meglio in orizzontale.</p>
      {canEnterGameFullscreen() && (
        <Button onClick={() => void enterGameFullscreen()}>
          <Maximize2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Gioca a schermo intero
        </Button>
      )}
      <Button variant="ghost" onClick={() => setDismissed(true)}>
        Continua in verticale
      </Button>
    </section>
  );
}
