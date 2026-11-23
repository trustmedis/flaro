export const FIT_SNAP_POINT = "fit";

/**
 * How far a press on the grab bar may move and still count as a tap rather
 * than a drag: Base UI's own slop, the travel before it gives a gesture to an
 * axis.
 */
export const BAR_TAP_SLOP = 6;

/**
 * The height in px of a snap point, read as Base UI reads it: a number up to 1
 * is that share of the viewport's height, a larger number and a `px` string
 * are pixels, and a `rem` string is rems of the root font size. Anything else,
 * `"fit"` included, has no height of its own and gives null.
 */
export function resolveSnapPointHeight(
  point: number | string,
  viewportHeight: number,
  rootFontSize: number,
): number | null {
  if (typeof point === "number") {
    if (!Number.isFinite(point)) return null;
    if (point <= 1)
      return Math.min(Math.max(point, 0), 1) * Math.max(viewportHeight, 0);
    return point;
  }
  const value = point.trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;
  if (value.endsWith("px")) return amount;
  if (value.endsWith("rem")) return amount * rootFontSize;
  return null;
}

/**
 * The height of the `"fit"` snap point: the content's own height, at most
 * `max` (the resolved `fitMax`, when set) and at most `room`, the height the
 * viewport leaves the drawer. Whole pixels, so a measurement that moves by a
 * fraction does not move the drawer.
 */
export function fitSnapPointHeight({
  content,
  max,
  room,
}: {
  content: number;
  max?: number | null | undefined;
  room: number;
}): number {
  const limit = Math.min(max ?? Number.POSITIVE_INFINITY, room);
  return Math.max(0, Math.round(Math.min(content, limit)));
}

/**
 * The snap point the grab bar moves to, by index, with the snap points in
 * order from the lowest to the highest. A tap, Enter or Space (`toggle`) goes
 * one point up, and from the highest point one down; the arrow keys (`up`,
 * `down`) go one point and stop at the ends. An index outside the list starts
 * from the lowest point.
 */
export function nextSnapPointIndex(
  index: number,
  count: number,
  move: "toggle" | "up" | "down",
): number {
  if (count <= 0) return -1;
  const last = count - 1;
  const current = index >= 0 && index <= last ? index : 0;
  if (move === "up") return Math.min(current + 1, last);
  if (move === "down") return Math.max(current - 1, 0);
  if (last === 0) return 0;
  return current < last ? current + 1 : current - 1;
}
