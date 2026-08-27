// Single source of motion timing for V2. Reduced motion collapses everything
// to a near-zero duration (the CSS pass in v2.css does the same for keyframes).
export const MOTION = {
  fast: 140,
  base: 260,
  slow: 520,
  trickHold: 3000,
} as const;

export function duration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/** Staggered animation-delay for lists (deal-in effect). */
export function stagger(index: number, reduced: boolean, step = 55): string {
  return reduced ? "0ms" : `${index * step}ms`;
}
