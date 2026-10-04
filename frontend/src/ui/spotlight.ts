/** Pointer-driven presentation effects, installed once from main.tsx.
 *
 * One delegated, passive `pointermove` listener feeds CSS custom properties to whatever
 * surface is under the cursor:
 *  - `.MuiCard-root` / `.rmis-spot` get `--mx`/`--my` (cursor position inside the element),
 *    which ui/spatial.css uses for the glowing spotlight + border highlight.
 *  - `.rmis-tilt` gets `--tilt-x`/`--tilt-y` (a few degrees of rotation toward the cursor)
 *    for the 3D parallax cards and the Risk Core.
 *
 * Purely cosmetic: it only writes CSS variables, never touches app state, and is a no-op
 * for touch/pen input and for users who prefer reduced motion. */

const SPOT_SELECTOR = ".MuiCard-root, .rmis-spot";
const TILT_SELECTOR = ".rmis-tilt";
const MAX_TILT_DEG = 7;

let installed = false;

export function installSpotlight(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let frame = 0;
  let lastEvent: PointerEvent | null = null;
  let lastTilt: HTMLElement | null = null;

  const apply = () => {
    frame = 0;
    const event = lastEvent;
    if (!event) return;
    const target = event.target instanceof Element ? event.target : null;

    const spot = target?.closest<HTMLElement>(SPOT_SELECTOR);
    if (spot) {
      const rect = spot.getBoundingClientRect();
      spot.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      spot.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }

    if (reduceMotion) return;
    const tilt = target?.closest<HTMLElement>(TILT_SELECTOR) ?? null;
    if (lastTilt && lastTilt !== tilt) {
      lastTilt.style.setProperty("--tilt-x", "0deg");
      lastTilt.style.setProperty("--tilt-y", "0deg");
    }
    if (tilt) {
      const rect = tilt.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      tilt.style.setProperty("--tilt-x", `${(-py * MAX_TILT_DEG).toFixed(2)}deg`);
      tilt.style.setProperty("--tilt-y", `${(px * MAX_TILT_DEG).toFixed(2)}deg`);
    }
    lastTilt = tilt;
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse") return;
      lastEvent = event;
      if (!frame) frame = window.requestAnimationFrame(apply);
    },
    { passive: true },
  );

  document.addEventListener("pointerleave", () => {
    if (lastTilt) {
      lastTilt.style.setProperty("--tilt-x", "0deg");
      lastTilt.style.setProperty("--tilt-y", "0deg");
      lastTilt = null;
    }
  });
}
