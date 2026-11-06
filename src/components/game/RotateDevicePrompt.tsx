import { useSyncExternalStore } from "react";
import { Maximize2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canEnterGameFullscreen, enterGameFullscreen } from "@/lib/fullscreen";

const PORTRAIT_TOUCH = "(pointer: coarse) and (orientation: portrait)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(PORTRAIT_TOUCH);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export default function RotateDevicePrompt() {
  const portrait = useSyncExternalStore(subscribe, () => window.matchMedia(PORTRAIT_TOUCH).matches);
  return (
    <Dialog open={portrait}>
      <DialogContent
        className="arcade-orientation-dialog text-center [&>button:last-child]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <RotateCw className="arcade-rotate-icon mx-auto" aria-hidden="true" />
        <DialogHeader className="text-center">
          <DialogTitle>Gira il telefono</DialogTitle>
          <DialogDescription>BECCA si gioca in orizzontale. Ruota il telefono per continuare.</DialogDescription>
        </DialogHeader>
        {canEnterGameFullscreen() && (
          <div><Button onClick={() => void enterGameFullscreen()}>
            <Maximize2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Apri a schermo intero
          </Button></div>
        )}
      </DialogContent>
    </Dialog>
  );
}
