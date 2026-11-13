import { Send } from "lucide-react";
import {
  ANNOTATION_DIFFICULTIES,
  type AnnotationDifficulty,
} from "@/annotations/constants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface SkipCommentDialogProps {
  open: boolean;
  comment: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onCommentChange: (comment: string) => void;
  onContinue: () => void;
}

export function SkipCommentDialog({
  open,
  comment,
  isSubmitting,
  onOpenChange,
  onCommentChange,
  onContinue,
}: SkipCommentDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="z-[60] max-w-md bg-card">
        <DialogHeader>
          <DialogTitle>Aggiungi un commento</DialogTitle>
          <DialogDescription>Motivo del dubbio, opzionale.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="annotation-skip-comment">
            Perché non sei sicuro?
          </Label>
          <textarea
            id="annotation-skip-comment"
            className="flex min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={comment}
            maxLength={500}
            disabled={isSubmitting}
            onChange={(event) => onCommentChange(event.target.value)}
          />
          <p className="text-right text-xs tabular-nums text-muted-foreground">
            {Array.from(comment).length}/500
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Annulla
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={onContinue}
          >
            <Send className="h-4 w-4" />
            Continua
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DifficultyDialogProps {
  open: boolean;
  difficulty: AnnotationDifficulty | null;
  isSubmitting: boolean;
  errorMessage?: string | null;
  canLoadAnotherScenario: boolean;
  onOpenChange: (open: boolean) => void;
  onDifficultyChange: (difficulty: AnnotationDifficulty) => void;
  onLoadAnotherScenario?: () => void;
  onSubmit: () => void;
}

export function DifficultyDialog({
  open,
  difficulty,
  isSubmitting,
  errorMessage,
  canLoadAnotherScenario,
  onOpenChange,
  onDifficultyChange,
  onLoadAnotherScenario,
  onSubmit,
}: DifficultyDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="z-[70] max-w-md bg-card">
        <DialogHeader>
          <DialogTitle>Quanto era difficile?</DialogTitle>
          <DialogDescription>
            Valuta lo scenario indipendentemente dalla tua scelta.
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid grid-cols-3 gap-2"
          role="group"
          aria-label="Difficoltà percepita"
        >
          {ANNOTATION_DIFFICULTIES.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={difficulty === option.value ? "default" : "outline"}
              aria-pressed={difficulty === option.value}
              disabled={isSubmitting}
              onClick={() => onDifficultyChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {errorMessage && (
          <div
            className="space-y-3 border-l-4 border-destructive bg-destructive/5 px-3 py-2"
            role="alert"
          >
            <p className="text-sm text-destructive">{errorMessage}</p>
            {onLoadAnotherScenario && (
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={onLoadAnotherScenario}
              >
                Carica un altro scenario
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={!difficulty || isSubmitting || canLoadAnotherScenario}
            onClick={onSubmit}
          >
            <Send className="h-4 w-4" />
            {isSubmitting ? "Invio..." : "Invia risposta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
