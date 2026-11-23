export const CHART_TOOLTIP_OFFSET = 16;

export type ChartPoint2D = { x: number; y: number };
export type ChartBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};
export type ChartCardSize = { height: number; width: number };

/** How the card sits against the vertical of its item: its top at it, or its middle. */
export type ChartTooltipAlign = "center" | "start";

export type ChartTooltipPlace = {
  /** The card is on the left of its item, because the right had no room. */
  flipped: boolean;
  /** The left and the top of the card, in the coordinates of the anchor and the bounds. */
  left: number;
  top: number;
};

/**
 * Whether the card dips: it has changed sides while it is shown and its place is
 * known (a card that is still a guess is put where it belongs, not moved), and
 * motion is not reduced (M5).
 */
export function dipsAtFlip({
  flipped,
  measured,
  open,
  reduced,
  wasFlipped,
}: {
  flipped: boolean;
  measured: boolean;
  open: boolean;
  reduced: boolean;
  wasFlipped: boolean;
}): boolean {
  return flipped !== wasFlipped && open && measured && !reduced;
}

/**
 * The left and the top of a card of `card` size beside an item at `anchor`,
 * which lies inside `bounds`. The card is to the right of the item, `offset`
 * away; where it would cross the right edge of the bounds it is on the left
 * instead, and where it would cross the left edge it is held to it. With
 * `start` its top is the item's (a chart whose crosshair runs top to bottom);
 * with `center` its middle is the item's, and the card is kept `offset` clear
 * of the top and the bottom of the bounds (a bar in a horizontal chart, a share
 * of a ring).
 */
export function placeChartTooltip({
  align,
  anchor,
  bounds,
  card,
  offset = CHART_TOOLTIP_OFFSET,
}: {
  align: ChartTooltipAlign;
  anchor: ChartPoint2D;
  bounds: ChartBounds;
  card: ChartCardSize;
  offset?: number;
}): ChartTooltipPlace {
  const flipped = anchor.x + offset + card.width > bounds.right;
  const left = Math.max(
    bounds.left,
    flipped ? anchor.x - offset - card.width : anchor.x + offset,
  );
  const top =
    align === "start"
      ? anchor.y
      : Math.max(
          bounds.top + offset,
          Math.min(
            anchor.y - card.height / 2,
            bounds.bottom - card.height - offset,
          ),
        );
  return { flipped, left, top };
}
