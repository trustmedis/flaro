import type * as React from "react";

import { Sidebar, SidebarProvider } from "./sidebar";

/*
 * Kit-internal SidebarProvider and Sidebar. Not public API: the sidebar index
 * does not export this module, and its names may change in any release.
 * Header Navigation renders its menu as the mobile Sidebar whenever the header
 * itself is narrow, whatever the width of the viewport, and its fullscreen menu
 * opens under its bar. Dashboard Shell's aside is a second Sidebar whose state
 * the shell holds, so the button in the shell's header reaches it.
 */
export type KitSidebarProviderProps = React.ComponentProps<
  typeof SidebarProvider
> & {
  /** Renders the Sidebar as its mobile sheet at every viewport width. */
  forceMobile?: boolean | undefined;
  /**
   * Whether the mobile sheet is open, held outside the provider as `open`
   * holds the desktop state; with `onOpenMobileChange`, which every change of
   * the sheet calls.
   */
  openMobile?: boolean | undefined;
  onOpenMobileChange?: ((open: boolean) => void) | undefined;
  /**
   * The element whose width sets the step of a resizable rail's arrow keys,
   * 5 % of it: the provider by default. The shell's aside takes the shell's
   * width, the layout its edge divides.
   */
  railStepElement?: ((rail: HTMLElement) => HTMLElement | null) | undefined;
};

/** SidebarProvider with the kit's mobile override; the same component. */
export const KitSidebarProvider = SidebarProvider as (
  props: KitSidebarProviderProps,
) => React.ReactElement;

/**
 * A bar that stays in view above the mobile sheet, as a header's bar stays
 * above its fullscreen menu: the sheet starts at the bar's bottom edge, the
 * button in the bar is the sheet's own trigger and the close as well, and the
 * page beside the sheet keeps its scroll position.
 */
export type SidebarMobileBar = {
  /** The button in the bar that opens and closes the sheet. */
  trigger: React.ReactElement;
  /** Where the sheet starts, from the top of the viewport: the bar's bottom. */
  offset: string;
};

export type KitSidebarProps = React.ComponentProps<typeof Sidebar> & {
  /** Opens the mobile sheet under a bar that stays in view. */
  mobileBar?: SidebarMobileBar | undefined;
  /**
   * The mobile sheet takes the width of a Sheet at the side of the screen, as
   * the panel beside the content does, not the navigation's 18rem.
   */
  sheetWidth?: boolean | undefined;
};

/** Sidebar with the kit's bar option for its mobile sheet; the same component. */
export const KitSidebar = Sidebar as (
  props: KitSidebarProps,
) => React.ReactElement;
