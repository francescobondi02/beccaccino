import { Loader2, LogOut, Play } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface PausedPracticeDialogProps {
  open: boolean;
  confirmAbandon: boolean;
  isLeaving: boolean;
  isResuming: boolean;
  onCancelAbandon: () => void;
  onConfirmAbandon: () => void;
  onRequestAbandon: () => void;
  onResume: () => void;
}

export default function PausedPracticeDialog({
  open,
  confirmAbandon,
  isLeaving,
  isResuming,
  onCancelAbandon,
  onConfirmAbandon,
  onRequestAbandon,
  onResume,
}: PausedPracticeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={() => {}}>
      <AlertDialogContent
        className="bg-card"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmAbandon
              ? "Abbandonare l'allenamento?"
              : "Allenamento in pausa"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmAbandon
              ? "La partita verrà chiusa e non potrai riprenderla."
              : "Riprendi la partita oppure abbandonala definitivamente."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {confirmAbandon ? (
            <>
              <Button
                variant="outline"
                onClick={onCancelAbandon}
                disabled={isLeaving}
              >
                Annulla
              </Button>
              <Button
                variant="destructive"
                onClick={onConfirmAbandon}
                disabled={isLeaving}
              >
                {isLeaving && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Abbandona definitivamente
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={onRequestAbandon}
                disabled={isResuming}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Abbandona
              </Button>
              <Button onClick={onResume} disabled={isResuming}>
                {isResuming ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Riprendi
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
