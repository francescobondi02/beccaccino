import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export interface MoveLogEntry {
  handNumber: number | null;
  username: string;
  suit: string;
  value: string;
  signal?: string | null;
}

/**
 * A running list of every card played this game, with the signal its leader
 * declared.
 *
 * This exists because the table itself cannot answer "is the bot using busso /
 * striscio / volo sensibly?" — `GameTable` shows only the current signal and
 * clears it on every new trick, so the evidence scrolls away before it can be
 * reviewed. The log keeps a whole round readable after the fact.
 */
const SIGNAL_STYLES: Record<string, string> = {
  busso: "bg-red-500/15 text-red-400 border-red-500/30",
  striscio: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  volo: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

const MoveLog = ({ entries }: { entries: MoveLogEntry[] }) => (
  <Card className="bg-gradient-card border-border/50">
    <CardContent className="pt-4">
      <h3 className="text-sm font-semibold mb-2">Storico mosse</h3>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessuna carta giocata.</p>
      ) : (
        <ScrollArea className="h-64 pr-3">
          <ol className="space-y-1">
            {entries.map((entry, index) => (
              <li
                key={index}
                className="text-xs flex items-center gap-2 border-b border-border/30 pb-1"
              >
                <span className="text-muted-foreground w-8 shrink-0">
                  {entry.handNumber ? `M${entry.handNumber}` : "—"}
                </span>
                <span className="w-24 shrink-0 truncate font-medium">
                  {entry.username}
                </span>
                <span className="flex-1">
                  {entry.value} di {entry.suit}
                </span>
                {entry.signal && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${SIGNAL_STYLES[entry.signal] ?? ""}`}
                  >
                    {entry.signal}
                  </Badge>
                )}
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </CardContent>
  </Card>
);

export default MoveLog;
