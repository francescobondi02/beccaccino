import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PlayingCard from "@/components/PlayingCard";

export interface HistoryPlay {
  label: string;
  suit: string;
  value: string;
  signal?: string | null;
}

export interface HistoryTrick {
  number: number | null;
  plays: HistoryPlay[];
  current?: boolean;
  winnerLabel?: string;
}

interface TrickHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  tricks: HistoryTrick[];
  testId: string;
  actions?: ReactNode;
  children?: ReactNode;
}

const SIGNAL_STYLES: Record<string, string> = {
  busso: "bg-red-500/15 text-red-400 border-red-500/30",
  striscio: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  volo: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

const TrickHistoryDialog = ({
  open,
  onOpenChange,
  title,
  description,
  tricks,
  testId,
  actions,
  children,
}: TrickHistoryDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[min(88vh,54rem)] max-w-[min(96vw,72rem)] flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle className="text-center text-2xl">{title}</DialogTitle>
        <DialogDescription className="text-center">
          {description}
        </DialogDescription>
      </DialogHeader>

      {actions && (
        <div className="flex justify-end border-b border-border pb-3">
          {actions}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-2" data-testid={testId}>
        {tricks.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nessuna carta giocata.
          </p>
        ) : (
          <div className="space-y-6">
            {tricks.map((trick, trickIndex) => (
              <section
                key={`${trick.number ?? "unknown"}-${trickIndex}`}
                className="space-y-3 border-b border-border pb-6 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    {trick.number ? `Presa ${trick.number}` : "Presa"}
                    {trick.current ? " · in corso" : ""}
                  </h3>
                  {trick.winnerLabel && (
                    <span className="text-xs font-medium text-primary">
                      Vince {trick.winnerLabel}
                    </span>
                  )}
                </div>
                <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {trick.plays.map((play, playIndex) => (
                    <li
                      key={`${play.suit}-${play.value}-${playIndex}`}
                      className="flex min-w-0 items-center gap-3"
                    >
                      <PlayingCard
                        suit={play.suit}
                        value={play.value}
                        size="md"
                        className="h-24 w-16 shrink-0 rounded-sm"
                      />
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">{play.label}</p>
                        {play.signal && (
                          <Badge
                            variant="outline"
                            className={`mt-1 text-[10px] ${SIGNAL_STYLES[play.signal] ?? ""}`}
                          >
                            {play.signal}
                          </Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
        {children}
      </div>
    </DialogContent>
  </Dialog>
);

export default TrickHistoryDialog;
