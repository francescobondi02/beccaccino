import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Signal } from "@/game/model";

interface SignalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (signal: Signal | null) => void;
}

const signals = [
  {
    value: "striscio" as const,
    label: "Striscio",
    description:
      "Inclusa la carta giocata, ho almeno 3 carte di questo seme",
    color: "bg-green-500/10 border-green-500/30 hover:bg-green-500/20",
  },
  {
    value: "busso" as const,
    label: "Busso",
    description: "Gioca la carta più alta di questo seme",
    color: "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20",
  },
  {
    value: "volo" as const,
    label: "Volo",
    description: "Non ho più carte di questo seme",
    color: "bg-red-500/10 border-red-500/30 hover:bg-red-500/20",
  },
];

const SignalDialog = ({ open, onOpenChange, onSelect }: SignalDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="arcade-signal-dialog sm:max-w-sm border-[hsl(39_45%_50%_/_0.7)] bg-card shadow-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-lg">
            Vuoi dichiarare qualcosa?
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            Stai aprendo la presa. I segnali sono visibili a tutti.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 mt-3">
          {signals.map((s) => (
            <Button
              key={s.value}
              variant="outline"
              className={`w-full justify-start whitespace-normal gap-3 h-auto py-3 ${s.color}`}
              onClick={() => onSelect(s.value)}
              data-testid={`signal-button-${s.value}`}
            >
              <div className="text-left">
                <div className="font-semibold">{s.label}</div>
                <div className="text-xs text-muted-foreground">
                  {s.description}
                </div>
              </div>
            </Button>
          ))}

          <Button
            variant="ghost"
            className="w-full mt-1"
            onClick={() => onSelect(null)}
            data-testid="signal-button-none"
          >
            Niente
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SignalDialog;
