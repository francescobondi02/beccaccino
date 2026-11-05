import { tableLayout } from '../tableLayout';

it.each([
  [464, 283, false],
  [732, 353, false],
  [828, 377, false],
  [640, 640, true],
])('keeps the cross-shaped trick and touchable hand within a %s×%s table', (width, height, largeText) => {
  const layout = tableLayout(width, height, largeText);

  for (const card of layout.cards) {
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.x + layout.cardWidth).toBeLessThanOrEqual(width);
    expect(card.y + layout.cardHeight).toBeLessThanOrEqual(height);
  }
  expect(layout.handWidth).toBeGreaterThanOrEqual(48);
  expect(layout.handHeight).toBeGreaterThanOrEqual(48);
  for (const x of layout.handX) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + layout.handWidth).toBeLessThanOrEqual(width);
  }
  expect(layout.handY + layout.handHeight).toBeLessThan(height);
  expect(layout.cards[0].x).toBeLessThan(layout.cards[1].x);
  expect(layout.cards[2].x).toBeGreaterThan(layout.cards[1].x);
  expect(layout.cards[3].y).toBeGreaterThan(layout.cards[1].y);
});

// A large-text badge (avatar and name plate) is about this tall; it must never cover a played card.
const largeBadgeHeight = 84;
it.each([
  [464, 283],
  [568, 320],
  [732, 353],
  [828, 377],
  [640, 640],
])('keeps large-text opponent and partner badges off the played cards on a %s×%s table', (width, height) => {
  const layout = tableLayout(width, height, true);
  for (const seat of layout.seats.slice(0, 3)) {
    expect(seat.x).toBeGreaterThanOrEqual(0);
    expect(seat.x + layout.seatWidth).toBeLessThanOrEqual(width);
    for (const card of layout.cards) {
      const apart = seat.x + layout.seatWidth <= card.x || card.x + layout.cardWidth <= seat.x ||
        seat.y + largeBadgeHeight <= card.y || card.y + layout.cardHeight <= seat.y;
      expect(apart).toBe(true);
    }
  }
});
