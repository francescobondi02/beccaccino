// Phones only: desktop and tablets play fine in a normal window.
function isPhone() {
  return window.matchMedia("(pointer: coarse)").matches &&
    Math.min(window.screen.width, window.screen.height) < 600;
}

export function canEnterGameFullscreen() {
  return Boolean(document.fullscreenEnabled) && isPhone();
}

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
};

// Browsers only allow orientation locks in fullscreen, and iPhone Safari
// supports neither, so every failure leaves the page usable as it is.
export async function enterGameFullscreen() {
  if (!canEnterGameFullscreen()) return;
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
    await (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape");
  } catch {
    // Denied or unsupported: the rotate prompt still explains what to do.
  }
}

export function exitGameFullscreen() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Nothing was locked.
  }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}
