import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bot, Check, LogIn, LogOut, Plus, Trophy, UserRound, Users } from "lucide-react";
import GameResult from "@/components/GameResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { profileDemo } from "./profileDemo";

const titles = new Map([
  ["lobby", "Trova il socio."],
  ["practice", "Scalda la mano."],
  ["leaderboard", "Lascia il segno."],
  ["profile", "Il tuo gioco."],
  ["account", "Entra nel giro."],
]);
const rooms = [
  { code: "SOCIO1", name: "Il socio ti aspetta.", players: "Giulia, Luca e Marta" },
  { code: "BECCA2", name: "Ancora una, poi basta.", players: "Diego, Sara e Leo" },
  { code: "ULTIMA", name: "Zero pietà, solo prese.", players: "Vale, Anna e Marco" },
];
const rankings = [
  { username: "Giulia", wins: 28, totalGames: 42 },
  { username: "Luca", wins: 24, totalGames: 40 },
  { username: "Marta", wins: 20, totalGames: 34 },
  { username: "Alex", ...profileDemo.stats },
];

interface MobilePagesProps {
  page: string;
  username: string | null;
  onAccount: (username: string | null) => void;
  onOpenRoom: (code: string) => void;
  onStartPractice: () => void;
}

export default function MobilePages({ page, username, onAccount, onOpenRoom, onStartPractice }: MobilePagesProps) {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [saved, setSaved] = useState(false);
  const playerName = username ?? "Ospite";

  if (page === "result") {
    return (
      <div className="mobile-result">
        <GameResult
          result={{
            winnerTeam: 0, totalRounds: 6,
            finalScores: { team0: 41, team1: 29 }, roundsWon: { team0: 4, team1: 2 },
            statistics: {
              players: [playerName, "Luca", "Giulia", "Marta"].map((name, seat) => ({
                playerId: seat + 1, username: name, team: seat % 2,
                tricksWon: [20, 15, 20, 5][seat], busso: [4, 2, 1, 1][seat],
                acesCaptured: [3, 1, 2, 1][seat], acesLost: [1, 3, 1, 2][seat],
              })),
              rounds: [25, 26, 25, 26, 10, 11].map((raw, index) => ({
                number: index + 1, winnerTeam: raw > 17 ? 0 : 1,
                team0Points: Math.floor(raw / 3), team0Figures: raw % 3,
                team1Points: Math.floor((35 - raw) / 3), team1Figures: (35 - raw) % 3,
              })),
            },
          }}
          players={[]}
          myTeam={0}
          onHome={async () => { navigate("/preview/mobile"); }}
          isReturningHome={false}
        />
      </div>
    );
  }

  return (
    <main className="mobile-preview-main mobile-section">
      <aside className="mobile-section-intro">
        <div>
          <span className="mobile-kicker">IL TUO CIRCOLO. SEMPRE CON TE.</span>
          <h1 tabIndex={-1}>{titles.get(page) ?? "Pagina non trovata."}</h1>
        </div>
        <nav aria-label="Navigazione mobile">
          <Link to="/preview/mobile/lobby" aria-current={page === "lobby" ? "page" : undefined}><Users size={20} /> Tavoli</Link>
          <Link to="/preview/mobile/leaderboard" aria-current={page === "leaderboard" ? "page" : undefined}><Trophy size={20} /> Classifica</Link>
          <Link to={`/preview/mobile/${username ? "profile" : "account"}`} aria-current={page === "profile" || page === "account" ? "page" : undefined}><UserRound size={20} /> {username ? "Profilo" : "Accedi"}</Link>
        </nav>
      </aside>

      <section className="mobile-page-panel" aria-label={titles.get(page) ?? "Pagina non trovata"}>
        {page === "lobby" ? (
          <>
            <div className="mobile-scroll" tabIndex={0} role="region" aria-label="Stanze disponibili">
              <div className="mobile-panel-title"><h2>Tavoli aperti</h2><span>3/4 · manca solo te</span></div>
              <ul className="mobile-room-list">
                {rooms.map((room) => (
                  <li key={room.code}>
                    <span><strong>{room.name}</strong><small>{room.players}</small></span>
                    <Button variant="secondary" size="icon" aria-label={`Entra: ${room.name}`} onClick={() => onOpenRoom(room.code)}><ArrowRight size={20} /></Button>
                  </li>
                ))}
              </ul>
            </div>
            <Button className="mobile-page-action" onClick={() => onOpenRoom("BECCA1")}><Plus size={20} /> Crea la tua stanza</Button>
          </>
        ) : page === "practice" ? (
          <>
            <div className="mobile-scroll mobile-practice-content" tabIndex={0} role="region" aria-label="Allenamento dimostrativo">
              <Bot className="mobile-feature-icon" size={64} aria-hidden="true" />
              <div><span className="mobile-kicker">NESSUNA PRESSIONE. SOLO PRESE.</span><h2>Tu e tre bot.</h2>
                <p>Un socio e due avversari controllati dal computer. Qui provi il tavolo manualmente: i bot non giocano da soli.</p></div>
              <span className="mobile-info-chip"><Check size={16} /> Nessun effetto sulla classifica</span>
            </div>
            <Button className="mobile-page-action" onClick={onStartPractice}><Bot size={20} /> Gioca nel tavolo demo <ArrowRight size={20} /></Button>
          </>
        ) : page === "leaderboard" ? (
          <>
            <div className="mobile-scroll" tabIndex={0} role="region" aria-label="Classifica dimostrativa">
              <div className="mobile-panel-title"><h2>Classifica generale</h2><span>Prima le vittorie. Poi la percentuale.</span></div>
              <ol className="mobile-ranking-list">
                {rankings.map((entry, index) => (
                  <li key={index} data-local={index === 3}>
                    <span className="mobile-rank-number">{index + 1}</span>
                    <span><strong>{index === 3 ? playerName : entry.username}{index === 3 && " (tu)"}</strong><small>{entry.totalGames} partite · {Math.round(entry.wins / entry.totalGames * 100)}% vittorie</small></span>
                    <span><strong>{entry.wins}</strong><small>vittorie</small></span>
                  </li>
                ))}
              </ol>
            </div>
            <Button asChild className="mobile-page-action"><Link to="/preview/mobile/lobby">La prossima vittoria è tua <ArrowRight size={20} /></Link></Button>
          </>
        ) : page === "profile" ? (
          <>
            <div className="mobile-scroll" tabIndex={0} role="region" aria-label="Profilo e statistiche">
              <form className="mobile-profile-form" onSubmit={(event) => {
                event.preventDefault();
                onAccount(String(new FormData(event.currentTarget).get("username")).trim());
                setSaved(true);
              }}>
                <label htmlFor="mobile-username">Nome giocatore</label>
                <div><Input id="mobile-username" name="username" required minLength={3} maxLength={32} pattern={String.raw`\S.*\S`} defaultValue={username ?? ""} onChange={() => setSaved(false)} /><Button type="submit" variant="secondary">Salva</Button></div>
                {saved && <p role="status">Nome aggiornato solo nella demo.</p>}
              </form>
              <dl className="mobile-stat-grid">
                <div><dt>Partite</dt><dd>{profileDemo.stats.totalGames}</dd></div>
                <div><dt>Vittorie</dt><dd>{profileDemo.stats.wins}</dd></div>
                <div><dt>% vittorie</dt><dd>{profileDemo.stats.winRate}%</dd></div>
                <div><dt>Punti</dt><dd>{profileDemo.stats.totalPoints}</dd></div>
              </dl>
              <h2 className="mobile-small-title">Le ultime partite</h2>
              <ul className="mobile-history">
                {profileDemo.stats.recentGames.map((game) => (
                  <li key={game.id}><strong>{game.result}</strong><span>Con {game.teammates.join(", ")}</span><b>{game.myTeamPoints} : {game.opponentTeamPoints}</b></li>
                ))}
              </ul>
              <Button variant="ghost" onClick={() => { onAccount(null); navigate("/preview/mobile/account"); }}><LogOut size={18} /> Esci dalla demo</Button>
            </div>
            <Button asChild className="mobile-page-action"><Link to="/preview/mobile/account">Accesso e registrazione <ArrowRight size={20} /></Link></Button>
          </>
        ) : page === "account" ? (
          <form className="mobile-account-form" onSubmit={(event) => {
            event.preventDefault();
            onAccount(String(new FormData(event.currentTarget).get("username")).trim());
            navigate("/preview/mobile/profile");
          }}>
            <div className="mobile-scroll" tabIndex={0} role="region" aria-label="Account dimostrativo">
              <div className="mobile-panel-title"><h2>{isLogin ? "Bentornato, socio." : "C’è posto anche per te."}</h2></div>
              <p>Solo una prova grafica. Usa dati inventati: nessun account viene creato e nulla viene inviato.</p>
              <div className="mobile-account-fields">
                <label>Nome utente demo<Input name="username" required minLength={3} maxLength={32} pattern={String.raw`\S.*\S`} autoComplete="off" /></label>
                <label>Password demo<Input name="password" type="password" required minLength={6} autoComplete="off" /></label>
              </div>
              <button type="button" className="mobile-text-action" onClick={() => setIsLogin(!isLogin)}>{isLogin ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}</button>
            </div>
            <Button type="submit" className="mobile-page-action"><LogIn size={20} /> {isLogin ? "Accedi alla demo" : "Crea profilo demo"}</Button>
          </form>
        ) : (
          <>
            <div className="mobile-scroll mobile-practice-content">
              <Users className="mobile-feature-icon" size={56} aria-hidden="true" />
              <h2>Questo tavolo non esiste.</h2><p>La pagina cercata non fa parte dell’anteprima. Torna alla home e scegli il prossimo giro.</p>
            </div>
            <Button asChild className="mobile-page-action"><Link to="/preview/mobile">Torna alla home <ArrowRight size={20} /></Link></Button>
          </>
        )}
      </section>
    </main>
  );
}
