// Guard for overlapping loads: `begin()` marks a new load and returns a check that stays true only while it is the latest.
export function latestOnly() {
  let current = 0;
  return () => {
    const id = ++current;
    return () => id === current;
  };
}
