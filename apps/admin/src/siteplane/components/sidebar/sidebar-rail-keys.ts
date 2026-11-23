export type SidebarRailKeyAction =
  | { type: "none" }
  | { type: "open"; width?: number }
  | { type: "resize"; width: number }
  | { type: "toggle" };

/** The step of an arrow key, a share of the provider's width. */
export const sidebarRailKeyStep = 0.05;

/**
 * The step of an arrow key in px: 5% of the layout the rail's edge divides,
 * the provider's own element unless the provider names another. The
 * Dashboard Shell's aside has a provider of its own, as wide as the aside, so
 * it names the shell (sidebar-internal.ts).
 */
export function sidebarRailStepWidth(
  rail: HTMLElement,
  provider: HTMLElement,
  stepElement?: ((rail: HTMLElement) => HTMLElement | null) | undefined,
): number {
  const layout = stepElement?.(rail) ?? provider;
  return layout.getBoundingClientRect().width * sidebarRailKeyStep;
}

export function sidebarRailKeyAction(
  key: string,
  sidebar: {
    /** The sidebar is expanded, not collapsed. */
    expanded: boolean;
    /** The widest and the narrowest the sidebar can be, in px. */
    max: number;
    min: number;
    /** The sidebar stands on the right of the screen, its edge on its left. */
    physicalRight: boolean;
    /** The width an arrow key moves the edge, in px. */
    step: number;
    /** The sidebar's width, in px. */
    width: number;
  },
): SidebarRailKeyAction | null {
  const { expanded, max, min, physicalRight, step, width } = sidebar;
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  const grow = physicalRight ? "ArrowLeft" : "ArrowRight";
  const shrink = physicalRight ? "ArrowRight" : "ArrowLeft";
  if (key === "Enter") return { type: "toggle" };
  if (key === "End")
    return expanded
      ? { type: "resize", width: max }
      : { type: "open", width: max };
  if (key === "Home")
    return expanded ? { type: "resize", width: min } : { type: "none" };
  if (key === grow)
    return expanded
      ? { type: "resize", width: clamp(width + step) }
      : { type: "open" };
  if (key === shrink)
    return expanded
      ? { type: "resize", width: clamp(width - step) }
      : { type: "none" };
  return null;
}
