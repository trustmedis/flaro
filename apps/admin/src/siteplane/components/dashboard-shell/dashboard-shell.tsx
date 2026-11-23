"use client";

import * as React from "react";

import { useSiteplaneMessages } from "../../system/locale/messages-context";
import { cn } from "../../system/utils/cn";
import { slotClass } from "../../system/utils/slot-class";
import { CloseButton } from "../button";
import {
  Sidebar,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "../sidebar";
import { KitSidebar, KitSidebarProvider } from "../sidebar/sidebar-internal";
import { Toggle } from "../toggle";

export type DashboardShellLayout = "inset" | "push";

export interface DashboardShellProps extends React.ComponentProps<
  typeof SidebarProvider
> {
  layout?: DashboardShellLayout;
  /**
   * Keeps DashboardShellHeader in view while the content scrolls. Default
   * true. From the Sidebar's mobile breakpoint up, the shell is the
   * viewport's height and only DashboardShellMain scrolls. Below it the page
   * scrolls and the header sticks to the top of the viewport. Set false for a
   * page that scrolls as a whole: the shell is then at least the viewport's
   * height, and the header scrolls away with the page. A `contained` shell is
   * the height of its container instead, at every width, and only
   * DashboardShellMain scrolls.
   */
  stickyHeader?: boolean;
  /**
   * Whether DashboardShellAside, the panel beside the content, is open from
   * the Sidebar's mobile breakpoint up; with `onAsideOpenChange`. Below it
   * the aside is a sheet that starts closed.
   */
  asideOpen?: boolean;
  /** The aside's first desktop state, when `asideOpen` is not set. Default true. */
  defaultAsideOpen?: boolean;
  onAsideOpenChange?: (open: boolean) => void;
  /**
   * The cookie that keeps the aside's desktop state: its name, or `false` for
   * no cookie. Default `aside_state`, apart from the sidebar's
   * `sidebar_state`, so the two never overwrite each other. Read it on the
   * server and pass it to `defaultAsideOpen`.
   */
  asideStateCookie?: string | false;
}

/**
 * The panel beside the content: a Sidebar on the right with a provider of its
 * own. `collapsible` and `side` are its own: it collapses off the canvas, at
 * the inline end.
 */
export type DashboardShellAsideProps = Omit<
  React.ComponentProps<typeof Sidebar>,
  "collapsible" | "side"
>;

export interface DashboardShellAsideHeaderProps extends React.ComponentProps<
  typeof SidebarHeader
> {
  /**
   * Ends the row with the aside's close button, from the Sidebar's mobile
   * breakpoint up; on a phone the sheet's own close stands in the row.
   * Default true.
   */
  showCloseButton?: boolean;
}

export interface DashboardShellHeaderProps extends React.ComponentProps<"header"> {
  divider?: boolean;
}

export interface DashboardShellMainProps extends React.ComponentProps<"div"> {
  /**
   * Runs the content to the edges of the main area, without its padding, for
   * a view that lays out its own panes, such as a list beside a detail pane.
   */
  flush?: boolean;
}

// The parts that follow the shell's settings read them here. Outside a
// DashboardShell no sticky rule applies, so a part there keeps the Sidebar's
// own behaviour.
type DashboardShellSettings = {
  inShell: boolean;
  mobileBreakpoint: "lg" | "md" | undefined;
  stickyHeader: boolean;
};

const DashboardShellContext: React.Context<DashboardShellSettings> =
  React.createContext<DashboardShellSettings>({
    inShell: false,
    mobileBreakpoint: undefined,
    stickyHeader: false,
  });

// The aside's state. The shell holds it, so the button in its header, which
// stands under the sidebar's provider, reaches the aside's own provider, on a
// phone the state of its sheet as well.
type DashboardShellAsideState = {
  /** The aside's id, which the button names in aria-controls. */
  id: string;
  mobileBreakpoint: "lg" | "md";
  open: boolean;
  openMobile: boolean;
  setId: (id: string | undefined) => void;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  /** Hands the shell the button that opens the aside (`trigger`). */
  setTrigger: (element: HTMLElement | null) => void;
  stateCookie: string | false;
  /** The button that opens the aside, which takes the focus when it closes. */
  trigger: React.RefObject<HTMLElement | null>;
};

const DashboardShellAsideContext: React.Context<DashboardShellAsideState | null> =
  React.createContext<DashboardShellAsideState | null>(null);

// The name of the aside's close, which its first row's button shares with the
// close of its sheet on a phone.
const DashboardShellAsideCloseContext: React.Context<string | undefined> =
  React.createContext<string | undefined>(undefined);

function useAsideState(part: string): DashboardShellAsideState {
  const aside = React.useContext(DashboardShellAsideContext);
  if (!aside) throw new Error(`${part} must be used within a DashboardShell.`);
  return aside;
}

// The first row of a sidebar in the shell, the navigation's and the aside's:
// a band as tall as the top bar that centres its content on the bar's line,
// the logo, the workspace switcher or a title with its close alike, up to the
// bar's height. In the inset layout it moves down with the framed surface
// (rulebook S2; design-rework.css, "The first row of a sidebar").
const shellBandClassName =
  "min-h-(--dashboard-shell-header-height) shrink-0 py-0";

export function DashboardShell({
  asideOpen: asideOpenProp,
  asideStateCookie = "aside_state",
  children,
  className,
  contained = false,
  defaultAsideOpen = true,
  layout = "push",
  mobileBreakpoint = "md",
  onAsideOpenChange,
  stickyHeader = true,
  ...props
}: DashboardShellProps): React.ReactElement {
  const context = React.useMemo(
    () => ({ inShell: true, mobileBreakpoint, stickyHeader }),
    [mobileBreakpoint, stickyHeader],
  );
  const [asideOpenState, setAsideOpenState] = React.useState(defaultAsideOpen);
  const asideOpen = asideOpenProp ?? asideOpenState;
  const setAsideOpen = React.useCallback(
    (open: boolean) => {
      if (asideOpenProp === undefined) setAsideOpenState(open);
      onAsideOpenChange?.(open);
    },
    [asideOpenProp, onAsideOpenChange],
  );
  const [asideOpenMobile, setAsideOpenMobile] = React.useState(false);
  const generatedAsideId = React.useId();
  const [asideId, setAsideId] = React.useState<string>();
  const asideTrigger = React.useRef<HTMLElement | null>(null);
  const setAsideTrigger = React.useCallback((element: HTMLElement | null) => {
    asideTrigger.current = element;
  }, []);
  const aside = React.useMemo<DashboardShellAsideState>(
    () => ({
      id: asideId ?? generatedAsideId,
      mobileBreakpoint,
      open: asideOpen,
      openMobile: asideOpenMobile,
      setId: setAsideId,
      setOpen: setAsideOpen,
      setOpenMobile: setAsideOpenMobile,
      setTrigger: setAsideTrigger,
      stateCookie: asideStateCookie,
      trigger: asideTrigger,
    }),
    [
      asideId,
      asideOpen,
      asideOpenMobile,
      asideStateCookie,
      generatedAsideId,
      mobileBreakpoint,
      setAsideOpen,
      setAsideTrigger,
    ],
  );
  return (
    <DashboardShellContext.Provider value={context}>
      <DashboardShellAsideContext.Provider value={aside}>
        <SidebarProvider
          className={cn(!contained && "min-h-svh", className)}
          contained={contained}
          // The bar height and the sidebar width are the stylesheet's
          // (design-rework.css, "Dashboard Shell"); an app's style overrides
          // them. So are the sticky header's rules, which switch at the
          // Sidebar's mobile breakpoint.
          data-dashboard-shell="root"
          data-mobile-breakpoint={stickyHeader ? mobileBreakpoint : undefined}
          data-sticky-header={stickyHeader || undefined}
          layout={layout}
          mobileBreakpoint={mobileBreakpoint}
          {...props}
        >
          {children}
        </SidebarProvider>
      </DashboardShellAsideContext.Provider>
    </DashboardShellContext.Provider>
  );
}

export function DashboardShellSidebar({
  className,
  collapsible = "icon",
  ...props
}: React.ComponentProps<typeof Sidebar>): React.ReactElement {
  return (
    <Sidebar
      className={className}
      collapsible={collapsible}
      data-dashboard-shell="sidebar"
      {...props}
    />
  );
}

export function DashboardShellSidebarHeader({
  className,
  ...props
}: React.ComponentProps<typeof SidebarHeader>): React.ReactElement {
  return (
    <SidebarHeader
      // Content up to the band's height centres in it, level with the top bar
      // beside it (rulebook S2).
      className={cn(shellBandClassName, "justify-center", className)}
      data-dashboard-shell="sidebar-header"
      data-slot="sidebar-header"
      {...props}
    />
  );
}

// A resizable rail of the aside moves its edge by 5 % of the shell, the
// layout its edge divides, not of the aside's own provider, which is only as
// wide as the aside.
function asideRailStepElement(rail: HTMLElement): HTMLElement | null {
  return rail.closest<HTMLElement>('[data-dashboard-shell="root"]');
}

/**
 * The panel beside the content, such as an assistant, the details of a
 * record or comments: a Sidebar at the inline end with a provider of its own,
 * after DashboardShellInset. From the Sidebar's mobile breakpoint up it
 * stands on the page beside the content and pushes it aside, collapses off
 * the canvas and slides at the sidebar's pace; a resizable SidebarRail in it
 * is the splitter handle of its edge. Below the breakpoint it is a sheet as
 * wide as a Sheet at the side of the screen. The shell holds its state
 * (`asideOpen`, `defaultAsideOpen`, `onAsideOpenChange`), and
 * DashboardShellAsideTrigger in the header opens and closes it. Ctrl/Cmd+B
 * stays with the sidebar.
 */
export function DashboardShellAside({
  closeLabel,
  id,
  ...props
}: DashboardShellAsideProps): React.ReactElement {
  const aside = useAsideState("DashboardShellAside");
  const { setId } = aside;
  // A consumer's id names the aside for the button's aria-controls.
  React.useEffect(() => {
    if (id === undefined) return;
    setId(id);
    return () => setId(undefined);
  }, [id, setId]);
  return (
    <DashboardShellAsideCloseContext.Provider value={closeLabel}>
      <KitSidebarProvider
        // As wide as the aside's gap. The shell around it holds the aside as
        // it holds the sidebar: fixed to the screen, or absolute in a
        // contained shell.
        className="min-h-0 w-auto shrink-0"
        data-dashboard-shell="aside-provider"
        keyboardShortcut={false}
        mobileBreakpoint={aside.mobileBreakpoint}
        onOpenChange={aside.setOpen}
        onOpenMobileChange={aside.setOpenMobile}
        open={aside.open}
        openMobile={aside.openMobile}
        railStepElement={asideRailStepElement}
        stateCookie={aside.stateCookie}
      >
        <KitSidebar
          {...(closeLabel === undefined ? null : { closeLabel })}
          collapsible="offcanvas"
          data-dashboard-shell="aside"
          id={id ?? aside.id}
          sheetWidth
          side="right"
          {...props}
        />
      </KitSidebarProvider>
    </DashboardShellAsideCloseContext.Provider>
  );
}

/**
 * The aside's first row: a band as tall as the top bar, level with it, that
 * holds a title and ends with the aside's close button. The row starts 16 px
 * in, as the header and the main area do, and the 28 px close stands 8 px
 * from the aside's edge. On a phone the row is the sheet's first row, beside
 * the sheet's own close.
 */
export function DashboardShellAsideHeader({
  children,
  className,
  showCloseButton = true,
  ...props
}: DashboardShellAsideHeaderProps): React.ReactElement {
  const { isMobile, setOpen } = useSidebar();
  const aside = React.useContext(DashboardShellAsideContext);
  const closeLabel = React.useContext(DashboardShellAsideCloseContext);
  const messages = useSiteplaneMessages("sidebar");
  return (
    <SidebarHeader
      className={cn(
        shellBandClassName,
        "flex-row items-center justify-start gap-2 ps-4",
        className,
      )}
      data-dashboard-shell="aside-header"
      data-slot="sidebar-header"
      {...props}
    >
      {children}
      {showCloseButton && !isMobile ? (
        <CloseButton
          className="ms-auto"
          label={closeLabel ?? messages.close}
          onClick={() => {
            setOpen(false);
            // The aside leaves the Tab order as it slides out, so the focus
            // goes back to the button that opens it.
            aside?.trigger.current?.focus({ preventScroll: true });
          }}
          size="xs"
        />
      ) : null}
    </SidebarHeader>
  );
}

/**
 * The header's button that opens and closes DashboardShellAside: a Toggle,
 * pressed while the aside is open. Like SidebarTrigger it names the aside in
 * aria-controls and says whether it is open in aria-expanded; below the
 * Sidebar's mobile breakpoint it opens the aside's sheet. Give it an icon and
 * a label, or an icon with an aria-label.
 */
export function DashboardShellAsideTrigger({
  onClick,
  onPressedChange,
  ref,
  ...props
}: React.ComponentProps<typeof Toggle>): React.ReactElement {
  const aside = useAsideState("DashboardShellAsideTrigger");
  // The shell's provider: the aside switches to its sheet at the same
  // breakpoint.
  const { isMobile } = useSidebar();
  const open = isMobile ? aside.openMobile : aside.open;
  const { setTrigger: setShellTrigger } = aside;
  const setTrigger = React.useCallback(
    (element: HTMLButtonElement | null) => {
      setShellTrigger(element);
      assignRef(ref, element);
    },
    [ref, setShellTrigger],
  );
  return (
    <Toggle
      aria-controls={isMobile && !aside.openMobile ? undefined : aside.id}
      aria-expanded={open}
      // It discloses the aside, as SidebarTrigger does its sidebar: the
      // state is aria-expanded, not a pressed state as well.
      aria-pressed={undefined}
      data-dashboard-shell="aside-trigger"
      data-slot="dashboard-shell-aside-trigger"
      onClick={(event) => {
        onClick?.(event);
        // The sheet on a phone returns the focus to the element that had it
        // when it opened. Safari focuses no button it presses, so the button
        // takes the focus itself, without the keyboard ring (SidebarTrigger).
        const button = event.currentTarget;
        if (button.ownerDocument.activeElement !== button)
          button.focus({
            focusVisible: false,
            preventScroll: true,
          } as FocusOptions);
      }}
      onPressedChange={(pressed, details) => {
        onPressedChange?.(pressed, details);
        if (isMobile) aside.setOpenMobile(pressed);
        else aside.setOpen(pressed);
      }}
      pressed={open}
      ref={setTrigger}
      {...props}
    />
  );
}

export function DashboardShellInset({
  className,
  ...props
}: React.ComponentProps<typeof SidebarInset>): React.ReactElement {
  const { inShell } = React.useContext(DashboardShellContext);
  return (
    <SidebarInset
      // Sticky content sticks to its nearest scroll container. In a shell the
      // inset clips its content without becoming one (overflow: clip, where
      // the Sidebar's inset is hidden), so where the page scrolls, below the
      // breakpoint and with stickyHeader={false} at every width, the header
      // and a sticky bar of the app's own in the content stick to the
      // viewport. A Table's sticky heading row sticks to the table's own
      // scrolling container.
      className={cn(inShell && "overflow-clip", className)}
      data-dashboard-shell="inset"
      {...props}
    />
  );
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as React.RefObject<T | null>).current = value;
}

export function DashboardShellHeader({
  className,
  divider = true,
  ref,
  ...props
}: DashboardShellHeaderProps): React.ReactElement {
  // The header sits on the main surface (B1), never on the page canvas: it has
  // no fill of its own, so the sidebar and the content never share one grey.
  // Its inline inset is the main area's 16 px in both layouts and at every
  // width, so a title in it starts on the content's line; a leading sidebar
  // trigger puts its glyph on that line (design-rework.css, "Dashboard Shell
  // header"). In the push layout SidebarInset moves the header clear of the
  // expanded sidebar with the rest of the content. With the shell's
  // stickyHeader, the default, it sticks to the top below the breakpoint,
  // filled with the surface it sits on there, so the content scrolls under it
  // unseen. Below the breakpoint it is the phone bar that holds the menu
  // button, 56 px tall like Header Navigation's (B15): it names the breakpoint
  // in data-menu-bar, and the stylesheet switches its height there.
  const { inShell, mobileBreakpoint } = React.useContext(DashboardShellContext);
  // A header taller than its bar, whose title took a row of its own beside an
  // overflow Toolbar (rulebook T12), hands its height to the shell, so a
  // sticky bar of the page that takes --sp-dashboard-shell-header-offset as
  // its top stops under all of its rows (design-rework.css, "Dashboard Shell
  // sticky header"). A header of one row leaves the bar's height in place.
  const header = React.useCallback(
    (element: HTMLElement | null) => {
      assignRef(ref, element);
      if (!element || !inShell || typeof ResizeObserver === "undefined") return;
      const shell = element.closest<HTMLElement>(
        '[data-dashboard-shell="root"]',
      );
      if (!shell) return;
      const name = "--dashboard-shell-header-block-size";
      const publish = () => {
        const height = element.getBoundingClientRect().height;
        const bar = Number.parseFloat(getComputedStyle(element).minHeight) || 0;
        if (height > bar + 1) shell.style.setProperty(name, `${height}px`);
        else shell.style.removeProperty(name);
      };
      publish();
      const observer = new ResizeObserver(publish);
      observer.observe(element);
      return () => {
        observer.disconnect();
        shell.style.removeProperty(name);
        assignRef(ref, null);
      };
    },
    [inShell, ref],
  );
  return (
    <header
      className={cn(
        slotClass("dashboard-shell-header", props),
        "flex min-h-(--dashboard-shell-header-height) shrink-0 items-center gap-2 px-4",
        className,
      )}
      data-dashboard-shell="header"
      data-divider={divider ? "true" : "false"}
      data-menu-bar={inShell ? mobileBreakpoint : undefined}
      data-slot="dashboard-shell-header"
      ref={header}
      {...props}
    />
  );
}

/**
 * The title of the header's row: one line that ends with an ellipsis. Beside
 * an overflow Toolbar it gives up its room before any action leaves, down to
 * a floor of 6rem or its words, and takes a row of its own where even the
 * toolbar's More actions button and the actions that keep their place do not
 * fit beside it at that floor (rulebook T12; design-rework.css). A `div` by
 * default; `render={<h1 />}` makes it the page's heading.
 */
export function DashboardShellHeaderTitle({
  className,
  render,
  ...props
}: React.ComponentProps<"div"> & {
  /**
   * Another element to render the title as, such as `<h1 />` for the page's
   * heading; it takes the title's props and its own `className` stays.
   */
  render?: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}): React.ReactElement {
  // A composite of the shell installs no UI foundation (Wave G), so the title
  // takes its element by a plain clone, as the kit's Button and Input do.
  const titleProps = {
    className: cn(
      slotClass("dashboard-shell-header-title", props, render),
      className,
    ),
    "data-slot": "dashboard-shell-header-title",
    ...props,
  };
  if (render) {
    return React.cloneElement(render, {
      ...titleProps,
      className: cn(titleProps.className, render.props.className),
    });
  }
  return <div {...titleProps} />;
}

export function DashboardShellMain({
  className,
  flush = false,
  ...props
}: DashboardShellMainProps): React.ReactElement {
  // It scrolls on its own only where the shell is the viewport's height
  // (design-rework.css, "Dashboard Shell sticky header"). Elsewhere the page
  // scrolls, and a scroll container here would hold every sticky bar inside
  // it to a box that never scrolls.
  return (
    <div
      className={cn(
        slotClass("dashboard-shell-main", props),
        "min-h-0 flex-1",
        !flush && "p-4",
        className,
      )}
      data-dashboard-shell="main"
      data-flush={flush || undefined}
      data-slot="dashboard-shell-main"
      {...props}
    />
  );
}

export function DashboardShellPrimary({
  className,
  ...props
}: React.ComponentProps<"section">): React.ReactElement {
  // It clips its content without becoming a scroll container (overflow:
  // clip, as the inset does), so a sticky bar of the app's own in the content
  // sticks to the part that scrolls: the page below the breakpoint, and
  // DashboardShellMain from it up. With overflow hidden it was a scroll
  // container that never scrolls, and nothing in it stuck.
  // It names its slot as the header and the main area do.
  return (
    <section
      className={cn(
        slotClass("dashboard-shell-primary", props),
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-clip",
        className,
      )}
      data-dashboard-shell="primary"
      data-slot="dashboard-shell-primary"
      {...props}
    />
  );
}

export { SidebarTrigger as DashboardShellSidebarTrigger };
