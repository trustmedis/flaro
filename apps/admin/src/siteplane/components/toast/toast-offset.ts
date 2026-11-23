export type ToastOffset =
  | number
  | string
  | {
      top?: number | string | undefined;
      right?: number | string | undefined;
      bottom?: number | string | undefined;
      left?: number | string | undefined;
    };

const edges = ["top", "right", "bottom", "left"] as const;

function edgeProperties(
  offset: ToastOffset | undefined,
  prefix: string,
): Record<string, string> {
  const properties: Record<string, string> = {};
  if (offset === undefined) return properties;
  for (const edge of edges) {
    const value = typeof offset === "object" ? offset[edge] : offset;
    if (value === undefined) continue;
    properties[`${prefix}-${edge}`] =
      typeof value === "number" ? `${value}px` : value;
  }
  return properties;
}

/**
 * The custom properties that hand the offsets to the toast viewport, one for
 * every edge an offset names: `--toast-offset-<edge>` for `offset` and
 * `--toast-mobile-offset-<edge>` for `mobileOffset`. The viewport reads the
 * first from `sm` up and the second below it, and `--toast-inset` on an edge
 * that has none, so a provider without offsets sets nothing.
 */
export function toastOffsetProperties(
  offset: ToastOffset | undefined,
  mobileOffset: ToastOffset | undefined,
): Record<string, string> {
  return {
    ...edgeProperties(offset, "--toast-offset"),
    ...edgeProperties(mobileOffset, "--toast-mobile-offset"),
  };
}
