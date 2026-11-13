import { useEffect, useRef } from "react";
import { Trophy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GameFinishedPayload } from "@/sockets/events";
import type { RoomPlayer } from "@/rooms/model";

interface GameResultProps {
  result: GameFinishedPayload;
  players: RoomPlayer[];
  myTeam: number | null;
  onHome: () => Promise<void>;
  isReturningHome: boolean;
}

const awardTypes = [
  { key: "busso", title: "Il bussatore", description: "Dichiarazioni di busso" },
  { key: "acesCaptured", title: "Cacciatore di assi", description: "Assi avversari raccolti nelle proprie prese" },
  { key: "acesLost", title: "Assi in fuga", description: "Assi giocati e raccolti dagli avversari" },
] as const;

export default function GameResult({
  result, players, myTeam, onHome, isReturningHome,
}: GameResultProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const statistics = result.statistics;
  const roster = statistics?.players ?? players;
  const awards = statistics ? awardTypes.map((award) => {
    const count = Math.max(0, ...statistics.players.map((player) => player[award.key]));
    return {
      ...award,
      count,
      names: statistics.players.filter((player) => player[award.key] === count)
        .map((player) => player.username).join(", "),
    };
  }).filter((award) => award.count > 0) : [];

  return (
    <main className="circolo-shell min-h-screen px-8 py-10" data-testid="game-result-page" data-game-finished="true">
      <div className="relative mx-auto max-w-4xl space-y-8">
        <header className="text-center space-y-2">
          <Trophy className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
          <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold outline-none">
            {myTeam === result.winnerTeam ? "Vittoria!" : "Partita terminata"}
          </h1>
          <p>Ha vinto la Squadra {result.winnerTeam + 1} · {result.totalRounds} smazzate giocate</p>
        </header>

        <section aria-label="Confronto tra squadre" className="grid grid-cols-2 gap-4">
          {([0, 1] as const).map((team) => {
            const key = team === 0 ? "team0" : "team1";
            return (
              <div key={team} className={`rounded-xl border p-6 bg-card ${result.winnerTeam === team ? "border-primary" : "border-border"}`}>
                <h2 className="text-xl font-bold">Squadra {team + 1}{myTeam === team ? " · La tua" : ""}</h2>
                <p className="text-sm text-muted-foreground break-words">
                  {roster.filter((player) => player.team === team).map((player) => player.username).join(" e ")}
                </p>
                <p className="my-4 text-5xl font-bold text-primary">{result.finalScores[key]} <span className="text-sm">punti</span></p>
                <dl className="space-y-2">
                  <div className="flex justify-between gap-4"><dt>Smazzate vinte</dt><dd>{result.roundsWon[key]}</dd></div>
                  {statistics && <div className="flex justify-between gap-4"><dt>Prese vinte</dt><dd>
                    {statistics.players.filter((player) => player.team === team).reduce((total, player) => total + player.tricksWon, 0)}
                  </dd></div>}
                </dl>
              </div>
            );
          })}
        </section>

        {awards.length > 0 && (
          <section aria-labelledby="match-awards" className="space-y-4">
            <h2 id="match-awards" className="text-xl font-bold">Premi della partita</h2>
            <div className="grid grid-cols-3 gap-4">
              {awards.map((award) => (
                <div key={award.key} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <h3 className="font-bold">{award.title}</h3>
                  <p className="break-words">{award.names}</p>
                  <p className="text-3xl font-bold text-primary">{award.count}</p>
                  <p className="text-sm text-muted-foreground">{award.description}</p>
                </div>
              ))}
            </div>
            {awards.some((award) => award.key === "acesLost") && (
              <p className="text-sm text-muted-foreground">Una curiosità, non un errore: sacrificare un asso può essere la scelta giusta.</p>
            )}
          </section>
        )}

        {statistics && (
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-bold">Punteggi delle smazzate</summary>
            <table className="mt-4 w-full text-sm text-left">
              <caption className="sr-only">Punti e figure per smazzata</caption>
              <thead><tr><th scope="col">Smazzata</th><th scope="col">Squadra 1</th><th scope="col">Squadra 2</th></tr></thead>
              <tbody>{statistics.rounds.map((round) => (
                <tr key={round.number} className="border-t border-border">
                  <th scope="row" className="py-3">{round.number}</th>
                  <td>{round.team0Points} punti · {round.team0Figures} figure</td>
                  <td>{round.team1Points} punti · {round.team1Figures} figure</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        )}
        <Button className="w-full" variant="gradient" onClick={() => void onHome()} disabled={isReturningHome}>
          {isReturningHome ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uscita in corso...</> : "Torna alla lobby"}
        </Button>
      </div>
    </main>
  );
}
