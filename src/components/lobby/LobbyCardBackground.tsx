import { useState } from "react";

const CARD_FILENAMES = [
  "asso_bastoni.png",
  "asso_coppe.png",
  "asso_denari.png",
  "asso_spade.png",
  "cavallo_bastoni.png",
  "cavallo_coppe.png",
  "cavallo_denari.png",
  "cavallo_spade.png",
  "cinque_bastoni.png",
  "cinque_coppe.png",
  "cinque_denari.png",
  "cinque_spade.png",
  "due_bastoni.png",
  "due_coppe.png",
  "due_denari.png",
  "due_spade.png",
  "fante_bastoni.png",
  "fante_coppe.png",
  "fante_denari.png",
  "fante_spade.png",
  "quattro_bastoni.png",
  "quattro_coppe.png",
  "quattro_denari.png",
  "quattro_spade.png",
  "re_bastoni.png",
  "re_coppe.png",
  "re_denari.png",
  "re_spade.png",
  "sei_bastoni.png",
  "sei_coppe.png",
  "sei_denari.png",
  "sei_spade.png",
  "sette_bastoni.png",
  "sette_coppe.png",
  "sette_denari.png",
  "sette_spade.png",
  "tre_bastoni.png",
  "tre_coppe.png",
  "tre_denari.png",
  "tre_spade.png",
];

function randomCards(count: number): string[] {
  return Array.from(
    { length: count },
    () => CARD_FILENAMES[Math.floor(Math.random() * CARD_FILENAMES.length)],
  );
}

interface CardStreamProps {
  cards: string[];
  side: "left" | "right";
}

function CardStream({ cards, side }: CardStreamProps) {
  const animationClass =
    side === "left" ? "infinite-scroll-up" : "infinite-scroll-down";

  return (
    <div
      className={`fixed ${side}-0 top-16 bottom-0 w-36 pointer-events-none overflow-hidden opacity-70`}
    >
      <div className={animationClass}>
        {[0, 1].flatMap((set) =>
          cards.map((card, index) => (
            <img
              key={`${side}-${set}-${index}`}
              src={`/images/cards/${card}`}
              alt=""
              className="w-24 h-auto rounded-lg shadow-lg mx-auto flex-shrink-0"
              style={{ transform: `rotate(${(index % 3) * 5 - 5}deg)` }}
            />
          )),
        )}
      </div>
    </div>
  );
}

export default function LobbyCardBackground() {
  const [leftCards] = useState(() => randomCards(20));
  const [rightCards] = useState(() => randomCards(20));

  return (
    <>
      <CardStream side="left" cards={leftCards} />
      <CardStream side="right" cards={rightCards} />
    </>
  );
}
