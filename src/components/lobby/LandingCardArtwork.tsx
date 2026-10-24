type LandingCard = "asso_denari" | "tre_spade" | "re_coppe" | "cavallo_bastoni" | "due_denari";

function Coin({ y }: { y: number }) {
  return (
    <g transform={`translate(63 ${y}) scale(1 .9)`} stroke="#27291e" strokeWidth=".85" strokeLinejoin="round">
      <circle r="38" fill="#e5b951" />
      <circle r="35" fill="#f4d580" />
      <circle r="32" fill="#29372f" />
      {Array.from({ length: 8 }, (_, index) => (
        <g key={index} transform={`rotate(${index * 45})`}>
          <path d="M-4-14Q-15-24 0-29Q15-24 4-14L0-10Z" fill="#e7b840" />
          <path d="M0-27V-16M-3-22l3 4 3-4" fill="none" strokeWidth=".6" />
          <path d="m-5-31 5-3 5 3" fill="none" stroke="#edce74" />
          <circle cy="-36.5" r=".6" fill="#27291e" stroke="none" />
        </g>
      ))}
      <path d="m0-16 5 7 10-1-5 10 5 10-10-1-5 7-5-7-10 1 5-10-5-10 10 1Z" fill="#b83626" />
      <circle r="7" fill="#e9ba43" />
      <circle r="4" fill="#c84529" />
      <circle r="1.2" fill="#242e27" />
    </g>
  );
}

function Sword({ red = false }: { red?: boolean }) {
  return (
    <g stroke="#252c26" strokeWidth=".7" strokeLinejoin="round">
      <path d="M0-69-5-53-4 49h8L5-53Z" fill={red ? "#b73c27" : "#186683"} />
      <path d="M0-63-2-51-1 47h2L2-51Z" fill={red ? "#e6ae44" : "#92c7c7"} stroke="none" />
      <path d="M-12 47q12 5 24 0l1 5q-13 6-26 0Z" fill="#d9a62e" />
      <path d="M-11 49q11 4 22 0" fill="none" stroke="#f3d878" />
      <path d="M-3 55h6v16h-6Z" fill="#c04426" />
      <path d="m-3 57 6 3m-6 1 6 3m-6 1 6 3" fill="none" stroke="#e7bd50" strokeWidth="1" />
      <path d="M-4 71h8l1 4-5 3-5-3Z" fill="#ddad36" />
      <circle cy="74" r="1.3" fill="#bf3b27" />
    </g>
  );
}

function KingOfCups() {
  return (
    <g stroke="#2b3024" strokeWidth=".65" strokeLinejoin="round" strokeLinecap="round">
      <path d="m30 181 14-6 8 3 17-1 25 5-7 4H34Z" fill="#4e783e" />
      <path d="m37 183 6-6m6 7 2-5m24 5 3-6m8 6 4-3" fill="none" stroke="#bdb36b" />
      <path d="m49 157-4 19-11 6q6 5 18 0l5-23m13-2 3 22 12 3q5 5-13 2l-7-25" fill="#253c4c" />
      <path d="m35 183 15-2m23 3 11-1" fill="none" />
      <path d="M46 68Q31 75 28 106l4 60 15 13 17-13 20 12 14-12-10-65q-1-28-13-32Z" fill="#216946" />
      <path d="M46 70q-7 20-7 49l-6 45 11 10 10-28 4-67m18-8 8 36 2 65-13-8-9-82" fill="#c0472c" />
      <path d="M50 75 43 166q19 8 39 0L71 75Z" fill="#d4a33d" />
      <path d="m56 87-5 78m15-77 9 77m-17-68-3 67m12-60 5 62" fill="none" stroke="#9d5f2a" strokeWidth=".7" />
      <path d="m48 160 29 1 2 7-35-1Z" fill="#21596b" />
      <path d="m46 164 32 1" stroke="#e4bd51" fill="none" strokeWidth="1.2" />
      <path d="M49 72q13 7 24 0l4 27-27 1Z" fill="#b83e27" />
      <path d="m52 77 20 1m-20 5h21m-22 6 23 1m-23 5h23" stroke="#dcb647" fill="none" />
      {[80, 87, 94].map((y) => <circle key={y} cx="62" cy={y} r="1.5" fill="#e4bc49" />)}
      <path d="m49 100 27-1 1 5-29 1Z" fill="#294f59" />
      <path d="M46 72q-9 3-12 16l-4 20 12 8 9-28m24-16q13 4 15 27l-10 12-10-26" fill="#24704c" />
      <path d="m39 83-6 23 8 5m40-29 5 16-5 9M35 119l2 38m-3-29 1 27m54-38 5 44m-8-34 4 34" fill="none" stroke="#c7a64c" />
      <path d="m32 107-2-22 3-6 5 1-2 8 5 22Zm49-2 9 4 3-24 5-3 2 3-3 5-1 28-9 2Z" fill="#e0b17d" />
      <path d="m32 82-5-3-1-5 4-1 2 5 6 1m56 7 1-7 4-1 2 4-3 5" fill="none" />
      <path d="m89 92 8 2-1 6-8-2m-59 6 12 4-1 5-12-4" fill="#d7ac3e" />
      <path d="M96 84v91" stroke="#c09731" strokeWidth="2.4" />
      <path d="M96 86v88" stroke="#ead27b" strokeWidth=".7" />
      <path d="m96 71 5 8-5 7-5-7Z" fill="#c89b2a" />
      <circle cx="96" cy="78" r="2" fill="#b6422b" />
      <path d="M27 56h9l-1 6-3 2v8l6 2v3H24v-3l6-2v-8l-3-2Z" fill="#d3a333" />
      <path d="M20 48h23l-2 10q-9 10-19 0Z" fill="#d9ae3f" />
      <path d="M24 49h14l-1 9q-6 6-11-1Z" fill="#b53b29" />
      <path d="M19 47h25v4H19Zm7 27h11" fill="#efce72" />
      <path d="m28 52 3 3 4-3m-7 8h7" fill="none" stroke="#e2c366" />
      <path d="M52 48q0-12 14-12 12 3 9 19l4 4-6 3q-2 10-13 8L52 59Z" fill="#e8bd87" />
      <path d="M51 46q0-12 14-12 12 2 12 11l-7-1-6-5-6 5 1 13-5 4-4-8Z" fill="#4d3c29" />
      <path d="m72 48 2 7 4 3-5 2m-9 3 8-1" fill="none" strokeWidth=".55" />
      <path d="M58 57q1 7 8 5l7-2-2 11-7 6-5-5-4-12Z" fill="#5c4230" />
      <path d="m60 64 2 6m3-6v8m4-8-1 7" fill="none" stroke="#b08a52" strokeWidth=".5" />
      <circle cx="70" cy="49" r="1" fill="#282f26" stroke="none" />
      <path d="m68 46 5 1" fill="none" />
      <path d="m50 38-3-15 9 7 5-12 6 11 10-8-2 17Z" fill="#d8ae40" />
      <path d="m50 34 24-1 1 6-24 1Z" fill="#d2a030" />
      <path d="m52 36 20-1" stroke="#f0d778" fill="none" />
      <circle cx="61" cy="34" r="1.7" fill="#b83f29" />
      <circle cx="53" cy="35" r="1.1" fill="#246678" />
      <circle cx="70" cy="34" r="1.1" fill="#246678" />
      <path d="m52 75-5 15m28-15 4 14" fill="none" stroke="#e1bb4a" strokeWidth="1.5" />
    </g>
  );
}

function KnightOfClubs() {
  return (
    <g stroke="#2c3027" strokeWidth=".65" strokeLinejoin="round" strokeLinecap="round">
      <path d="m18 185 17-6 11 4 13-3 16 4 23-1 9 4H19Z" fill="#507742" />
      <path d="m24 186 3-4m15 4 3-3m28 3 3-4m17 4 2-3" fill="none" stroke="#b5af69" />
      <path d="M29 125q-17-9-14 22-4-17-2-25 3-13 17-7" fill="#393b36" />
      <path d="M19 122q-5 10-2 20m5-23q-5 9-3 17" fill="none" stroke="#96998c" strokeWidth=".5" />
      <path d="m29 140-8 13 7 25 6 2 2-3-7-23 10-9m39-7 5 17 12 20 6 1 1-3-12-20-1-21" fill="#a1a69c" />
      <path d="m37 141 6 17-4 22 7 2 2-3 1-24-2-18m29 2-4 19 4 20 6 3 3-2-6-22 6-13" fill="#c3c5b8" />
      <path d="m28 178 7-1 1 5h-7m10-2 9-1 1 5H39m37-6 8 1 1 5-9-2m19-7 7-2 3 6-9 1" fill="#33362e" />
      <path d="M26 120q7-9 25-6l22 8 9-15 1-17 12-11 9 6 6 18-5 8-9-5-4 22q-2 18-15 20l-20-4-20 5q-15-1-14-15Z" fill="#b7bbb0" />
      <path d="M28 126q7-8 23-7l21 7m-46 9 10 6m26-2 11 3m9-25 4-15m10-19 5 7 6 9" fill="none" stroke="#747f76" />
      <path d="m88 86 2-12 5 7 5-11 2 14m-15 5q-9 10-10 25l7-5 1-9 6-9" fill="#38433c" />
      <path d="M102 103q-5-6-9-4m-12 19q3 9-1 18m-38-8-7 7m13 21-3 19m38-16 10 13" fill="none" strokeWidth=".5" />
      <circle cx="99" cy="90" r="1.1" fill="#252d27" />
      <path d="m105 103 2 2" fill="none" strokeWidth="1.5" />
      <path d="m91 88 12 5-3 10m-7-5 13 7m-15-1-3 6" fill="none" stroke="#8f3d27" strokeWidth="1.5" />
      <path d="M33 115q20-1 38 9l-2 16-16 4-21-9Z" fill="#ab3c29" />
      <path d="m36 120 30 8-2 10-27-7Z" fill="#234e66" />
      <path d="m35 118 32 9m-31 4 28 9" fill="none" stroke="#d9b448" strokeWidth="1.5" />
      <path d="m42 124 3 5 3-3 3 5 4-3 4 5" fill="none" stroke="#d8ae42" />
      <path d="M51 69Q34 66 25 83l-5 30 22 6 15-16Z" fill="#286844" />
      <path d="m45 74-11 16-7 22m14-29-6 22m13-22-7 28" fill="none" stroke="#d0aa49" />
      <path d="m49 101 18 10 9 16-5 16-8-2 3-14-15-11-9-8Z" fill="#2a4859" />
      <path d="m66 138 7 2-1 6-5 4-8-1-1-4 6-2Z" fill="#31352b" />
      <path d="m51 102 14 10 6 13" fill="none" stroke="#c5b371" />
      <path d="M48 67q14-5 25 8l4 25-27 10-12-16Z" fill="#d7aa43" />
      <path d="m51 73 16 7-3 23m-21-10 26-5m-23 9 25-5" fill="none" stroke="#ab3a29" strokeWidth="2" />
      <path d="m48 73-7 13-5-5-2 4 7 9 9-9m20-9 9 18 13 2 1 5-18-2-11-13" fill="#deb181" />
      <path d="m47 71-7 10 9 8 8-16m11 1-8 9 10 10 8-7Z" fill="#276b46" />
      <path d="m43 80 6 5m17-3 8 7" fill="none" stroke="#dbb545" />
      <path d="M92 98q-18-1-26-12" fill="none" stroke="#5a4932" strokeWidth="1" />
      <path d="m33 84 6 2 13-49-3-5-4 2Z" fill="#b58b39" />
      <path d="m38 79 10-40" stroke="#e1bf65" fill="none" />
      <path d="m42 46 9 3m-12 8 9 3m-12 8 9 3" stroke="#a33a29" strokeWidth="2" />
      <path d="m44 36 4-9 5 6-2 8Z" fill="#26724a" />
      <path d="M51 47q0-12 13-12 13 3 10 18l5 5-6 2q-2 9-12 8l-10-9Z" fill="#e6b884" />
      <path d="M49 48q-2-14 15-15 12 2 12 12l-8-4-8 2-3 16-7-1Z" fill="#3e3a2a" />
      <path d="m69 47 3 7 5 4-5 2m-8 3 7-1" fill="none" strokeWidth=".5" />
      <circle cx="69" cy="48" r=".9" fill="#272e25" stroke="none" />
      <path d="m66 45 5 1" fill="none" />
      <path d="M48 40q9-17 25-5l5 7-10-2-15 6Z" fill="#b93e28" />
      <path d="m50 41 24-3" stroke="#d9b64c" strokeWidth="2" />
      <path d="M53 35Q34 19 29 42q7-9 18-1l8-3" fill="#24724d" />
      <path d="M33 38q5-7 15-1m-9-6 8 6" fill="none" stroke="#c9ab4e" />
    </g>
  );
}

export default function LandingCardArtwork({ card, className }: { card: LandingCard; className?: string }) {
  const [value, suit] = card.split("_");

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 126 200" width="126" height="200"
      className={className} role="img" aria-label={`${value} di ${suit}`} focusable="false"
      data-landing-card={card}>
      <rect x=".5" y=".5" width="125" height="199" rx="7" fill="#fffef8" stroke="#dcded2" />
      {card === "due_denari" && <><Coin y={53} /><Coin y={147} /></>}
      {card === "tre_spade" && (
        <>
          <g transform="translate(31 96)"><Sword /></g>
          <g transform="translate(63 104) rotate(180)"><Sword red /></g>
          <g transform="translate(95 96)"><Sword /></g>
        </>
      )}
      {card === "asso_denari" && (
        <g transform="translate(63 100)" stroke="#293029" strokeWidth=".6" strokeLinejoin="round">
          {[false, true].map((mirrored) => (
            <g key={String(mirrored)} transform={mirrored ? "scale(-1 1)" : undefined}>
              <path d="M-3-7q-13 5-27-4l-5-8-2 12-16-2 10 10-9 11 16-4 2 12 7-13q12-6 25 0Z" fill="#215c7e" />
              <path d="m-11-4-17-2-6-8 1 10-14-1 9 5-8 7 15-4-2 10 7-11 15-1" fill="#d9ae3f" />
              <path d="m-34-5 5 5-5 5-4-5Zm15 2 4 3-4 3-4-3Z" fill="#b63d27" />
              <path d="M-28-7q8 7 17 3m-17 11q8-7 17-3" fill="none" stroke="#557f49" />
            </g>
          ))}
          <path d="m0-11 5 5 5 6-5 6-5 5-5-5-5-6 5-6Z" fill="#d9ae3f" />
          <circle r="5.5" fill="#a83a2b" />
          <circle r="2.8" fill="#e2bc59" />
        </g>
      )}
      {card === "re_coppe" && <KingOfCups />}
      {card === "cavallo_bastoni" && <KnightOfClubs />}
    </svg>
  );
}
