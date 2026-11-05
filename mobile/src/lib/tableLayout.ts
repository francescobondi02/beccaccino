export function tableLayout(width: number, height: number, largeText = false) {
  const handWidth = Math.max(48, Math.min(62, height * 0.18));
  const handHeight = handWidth / 0.63;
  const cardWidth = Math.min(52, height * 0.15);
  const cardHeight = cardWidth / 0.63;
  const centerX = width / 2;
  const centerY = height * 0.42;
  const seatWidth = largeText ? 140 : 92;
  const handY = height - handHeight - 18;

  return {
    cardWidth, cardHeight, handWidth, handHeight, handY, seatWidth,
    handX: [centerX - handWidth * 1.18, centerX + handWidth * 0.18],
    seats: [
      { x: 8, y: centerY - 30 },
      { x: centerX - seatWidth / 2, y: largeText ? 90 : 4 },
      { x: width - seatWidth - 8, y: centerY - 30 },
      { x: centerX - seatWidth / 2, y: height - 20 },
    ],
    cards: [
      { x: centerX - cardWidth * 1.7, y: centerY - cardHeight * 0.4 },
      { x: centerX - cardWidth / 2, y: centerY - cardHeight * 0.85 },
      { x: centerX + cardWidth * 0.7, y: centerY - cardHeight * 0.4 },
      { x: centerX - cardWidth / 2, y: centerY + cardHeight * 0.05 },
    ],
  };
}
