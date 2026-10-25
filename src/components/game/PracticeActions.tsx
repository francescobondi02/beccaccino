import { Loader2, LogOut, Pause } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface PracticeActionsProps {
  isPausing: boolean;
  isLeaving: boolean;
  onPause: () => void;
  onLeave: () => void;
}

export default function PracticeActions({
  isPausing,
  isLeaving,
  onPause,
  onLeave,
}: PracticeActionsProps) {
  return (
    <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
      <Button
        variant="outline"
        size="sm"
        onClick={onPause}
        disabled={isPausing || isLeaving}
        aria-label="Pausa e torna alla home"
        data-testid="pause-practice-button"
      >
        {isPausing ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Pause className="mr-2 h-4 w-4" />
        )}
        <span className="arcade-tool-label">Pausa<span className="hidden sm:inline"> e torna alla home</span></span>
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            disabled={isPausing || isLeaving}
            data-testid="abandon-practice-button"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span className="arcade-tool-label">Abbandona</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Abbandonare l'allenamento?</AlertDialogTitle>
            <AlertDialogDescription>
              La partita verrà chiusa e non potrai riprenderla.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={onLeave}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Abbandona
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
