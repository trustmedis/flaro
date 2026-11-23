"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSiteplaneMessages } from "../../system/locale/messages-context";
import { cn, type WithStringClassName } from "../../system/utils/cn";
import { slotClass } from "../../system/utils/slot-class";
import {
  type ChoiceIndicatorPosition,
  choiceMenuItemRadioCloseProps,
  menuRowStack,
} from "../../system/styles/choice-menu-item";
import { surfaceClassNames } from "../../system/styles/surface";
import { CloseButton } from "../button";
import { KitButton } from "../button/button-internal";
import {
  menuGroupLabelClassName,
  menuSeparatorClassName,
} from "./drawer-menu-shared";
import { type CheckboxProps } from "../checkbox";
import { KitCheckbox } from "../checkbox/checkbox-internal";
import { type RadioGroupProps, type RadioProps } from "../radio-group";
import { KitRadioGroup, KitRadio } from "../radio-group/radio-group-internal";
import { ScrollArea } from "../scroll-area";
import { type SwitchProps } from "../switch";
import { KitSwitch } from "../switch/switch-internal";
import {
  type SiteplaneControlSize,
  SiteplaneUIPortalScope,
  useResolvedControlSize,
} from "../../system/provider/siteplane-ui-provider";
import {
  BAR_TAP_SLOP,
  FIT_SNAP_POINT,
  fitSnapPointHeight,
  nextSnapPointIndex,
  resolveSnapPointHeight,
} from "./drawer-snap-points";

import "./drawer.css";

type DrawerPosition = "right" | "left" | "top" | "bottom";

type DrawerSnapPoint = DrawerPrimitive.Root.SnapPoint;

/** How the grab bar moves the drawer: a tap, Enter or Space, or an arrow key. */
type DrawerSnapMove = "toggle" | "up" | "down";

/** The snap points of a bottom drawer, which its popup and its bar act on. */
type DrawerSnapContextValue = {
  /** The snap points as the app passes them, from the lowest to the highest. */
  points: readonly DrawerSnapPoint[];
  /** The index of the active snap point, or -1. */
  index: number;
  /** Whether the popup measures its content for the `"fit"` snap point. */
  measuresFit: boolean;
  /**
   * Whether a snap point lies above `"fit"`: the popup is then as high as the
   * viewport lets it be, so that point can be higher than the content.
   */
  fullHeight: boolean;
  /** The most the `"fit"` snap point takes, as a snap point value. */
  fitMax: DrawerSnapPoint | undefined;
  /** The snap point from which the scrim dims the page. */
  fadeFromIndex: number | undefined;
  /**
   * Whether the drawer stands at or above `fadeFromIndex`: the scrim dims the
   * page, and the drawer is modal there.
   */
  dimmed: boolean;
  /**
   * Whether the drawer rests as its bar: it cannot be dismissed and stands at
   * its lowest snap point, so its panel and footer step out.
   */
  collapsed: boolean;
  /** Moves the drawer to another snap point, as its grab bar does. */
  move: (move: DrawerSnapMove, event: Event, trigger?: Element) => void;
  /** Hands the popup's measured `"fit"` height to the root. */
  reportFit: (height: number) => void;
  /**
   * Hands the popup element to the root, which an Escape has to come from to
   * lower the drawer.
   */
  setPopup: (node: HTMLElement | null) => void;
};

type DrawerContextValue = {
  position: DrawerPosition;
  /**
   * Closes the drawer, as DrawerClose does: a radio row of its DrawerMenu
   * calls it when it is picked.
   */
  close?: (() => void) | undefined;
  /**
   * Base UI's `modal`. A drawer that is not modal leaves the page in reach:
   * its popup draws no scrim of its own and lets the page take its taps.
   */
  modal: boolean | "trap-focus";
  /** The snap points of a bottom drawer that has them. */
  snap?: DrawerSnapContextValue | undefined;
};

const DrawerContext: React.Context<DrawerContextValue> =
  createContext<DrawerContextValue>({
    modal: true,
    position: "bottom",
  });

/**
 * The ways a user dismisses a drawer; `dismissible={false}` turns them down.
 * DrawerClose, the trigger and the imperative `close()` are the app's own and
 * still close it.
 */
const userDismissals: ReadonlySet<string> = new Set([
  "close-watcher",
  "escape-key",
  "focus-out",
  "outside-press",
  "swipe",
]);

/**
 * The details of a snap point change the kit makes itself, through the grab
 * bar or by turning down a dismissal, in the shape Base UI hands its own:
 * `cancel()` keeps the drawer where it is.
 */
function snapPointChangeDetails(
  reason: DrawerPrimitive.Root.SnapPointChangeEventReason,
  event: Event,
  trigger?: Element,
): DrawerPrimitive.Root.SnapPointChangeEventDetails {
  let canceled = false;
  let propagationAllowed = false;
  return {
    reason,
    event,
    trigger,
    cancel() {
      canceled = true;
    },
    allowPropagation() {
      propagationAllowed = true;
    },
    get isCanceled() {
      return canceled;
    },
    get isPropagationAllowed() {
      return propagationAllowed;
    },
  } as DrawerPrimitive.Root.SnapPointChangeEventDetails;
}

const directionMap: Record<
  DrawerPosition,
  DrawerPrimitive.Root.Props["swipeDirection"]
> = {
  bottom: "down",
  left: "left",
  right: "right",
  top: "up",
};

export const DrawerCreateHandle: typeof DrawerPrimitive.createHandle =
  DrawerPrimitive.createHandle;

type DrawerProps = DrawerPrimitive.Root.Props & {
  position?: DrawerPosition;
  /**
   * Whether the user can dismiss the drawer: with a swipe, a press outside it,
   * Escape, focus that leaves it or the back gesture of Android. `false` keeps
   * it open, as Vaul's `dismissible` does: a swipe past the lowest snap point
   * rests the drawer there, and at that point a bottom drawer with snap points
   * folds to its header, its bar. Escape inside the drawer lowers it from its
   * highest snap point to the next. DrawerClose, the trigger and the
   * imperative `close()` still close it, and so does `open`.
   */
  dismissible?: boolean | undefined;
  /**
   * The most the `"fit"` snap point takes, in the units of a snap point: a
   * share of the viewport's height up to 1, or pixels or rems. Unset, `"fit"`
   * is as high as the content, at most the drawer's full height.
   */
  fitMax?: DrawerSnapPoint | undefined;
  /**
   * The index of the snap point from which the kit's scrim dims the page, as
   * Vaul's `fadeFromIndex`. At that point and above it the scrim shows and
   * the drawer is modal, as Apple's sheet is above its largest undimmed
   * detent: the scrim takes the page's taps, the focus stays in the drawer
   * and the page does not scroll. Below it a drawer that is not modal leaves
   * the page in reach again. The scrim fades with the drawer's motion, and
   * follows the drag between the last two points. Unset, a modal drawer dims
   * at its highest snap point and a drawer that is not modal never does.
   */
  fadeFromIndex?: number | undefined;
};

export function Drawer({
  actionsRef,
  swipeDirection,
  position = "bottom",
  modal = true,
  dismissible = true,
  disablePointerDismissal = false,
  onOpenChange,
  snapPoints,
  snapPoint: snapPointProp,
  defaultSnapPoint,
  onSnapPointChange,
  fitMax,
  fadeFromIndex,
  ...props
}: DrawerProps): React.ReactElement {
  // The drawer's imperative actions, in the app's ref when it passes one: a
  // radio row of the drawer's menu closes the drawer through them.
  const ownActions = useRef<DrawerPrimitive.Root.Actions | null>(null);
  const actions = actionsRef ?? ownActions;
  const popupRef = useRef<HTMLElement | null>(null);
  const setPopup = useCallback((node: HTMLElement | null) => {
    popupRef.current = node;
  }, []);

  // The kit holds the active snap point and hands Base UI its value, so it
  // can resolve "fit" to a height, move the drawer from its grab bar and keep
  // a drawer that cannot be dismissed on its lowest point. The app controls
  // it with `snapPoint` or leaves it to the kit, from `defaultSnapPoint`.
  const points = snapPoints && snapPoints.length > 0 ? snapPoints : undefined;
  const firstPoint =
    defaultSnapPoint !== undefined ? defaultSnapPoint : (points?.[0] ?? null);
  const [ownPoint, setOwnPoint] = useState<DrawerSnapPoint | null>(firstPoint);
  const controlled = snapPointProp !== undefined;
  const chosen = controlled ? snapPointProp : ownPoint;
  const active =
    points &&
    !controlled &&
    (chosen === null || !points.some((point) => Object.is(point, chosen)))
      ? firstPoint
      : chosen;
  const index = points
    ? points.findIndex((point) => Object.is(point, active))
    : -1;

  // "fit" is the content's height, which the popup measures. Until it has,
  // the drawer takes fitMax, or its full height.
  const [fit, setFit] = useState<number | null>(null);
  const reportFit = useCallback(
    (height: number) =>
      setFit((current) => (current === height ? current : height)),
    [],
  );
  const fitValue: DrawerSnapPoint = fit === null ? (fitMax ?? 1) : `${fit}px`;
  const resolvePoint = (value: DrawerSnapPoint) =>
    value === FIT_SNAP_POINT ? fitValue : value;
  const toBase = (value: DrawerSnapPoint | null) =>
    value === null ? null : resolvePoint(value);
  const basePoints = points?.map(resolvePoint);
  const fromBase = (value: DrawerSnapPoint | null) => {
    if (value === null || !points || !basePoints) return value;
    const found = basePoints.findIndex((point) => Object.is(point, value));
    return found === -1 ? value : (points[found] ?? value);
  };

  // A change to the snap point the drawer already shows changes nothing: Base
  // UI reports the point a drag ends on, also after a tap on the bar has
  // already moved the drawer in the same event.
  const commit = (
    next: DrawerSnapPoint | null,
    details: DrawerPrimitive.Root.SnapPointChangeEventDetails,
  ) => {
    if (Object.is(next, active)) return;
    onSnapPointChange?.(next, details);
    if (details.isCanceled) return;
    if (!controlled) setOwnPoint(next);
  };

  const bottomSnap = position === "bottom" && points !== undefined;
  const fitIndex = points ? points.indexOf(FIT_SNAP_POINT) : -1;
  const lowest = points?.[0];
  const collapsed =
    bottomSnap &&
    !dismissible &&
    points.length > 1 &&
    index === 0 &&
    lowest !== FIT_SNAP_POINT;
  // At `fadeFromIndex` and above it the scrim dims the page, and the drawer
  // is modal, as Apple's sheet is above its largest undimmed detent: Base UI
  // keeps the focus in it, hides the page from assistive technology and locks
  // its scroll. Below that point it takes the app's `modal` again.
  const dimmed =
    bottomSnap && fadeFromIndex !== undefined && index >= fadeFromIndex;

  const move = (kind: DrawerSnapMove, event: Event, trigger?: Element) => {
    if (!points) return;
    const next = points[nextSnapPointIndex(index, points.length, kind)];
    if (next === undefined) return;
    commit(next, snapPointChangeDetails("trigger-press", event, trigger));
  };
  // The bar's handlers keep one function, which calls the latest move.
  const moveRef = useRef(move);
  useLayoutEffect(() => {
    moveRef.current = move;
  });
  const stableMove = useCallback(
    (kind: DrawerSnapMove, event: Event, trigger?: Element) =>
      moveRef.current(kind, event, trigger),
    [],
  );

  const handleOpenChange = (
    open: boolean,
    details: DrawerPrimitive.Root.ChangeEventDetails,
  ) => {
    if (!open && !dismissible && userDismissals.has(details.reason)) {
      // The drawer stays. A swipe past its lowest point rests it there, and
      // Escape inside it lowers it from its highest point to the next.
      details.cancel();
      if (!bottomSnap) return;
      if (details.reason === "swipe") {
        if (lowest !== undefined)
          commit(lowest, snapPointChangeDetails("swipe", details.event));
      } else if (
        details.reason === "escape-key" &&
        index > 0 &&
        index === points.length - 1
      ) {
        const target = details.event.target;
        const below = points[index - 1];
        if (
          below !== undefined &&
          target instanceof Node &&
          popupRef.current?.contains(target)
        )
          commit(below, snapPointChangeDetails("escape-key", details.event));
      }
      return;
    }
    onOpenChange?.(open, details);
  };

  const context = useMemo<DrawerContextValue>(
    () => ({
      close: () => actions.current?.close(),
      modal,
      position,
      snap: bottomSnap
        ? {
            collapsed,
            dimmed,
            fadeFromIndex,
            fitMax,
            fullHeight: fitIndex !== -1 && fitIndex < points.length - 1,
            index,
            measuresFit: fitIndex !== -1,
            move: stableMove,
            points,
            reportFit,
            setPopup,
          }
        : undefined,
    }),
    [
      actions,
      bottomSnap,
      collapsed,
      dimmed,
      fadeFromIndex,
      fitIndex,
      fitMax,
      index,
      modal,
      points,
      position,
      reportFit,
      setPopup,
      stableMove,
    ],
  );

  const snapProps: Partial<DrawerPrimitive.Root.Props> = points
    ? {
        defaultSnapPoint: toBase(firstPoint),
        onSnapPointChange: (value, details) => {
          // A swipe past the lowest point asks to close; a drawer that stays
          // open keeps its point until the request is turned down.
          if (value === null && !dismissible) return;
          commit(fromBase(value), details);
        },
        snapPoint: toBase(active),
        snapPoints: basePoints,
      }
    : {
        defaultSnapPoint,
        onSnapPointChange,
        snapPoint: snapPointProp,
        snapPoints,
      };

  return (
    <DrawerContext.Provider value={context}>
      <DrawerPrimitive.Root
        actionsRef={actions}
        disablePointerDismissal={disablePointerDismissal || !dismissible}
        modal={dimmed ? true : modal}
        onOpenChange={handleOpenChange}
        swipeDirection={swipeDirection ?? directionMap[position]}
        {...snapProps}
        {...props}
      />
    </DrawerContext.Provider>
  );
}

// Base UI's own Portal type, with className narrowed to a string.
export const DrawerPortal: (
  props: WithStringClassName<Omit<DrawerPrimitive.Portal.Props, "ref">> &
    React.RefAttributes<HTMLDivElement>,
) => React.JSX.Element | null = DrawerPrimitive.Portal;

export function DrawerTrigger(
  props: WithStringClassName<DrawerPrimitive.Trigger.Props>,
): React.ReactElement {
  return (
    <DrawerPrimitive.Trigger
      data-slot="drawer-trigger"
      {...props}
      className={cn(slotClass("drawer-trigger", props), props.className)}
    />
  );
}

export function DrawerClose(
  props: WithStringClassName<DrawerPrimitive.Close.Props>,
): React.ReactElement {
  return (
    <DrawerPrimitive.Close
      data-slot="drawer-close"
      {...props}
      className={cn(slotClass("drawer-close", props), props.className)}
    />
  );
}

export function DrawerSwipeArea({
  className,
  position: positionProp,
  ...props
}: WithStringClassName<DrawerPrimitive.SwipeArea.Props> & {
  position?: DrawerPosition;
}): React.ReactElement {
  const { position: contextPosition } = useContext(DrawerContext);
  const position = positionProp ?? contextPosition;

  return (
    <DrawerPrimitive.SwipeArea
      className={cn(
        slotClass("drawer-swipe-area", props),
        "fixed z-50 touch-none",
        position === "bottom" && "inset-x-0 bottom-0 h-8",
        position === "top" && "inset-x-0 top-0 h-8",
        position === "left" && "inset-y-0 left-0 w-8",
        position === "right" && "inset-y-0 right-0 w-8",
        className,
      )}
      data-slot="drawer-swipe-area"
      {...props}
    />
  );
}

export function DrawerBackdrop({
  className,
  ...props
}: WithStringClassName<DrawerPrimitive.Backdrop.Props>): React.ReactElement {
  return (
    <DrawerPrimitive.Backdrop
      className={cn(
        // The fade is drawer.css's, so reduced motion can make it instant.
        slotClass("drawer-backdrop", props),
        "fixed inset-0 z-50 opacity-[calc(1-var(--drawer-swipe-progress))] data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute",
        className,
      )}
      data-slot="drawer-backdrop"
      {...props}
    />
  );
}

export function DrawerViewport({
  className,
  position,
  variant = "default",
  ...props
}: WithStringClassName<DrawerPrimitive.Viewport.Props> & {
  position?: DrawerPosition;
  variant?: "default" | "straight" | "inset";
}): React.ReactElement {
  return (
    <DrawerPrimitive.Viewport
      className={cn(
        slotClass("drawer-viewport", props),
        "fixed inset-0 z-50 [--bleed:--spacing(12)] [--inset:0px]",
        "touch-none",
        position === "bottom" && "grid grid-rows-[1fr_auto] pt-12",
        position === "top" && "grid grid-rows-[auto_1fr] pb-12",
        position === "left" && "flex justify-start",
        position === "right" && "flex justify-end",
        variant === "inset" && "px-(--inset) sm:[--inset:--spacing(4)]",
        variant === "inset" && position !== "bottom" && "pt-(--inset)",
        variant === "inset" && position !== "top" && "pb-(--inset)",
        className,
      )}
      data-slot="drawer-viewport"
      {...props}
    />
  );
}

/** Sets a ref the app passed, a callback or an object. */
function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * The parts a drawer measures for its `"fit"` snap point: the popup's parts
 * in the flow, and for a scroll area the content inside it, which keeps its
 * own height while the scroll area shrinks or grows with the drawer. The grab
 * bar and the corner close sit outside the flow.
 */
function fitParts(popup: HTMLElement): HTMLElement[] {
  const parts: HTMLElement[] = [];
  for (const child of Array.from(popup.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const { display, position } = getComputedStyle(child);
    if (display === "none" || position === "absolute" || position === "fixed")
      continue;
    const content = child.classList.contains("sp-base-scroll-area")
      ? child.querySelector<HTMLElement>(
          ":scope > .sp-scroll-area-viewport > .sp-scroll-area-content",
        )
      : null;
    parts.push(content ?? child);
  }
  return parts;
}

/**
 * The height of the `"fit"` snap point: the room above the content, the
 * content's own height, the safe area below it, at most `fitMax` and the
 * room the viewport leaves the popup. Null while the popup has no viewport.
 */
function measureFitHeight(
  popup: HTMLElement,
  fitMax: DrawerSnapPoint | undefined,
): number | null {
  const viewport = popup.parentElement;
  if (!viewport) return null;
  const viewportStyle = getComputedStyle(viewport);
  const room =
    viewport.clientHeight -
    (Number.parseFloat(viewportStyle.paddingTop) || 0) -
    (Number.parseFloat(viewportStyle.paddingBottom) || 0);
  const popupStyle = getComputedStyle(popup);
  let content =
    (Number.parseFloat(popupStyle.paddingTop) || 0) +
    (Number.parseFloat(popupStyle.getPropertyValue("--safe-area-bottom")) || 0);
  for (const part of fitParts(popup)) {
    const outer = part.classList.contains("sp-scroll-area-content")
      ? part.closest<HTMLElement>(".sp-base-scroll-area")
      : part;
    const margins = outer ? getComputedStyle(outer) : null;
    content +=
      part.offsetHeight +
      (Number.parseFloat(margins?.marginTop ?? "") || 0) +
      (Number.parseFloat(margins?.marginBottom ?? "") || 0);
  }
  const rootFontSize =
    Number.parseFloat(
      getComputedStyle(popup.ownerDocument.documentElement).fontSize,
    ) || 16;
  const max =
    fitMax === undefined
      ? null
      : resolveSnapPointHeight(fitMax, viewport.offsetHeight, rootFontSize);
  return fitSnapPointHeight({ content, max, room });
}

export function DrawerPopup({
  className,
  children,
  elevation = "default",
  showCloseButton = false,
  position: positionProp,
  variant = "default",
  width,
  showBar = false,
  closeProps,
  portalProps,
  ref,
  ...props
}: WithStringClassName<DrawerPrimitive.Popup.Props> & {
  elevation?: "default" | "none";
  showCloseButton?: boolean;
  position?: DrawerPosition;
  variant?: "default" | "straight" | "inset";
  /**
   * Width of a bottom or top panel on a wide screen. `readable` caps it at
   * `max-w-lg` (512 px) and centres it; `full` spans the whole edge. A `straight` panel stays attached along the whole edge, so it is
   * `full` unless you ask for `readable`. Left and right panels keep their own
   * width.
   */
  width?: "readable" | "full";
  showBar?: boolean;
  closeProps?: WithStringClassName<DrawerPrimitive.Close.Props>;
  portalProps?: WithStringClassName<DrawerPrimitive.Portal.Props>;
}): React.ReactElement {
  const {
    modal,
    position: contextPosition,
    snap: rootSnap,
  } = useContext(DrawerContext);
  const position = positionProp ?? contextPosition;
  const snap = position === "bottom" ? rootSnap : undefined;
  const resolvedElevation = variant === "straight" ? "none" : elevation;
  const resolvedWidth = width ?? (variant === "straight" ? "full" : "readable");
  // A drawer that is not modal leaves the page in reach, as Base UI's own
  // non-modal drawer does: no scrim, and a viewport that lets the page take
  // its taps while the popup takes them again (surfaceClassNames, the owner
  // the Sheet shares). From `fadeFromIndex` up it dims the page and is modal.
  const nonModal = modal !== true;
  const lastIndex = snap ? snap.points.length - 1 : -1;
  const fadeFromIndex = snap?.fadeFromIndex;
  const dimmed = Boolean(snap?.dimmed);
  const showsBackdrop = !nonModal || fadeFromIndex !== undefined;
  const fullHeight = Boolean(snap?.fullHeight);
  const collapsed = Boolean(snap?.collapsed);

  // The popup element as state: the portal mounts it after this part has
  // rendered, and the measurements below start once it is there.
  const [popupNode, setPopupNode] = useState<HTMLDivElement | null>(null);
  const setSnapPopup = snap?.setPopup;
  const setPopup = useCallback(
    (node: HTMLDivElement | null) => {
      setPopupNode(node);
      setSnapPopup?.(node);
      assignRef(ref, node);
    },
    [ref, setSnapPopup],
  );

  // "fit" is the height of the content: the popup measures its parts when it
  // opens, when one of them changes size and when the viewport does.
  const measuresFit = Boolean(snap?.measuresFit);
  const fitMax = snap?.fitMax;
  const reportFit = snap?.reportFit;
  useLayoutEffect(() => {
    const popup = popupNode;
    const viewport = popup?.parentElement;
    if (!measuresFit || !reportFit || !popup || !viewport) return;
    const measure = () => {
      const height = measureFitHeight(popup, fitMax);
      if (height !== null) reportFit(height);
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    for (const part of fitParts(popup)) observer.observe(part);
    return () => observer.disconnect();
  });

  // Folded to its bar, the drawer's panel and footer step out; the focus in
  // them moves to the bar's button instead of leaving the drawer.
  useLayoutEffect(() => {
    const popup = popupNode;
    if (!collapsed || !popup) return;
    const focused = popup.ownerDocument.activeElement;
    if (!(focused instanceof HTMLElement) || !popup.contains(focused)) return;
    let part: Element | null = focused;
    while (part && part.parentElement !== popup) part = part.parentElement;
    if (
      !part?.matches(
        ".sp-base-scroll-area, .sp-drawer-panel, .sp-drawer-footer",
      )
    )
      return;
    const handle = popup.querySelector<HTMLElement>(".sp-drawer-bar-button");
    (handle ?? popup).focus({ preventScroll: true });
  }, [collapsed, popupNode]);

  // Dimmed, the drawer is modal: Base UI keeps the focus in it from then on,
  // so a focus still on the page moves into the drawer, as a modal drawer
  // takes it when it opens.
  useLayoutEffect(() => {
    const popup = popupNode;
    if (!dimmed || !popup) return;
    const focused = popup.ownerDocument.activeElement;
    if (focused instanceof Node && popup.contains(focused)) return;
    popup.focus({ preventScroll: true });
  }, [dimmed, popupNode]);

  return (
    <DrawerPortal {...portalProps}>
      <SiteplaneUIPortalScope>
        {showsBackdrop && (
          <DrawerBackdrop
            className={cn(
              // From `fadeFromIndex` up the scrim dims the page and takes its
              // taps and touch scrolls; below it a drawer that is not modal
              // leaves the page in reach. Between the last two points it
              // follows the drag, as Base UI fades it.
              fadeFromIndex !== undefined &&
                (dimmed ? "opacity-100" : "opacity-0"),
              fadeFromIndex !== undefined &&
                fadeFromIndex === lastIndex &&
                "data-swiping:opacity-[calc(1-var(--drawer-swipe-progress))]",
              nonModal && (dimmed ? "touch-none" : "pointer-events-none"),
            )}
          />
        )}
        <DrawerViewport
          className={nonModal ? surfaceClassNames.nonModalViewport : undefined}
          position={position}
          variant={variant}
        >
          <DrawerPrimitive.Popup
            className={cn(
              slotClass("drawer-popup", props),
              surfaceClassNames.edgeOverlay,
              "flex max-h-full min-h-0 w-full min-w-0 flex-col outline-none will-change-transform [--peek:calc(--spacing(6)-1px)] [--scale-base:calc(max(0,1-(var(--nested-drawers)*var(--stack-step))))] [--scale:clamp(0,calc(var(--scale-base)+(var(--stack-step)*var(--stack-progress))),1)] [--shrink:calc(1-var(--scale))] [--stack-peek-offset:max(0px,calc((var(--nested-drawers)-var(--stack-progress))*var(--peek)))] [--stack-progress:clamp(0,var(--drawer-swipe-progress),1)] [--stack-step:0.05] after:pointer-events-none after:absolute data-swiping:select-none data-nested-drawer-open:overflow-hidden data-nested-drawer-open:bg-[color-mix(in_srgb,var(--sp-rw-surface-color),var(--color-black)_calc(2%*(var(--nested-drawers)-var(--stack-progress))))] data-ending-style:shadow-transparent data-starting-style:shadow-transparent dark:data-nested-drawer-open:bg-[color-mix(in_srgb,var(--sp-rw-surface-color),var(--color-black)_calc(6%*(var(--nested-drawers)-var(--stack-progress))))]",
              "touch-none",
              nonModal && surfaceClassNames.nonModalPopup,
              // The panel follows its snap point: it moves down by the point's
              // offset and keeps a bottom padding of that offset, so its
              // footer stays at the bottom edge of what shows.
              position === "bottom" &&
                "transform-[translateY(calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] data-ending-style:transform-[translateY(calc(100%+env(safe-area-inset-bottom,0px)+var(--inset)))] data-starting-style:transform-[translateY(calc(100%+env(safe-area-inset-bottom,0px)+var(--inset)))] pb-[max(0px,calc(env(safe-area-inset-bottom,0px)+var(--drawer-snap-point-offset,0px)+clamp(0,1,var(--drawer-snap-point-offset,0px)/1px)*var(--drawer-swipe-movement-y,0px)))] [--safe-area-bottom:env(safe-area-inset-bottom,0px)] after:inset-x-0 after:top-full after:h-(--bleed) has-data-[slot=drawer-bar]:pt-2 data-ending-style:mb-0 data-starting-style:mb-0 data-ending-style:pb-0 data-starting-style:pb-0",
              // A panel as high as its content gives up the height its point
              // hides with a negative margin. One with a snap point above
              // "fit" stands as high as the viewport lets it, so that point
              // can be higher than its content.
              position === "bottom" &&
                (fullHeight
                  ? "row-span-2 row-start-1"
                  : "row-start-2 -mb-[max(0px,calc(var(--drawer-snap-point-offset,0px)+clamp(0,1,var(--drawer-snap-point-offset,0px)/1px)*var(--drawer-swipe-movement-y,0px)))]"),
              position === "top" &&
                "data-starting-style:transform-[translateY(calc(-100%-var(--inset)))] data-ending-style:transform-[translateY(calc(-100%-var(--inset)))] transform-[translateY(var(--drawer-swipe-movement-y))] after:inset-x-0 after:bottom-full after:h-(--bleed) has-data-[slot=drawer-bar]:pb-2",
              position === "left" &&
                "data-starting-style:transform-[translateX(calc(-100%-var(--inset)))] data-ending-style:transform-[translateX(calc(-100%-var(--inset)))] transform-[translateX(var(--drawer-swipe-movement-x))] w-[calc(100%-(--spacing(12)))] max-w-100 after:inset-y-0 after:end-full after:w-(--bleed) has-data-[slot=drawer-bar]:pe-2",
              position === "right" &&
                "transform-[translateX(var(--drawer-swipe-movement-x))] data-ending-style:transform-[translateX(calc(100%+var(--inset)))] data-starting-style:transform-[translateX(calc(100%+var(--inset)))] col-start-2 w-[calc(100%-(--spacing(12)))] max-w-100 after:inset-y-0 after:start-full after:w-(--bleed) has-data-[slot=drawer-bar]:ps-2",
              // A panel that reaches the screen's bottom edge keeps its
              // content and its footer clear of the safe area there: the
              // popup is the inset's one owner (a bottom panel adds it to its
              // snap padding above), so the footers add none of their own.
              (position === "left" || position === "right") &&
                "pb-[env(safe-area-inset-bottom,0px)]",
              variant === "default" &&
                cn(
                  position === "bottom" && "before:rounded-t-[inherit]",
                  position === "top" && "before:rounded-b-[inherit]",
                  position === "left" && "before:rounded-e-[inherit]",
                  position === "right" && "before:rounded-s-[inherit]",
                ),
              variant === "inset" && "sm:before:rounded-[inherit]",
              variant === "straight" && "[--stack-step:0]",
              (position === "bottom" || position === "top") &&
                cn(
                  fullHeight ? "h-full" : "h-(--drawer-height,auto)",
                  "[--height:max(0px,calc(var(--drawer-frontmost-height,var(--drawer-height))))] data-nested-drawer-open:h-(--height)",
                ),
              // On a wide screen a bottom or top sheet keeps a readable width
              // of 512 px and centres itself; `width="full"` lets it span the
              // whole edge, as a straight sheet does by default.
              (position === "bottom" || position === "top") &&
                resolvedWidth === "readable" &&
                "mx-auto max-w-lg",
              position === "bottom" &&
                "data-nested-drawer-open:transform-[translateY(calc(var(--drawer-swipe-movement-y)-var(--stack-peek-offset)-(var(--shrink)*var(--height))))_scale(var(--scale))] origin-[50%_calc(100%-var(--inset))]",
              position === "top" &&
                "data-nested-drawer-open:transform-[translateY(calc(var(--drawer-swipe-movement-y)+var(--stack-peek-offset)+(var(--shrink)*var(--height))))_scale(var(--scale))] origin-[50%_var(--inset)]",
              position === "left" &&
                "data-nested-drawer-open:transform-[translateX(calc(var(--drawer-swipe-movement-x)+var(--stack-peek-offset)))_scale(var(--scale))] origin-right",
              position === "right" &&
                "data-nested-drawer-open:transform-[translateX(calc(var(--drawer-swipe-movement-x)-var(--stack-peek-offset)))_scale(var(--scale))] origin-left",
              className,
            )}
            data-collapsed={collapsed ? "" : undefined}
            data-position={position}
            data-elevation={resolvedElevation}
            data-slot="drawer-popup"
            data-variant={variant}
            ref={setPopup}
            {...props}
          >
            {/* The grab strip spans its whole edge and comes first, so its
                button is the drawer's first stop; the close button comes
                last, so it paints and takes clicks above the strip. */}
            {showBar && <DrawerBar />}
            {children}
            {showCloseButton && (
              // The CloseButton at its dense 24 px step, 8 px inside the
              // top-end corner, as the close of every overlay; it names itself.
              <DrawerPrimitive.Close
                className="absolute end-2 top-2"
                render={<CloseButton size="2xs" />}
                {...closeProps}
              />
            )}
          </DrawerPrimitive.Popup>
        </DrawerViewport>
      </SiteplaneUIPortalScope>
    </DrawerPortal>
  );
}

// Base UI's bare content part: in it a pointer selects text instead of
// swiping the drawer. The header, footer and panel take it with
// allowSelection.
const SelectableContent = DrawerPrimitive.Content;

export function DrawerHeader({
  className,
  allowSelection = false,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  allowSelection?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      slotClass("drawer-header", props, render),
      "flex flex-col",
      !allowSelection && "cursor-default",
      className,
    ),
    "data-slot": "drawer-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render: allowSelection ? <SelectableContent render={render} /> : render,
  });
}

export function DrawerFooter({
  className,
  allowSelection = true,
  actionLayout,
  divider = false,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  allowSelection?: boolean;
  /**
   * `fill` lets the Buttons of the footer share its row in equal widths, as
   * the actions of a Card footer do; a link keeps its own width. No Button
   * gets narrower than its words: they stack when they do not fit side by
   * side, and a label wider than the row wraps. Left unset the actions end
   * the row at their own widths.
   */
  actionLayout?: "fill" | undefined;
  /**
   * The hairline above the footer. `true` draws it, and `"scroll"` draws it
   * while the content of the `DrawerPanel` before the footer lies under it,
   * so it fades out at the end of the content. Either makes the footer a
   * band, 16 px above and below its actions; in the scroll mode the panel
   * gives up its 16 px below its content, so the content still ends 16 px
   * above the actions. `false`, the default, draws none.
   */
  divider?: boolean | "scroll" | undefined;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      // Actions that do not fit wrap onto another row with the same gap instead
      // of overflowing a narrow panel.
      slotClass("drawer-footer", props, render),
      "flex flex-wrap",
      !allowSelection && "cursor-default",
      className,
    ),
    "data-action-layout": actionLayout,
    // The footer line's rules (design-rework.css, rulebook S15).
    "data-divider": String(divider),
    "data-slot": "drawer-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render: allowSelection ? <SelectableContent render={render} /> : render,
  });
}

export function DrawerTitle({
  className,
  ...props
}: WithStringClassName<DrawerPrimitive.Title.Props>): React.ReactElement {
  return (
    <DrawerPrimitive.Title
      className={cn(
        slotClass("drawer-title", props),
        "font-heading wrap-anywhere",
        className,
      )}
      data-slot="drawer-title"
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: WithStringClassName<DrawerPrimitive.Description.Props>): React.ReactElement {
  return (
    <DrawerPrimitive.Description
      className={cn(
        slotClass("drawer-description", props),
        "wrap-anywhere",
        className,
      )}
      data-slot="drawer-description"
      {...props}
    />
  );
}

export function DrawerPanel({
  className,
  scrollFade = true,
  scrollable = true,
  allowSelection = true,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  scrollFade?: boolean;
  scrollable?: boolean;
  allowSelection?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      slotClass("drawer-panel", props, render),
      !allowSelection && "cursor-default",
      className,
    ),
    "data-slot": "drawer-panel",
  };

  const content = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render: allowSelection ? <SelectableContent render={render} /> : render,
  });

  if (scrollable) {
    return (
      <ScrollArea className="touch-auto" scrollFade={scrollFade}>
        {content}
      </ScrollArea>
    );
  }

  return content;
}

export function DrawerBar({
  className,
  position: positionProp,
  render,
  label,
  children,
  ...props
}: useRender.ComponentProps<"div"> & {
  position?: DrawerPosition;
  /**
   * The name of the bar's button, which a bottom drawer with snap points
   * lays over the pill: the `drawer.bar` message of SiteplaneLocaleProvider,
   * "Drag handle", by default.
   */
  label?: string | undefined;
}): React.ReactElement {
  const { position: contextPosition, snap } = useContext(DrawerContext);
  const position = positionProp ?? contextPosition;
  const messages = useSiteplaneMessages("drawer");
  const horizontal = position === "left" || position === "right";
  // On a bottom drawer with snap points the bar moves the drawer: a drag or a
  // flick as before, a tap one point up and from the highest point one down.
  // The strip takes the pointer, since Base UI starts no mouse drag on a
  // button; a button over the pill, which lets the pointer through, takes
  // the keyboard and screen readers.
  const move = position === "bottom" ? snap?.move : undefined;
  const operable = move !== undefined && (snap?.points.length ?? 0) > 1;
  const expanded = (snap?.index ?? -1) > 0;

  const button =
    operable && move ? (
      <KitButton
        aria-expanded={expanded}
        aria-keyshortcuts="ArrowUp ArrowDown"
        aria-label={label ?? messages.bar}
        className="pointer-events-none absolute inset-x-0 top-0.5 mx-auto h-6 w-16 min-w-0 rounded-(--sp-rw-radius-control) p-0"
        data-flash={false}
        data-slot="drawer-bar-button"
        onClick={(event) =>
          move("toggle", event.nativeEvent, event.currentTarget)
        }
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          move(
            event.key === "ArrowUp" ? "up" : "down",
            event.nativeEvent,
            event.currentTarget,
          );
        }}
        profile="full-cell-action"
        variant="ghost"
      />
    ) : null;

  // A press on the strip that ends where it began is a tap. Base UI captures
  // a mouse press on the popup, so the release is read on the window.
  const onPointerDown =
    operable && move
      ? (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          const strip = event.currentTarget;
          const view = strip.ownerDocument.defaultView;
          if (!view) return;
          const start = { id: event.pointerId, y: event.clientY };
          const end = (release: PointerEvent) => {
            if (release.pointerId !== start.id) return;
            view.removeEventListener("pointerup", end, true);
            view.removeEventListener("pointercancel", end, true);
            if (
              release.type === "pointerup" &&
              Math.abs(release.clientY - start.y) <= BAR_TAP_SLOP
            )
              move(
                "toggle",
                release,
                strip.querySelector(".sp-drawer-bar-button") ?? undefined,
              );
          };
          view.addEventListener("pointerup", end, true);
          view.addEventListener("pointercancel", end, true);
        }
      : undefined;

  const defaultProps = {
    "aria-hidden": operable ? undefined : (true as const),
    children: button ? (
      <>
        {button}
        {children}
      </>
    ) : (
      children
    ),
    className: cn(
      slotClass("drawer-bar", props, render),
      "absolute flex cursor-grab touch-none items-center justify-center p-3 active:cursor-grabbing before:rounded-full",
      horizontal
        ? "inset-y-0 before:h-12 before:w-1"
        : "inset-x-0 before:h-1 before:w-12",
      position === "top" && "bottom-0",
      position === "bottom" && "top-0",
      position === "left" && "right-0",
      position === "right" && "left-0",
      className,
    ),
    "data-slot": "drawer-bar",
    onPointerDown,
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function DrawerMenu({
  className,
  render,
  size,
  ...props
}: useRender.ComponentProps<"nav"> & {
  /**
   * The row size; it follows the provider's control size. `xl` is the touch
   * size for navigation and sheets that are tapped: 48px rows with 16px text
   * and 20px icons. The other sizes keep the compact menu rows, which a touch
   * screen turns into 48px rows as well.
   */
  size?: SiteplaneControlSize;
}): React.ReactElement {
  const resolvedSize = useResolvedControlSize(size);
  const defaultProps = {
    // The menu reaches past its content box by the rows' inline padding, so
    // the labels start where the drawer's other text starts; the rows keep
    // 1 px above and below them in this flex column (design-rework.css).
    className: cn(
      slotClass("drawer-menu", props, render),
      "sp-menu-rows -mx-(--sp-rw-menu-row-padding-inline) -my-2 flex flex-col",
      className,
    ),
    "data-size": resolvedSize,
    "data-slot": "drawer-menu",
  };

  return useRender({
    defaultTagName: "nav",
    props: mergeProps<"nav">(defaultProps, props),
    render,
  });
}

export function DrawerMenuItem({
  children,
  className,
  variant = "default",
  render,
  disabled,
  ...props
}: useRender.ComponentProps<"button"> & {
  variant?: "default" | "destructive";
}): React.ReactElement {
  return (
    <KitButton
      align="start"
      className={className}
      disabled={disabled}
      multiline
      profile="menu-row"
      render={render}
      variant={variant === "destructive" ? "ghost-destructive" : "link"}
      width="full"
      {...props}
      // Last, so a host that renders the row, such as DrawerClose, cannot swap
      // the slot that the row recipe and the touch size are keyed on.
      data-slot="drawer-menu-item"
    >
      {/* A stacked description stands under the name in one column, as in a
          Menu row (menuRowStack); otherwise the row's text wraps. */}
      {menuRowStack(children)}
    </KitButton>
  );
}

/**
 * The supporting text of a row: the description of a Menu row
 * (MenuItemDescription). A direct child of the row, after its text.
 */
export function DrawerMenuItemDescription({
  className,
  stacked,
  ...props
}: React.ComponentProps<"span"> & {
  /**
   * Puts the description under the name instead of after it, in one column
   * beside the row's avatar or icon, as an account row shows a name over its
   * email. The row's name and description stay on one line each.
   */
  stacked?: boolean | undefined;
}): React.ReactElement {
  return (
    <span
      className={cn(
        slotClass("drawer-menu-item-description", props),
        "min-w-0 truncate",
        className,
      )}
      data-layout={stacked ? "stacked" : undefined}
      data-slot="drawer-menu-item-description"
      {...props}
    />
  );
}

export function DrawerMenuSeparator({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      slotClass("drawer-menu-separator", props, render),
      menuSeparatorClassName,
      className,
    ),
    "data-slot": "drawer-menu-separator",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function DrawerMenuGroup({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      slotClass("drawer-menu-group", props, render),
      "flex flex-col",
      className,
    ),
    "data-slot": "drawer-menu-group",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function DrawerMenuGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      slotClass("drawer-menu-group-label", props, render),
      menuGroupLabelClassName,
      className,
    ),
    "data-slot": "drawer-menu-group-label",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function DrawerMenuTrigger({
  className,
  children,
  ...props
}: Omit<
  WithStringClassName<DrawerPrimitive.Trigger.Props>,
  "render"
>): React.ReactElement {
  return (
    <DrawerTrigger
      className={className}
      data-slot="drawer-menu-trigger"
      render={
        <KitButton
          align="start"
          multiline
          profile="submenu-trigger"
          variant="link"
          width="full"
        />
      }
      {...props}
    >
      {children}
      <CaretRightIcon aria-hidden="true" />
    </DrawerTrigger>
  );
}

export function DrawerMenuCheckboxItem({
  variant = "default",
  ...props
}: Omit<CheckboxProps, "profile"> & {
  variant?: "default" | "switch";
}): React.ReactElement {
  if (variant === "switch") {
    return (
      <KitSwitch
        {...(props as SwitchProps)}
        data-slot="drawer-menu-checkbox-item"
        profile="menu-item"
      />
    );
  }

  return (
    <KitCheckbox
      {...props}
      data-slot="drawer-menu-checkbox-item"
      profile="menu-item"
    />
  );
}

export function DrawerMenuRadioGroup({
  className,
  ...props
}: Omit<RadioGroupProps, "profile">): React.ReactElement {
  return (
    <KitRadioGroup
      className={className}
      data-slot="drawer-menu-radio-group"
      profile="menu-item"
      {...props}
    />
  );
}

export function DrawerMenuRadioItem({
  closeOnClick,
  indicatorPosition,
  onClick,
  ...props
}: Omit<RadioProps, "profile"> & {
  value: string;
  /**
   * Whether picking the row closes the drawer, as picking a radio row closes
   * a menu. It does by default; `false` keeps the drawer open.
   */
  closeOnClick?: boolean | undefined;
  /**
   * Where the row shows its check: at the end of the row, the default of
   * every list of the kit, while a logo, an avatar or an icon passed first
   * takes the leading slot; or in the leading slot (`start`).
   */
  indicatorPosition?: ChoiceIndicatorPosition | undefined;
}): React.ReactElement {
  const { close } = useContext(DrawerContext);
  const closes = choiceMenuItemRadioCloseProps(closeOnClick).closeOnClick;
  return (
    <KitRadio
      data-slot="drawer-menu-radio-item"
      indicatorPosition={indicatorPosition}
      profile="menu-item"
      {...props}
      // A press, or Space, picks the row and closes the drawer. The arrow
      // keys move the choice without a click, so they keep it open, and a
      // disabled row receives no click.
      onClick={(event) => {
        onClick?.(event);
        if (
          !closes ||
          event.defaultPrevented ||
          event.currentTarget.hasAttribute("data-readonly")
        )
          return;
        close?.();
      }}
    />
  );
}

// DrawerContent is an alias of DrawerPopup, as DialogContent is of
// DialogPopup. Base UI's bare content part is DrawerPrimitive.Content.
export { DrawerPrimitive, DrawerPopup as DrawerContent };
