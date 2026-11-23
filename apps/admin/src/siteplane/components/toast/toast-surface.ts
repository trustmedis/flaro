export const toastSurfaceClassName =
  "sp-toast-surface sp-toast-replay-motion relative rounded-(--sp-rw-radius-control) bg-[color-mix(in_srgb,var(--sp-rw-surface-color),var(--color-black)_calc(1%*max(0,var(--toast-index,0))))] dark:bg-[color-mix(in_srgb,var(--sp-rw-surface-color),var(--color-black)_calc(6%*max(0,var(--toast-index,0))))]";

/**
 * Where the dismiss control sits on that surface: 8 px inside the top-end
 * corner, as the close of every overlay (rulebook B5). The control is the
 * CloseButton at its dense 24 px step, which owns its box, its 16 px glyph,
 * its colour and its hover; the surface owns only the corner. Text beside it
 * ends 8 px before it, 40 px from the edge (`pe-10`).
 */
export const toastDismissClassName = "absolute end-2 top-2 z-10";
