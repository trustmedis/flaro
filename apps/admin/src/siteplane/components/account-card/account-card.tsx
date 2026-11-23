"use client";

import * as React from "react";

import { useSiteplaneMessages } from "../../system/locale/messages-context";
import { cn } from "../../system/utils/cn";
import { slotClass } from "../../system/utils/slot-class";
import { AvatarLabelGroup } from "../avatar-label-group";
import { Button } from "../button";
import { KitButton } from "../button/button-internal";
import { Card } from "../card";
import { Menu, MenuPopup, MenuTrigger } from "../menu";
import {
  SidebarContext,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuButtonDescription,
  SidebarMenuButtonText,
  SidebarMenuButtonTitle,
  SidebarMenuChevron,
  SidebarMenuItem,
} from "../sidebar";
import {
  type AccountMenuAccount,
  AccountMenuAvatar,
  AccountMenuCaret,
  AccountMenuContent,
} from "./account-menu-content";

/**
 * An account the trigger shows and the menu lists: its `id`, its `name`, the
 * `email` under the name (in the row, the card and the header of the menu),
 * the avatar's `src` and `initials`, its `shape`, `square` for a company or a
 * workspace (rulebook B10), and the `status` dot at the corner of the current
 * account's avatar.
 */
export type AccountCardAccount = AccountMenuAccount;

/** An action row of the account menu: a link with `href`, an action without. */
export type AccountCardAction = {
  label: string;
  /** The leading icon, 16 px in the row's icon slot. Give it aria-hidden. */
  icon?: React.ReactNode;
  /** A keyboard shortcut shown at the end of the row; display only. */
  shortcut?: string | undefined;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
};

export interface AccountCardProps extends Omit<
  React.ComponentProps<"div">,
  "children"
> {
  /**
   * The accounts. The one whose `id` is `accountId` fills the trigger, and
   * with more than one the menu lists them all to switch between.
   */
  accounts: readonly AccountCardAccount[];
  /** The current account; the first of `accounts` when none matches. */
  accountId?: string | undefined;
  /** Called with the id of the account that is picked in the menu. */
  onAccountChange?: ((id: string) => void) | undefined;
  /** The action rows of the menu, after its header, such as View profile. */
  items?: readonly AccountCardAction[] | undefined;
  /**
   * The label above the account list and the name of its group, "Switch
   * account" by default.
   */
  accountsLabel?: string | undefined;
  /** Shows the Add account row under the account list and is called by it. */
  onAddAccount?: (() => void) | undefined;
  /** The label of the add row, "Add account" by default. */
  addAccountLabel?: string | undefined;
  /** Shows the Sign out row at the end of the menu and is called by it. */
  onSignOut?: (() => void) | undefined;
  /** The label of the sign out row, "Sign out" by default. */
  signOutLabel?: string | undefined;
  /**
   * What the button that opens the menu does, "Account menu" by default. On
   * the row and the card it follows the account's name, as in "Mara Ellis,
   * Account menu", and it names the avatar button alone. The menu takes its
   * name from the button.
   */
  label?: string | undefined;
  /**
   * `row`, the default, shows the account as the sidebar's own two-line row:
   * a 32 px avatar, the name over the email and the switcher caret, with the
   * row's hover, pressed and open fills and no card around it. In a Sidebar
   * it is a 48 px SidebarMenuButton, and on the collapsed icon rail the
   * rail's square with a 20 px avatar. `card` shows the avatar, name and
   * email in a card that is one button. `avatar` shows only the avatar, as a
   * button, for the collapsed icon rail of a slim sidebar. Every trigger
   * opens the menu beside it, with the account's avatar, name and email at
   * its top.
   */
  trigger?: "row" | "card" | "avatar" | undefined;
}

/**
 * The account of a sidebar: the signed-in account's avatar, name and email as
 * one button, which opens the account menu beside it. By default it is the
 * sidebar's own two-line row; `trigger="card"` shows it in a card and
 * `trigger="avatar"` shows only the avatar, for the collapsed rail of a slim
 * sidebar. The menu is the kit's Menu: a header with the account's avatar,
 * name and email, the account's actions, such as View profile and Account
 * settings, a list of the accounts to switch to, Add account and, under a
 * separator, Sign out.
 */
export function AccountCard({
  accountId,
  accounts,
  accountsLabel,
  addAccountLabel,
  className,
  items = [],
  label: labelProp,
  onAccountChange,
  onAddAccount,
  onSignOut,
  ref,
  signOutLabel,
  trigger = "row",
  ...props
}: AccountCardProps): React.ReactElement | null {
  // The texts of the menu's rows are the account menu's own (AccountMenuContent).
  const messages = useSiteplaneMessages("accountCard");
  const label = labelProp ?? messages.label;
  // In a Sidebar the menu follows its place: beside a docked sidebar, above
  // the trigger in a sheet. Outside one it opens beside the trigger.
  const sidebar = React.useContext(SidebarContext);
  const card = React.useRef<HTMLDivElement | null>(null);
  // The card's own ref anchors the menu; a ref the app passes reaches the
  // same element beside it rather than taking its place.
  const setCard = React.useCallback(
    (element: HTMLDivElement | null) => {
      card.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );
  const current =
    accounts.find((account) => account.id === accountId) ?? accounts[0];
  if (!current) return null;
  const mobile = sidebar?.isMobile ?? false;
  // Every trigger opens the menu with the account's avatar, name and email
  // (Lukas, 15 November 2026: it reverses C8a of 3 November, where only the
  // avatar's menu showed them). Beside the sidebar
  // the menu opens towards the content, its bottom on the trigger's; in a
  // sheet it opens above the trigger. The row's menu is at least as wide as
  // the row, so above it in a sheet it takes the row's width.
  const popup = (
    <MenuPopup
      align="end"
      anchor={trigger === "card" ? card : undefined}
      side={mobile ? "top" : "inline-end"}
      sideOffset={8}
      width={trigger === "row" ? "at-least-trigger" : "auto"}
    >
      {/* The kit's account menu, which HeaderAccountMenu shares. */}
      <AccountMenuContent
        accountId={current.id}
        accounts={accounts}
        accountsLabel={accountsLabel}
        addAccountLabel={addAccountLabel}
        header={current}
        items={items}
        onAccountChange={onAccountChange}
        onAddAccount={onAddAccount}
        onSignOut={onSignOut}
        signOutLabel={signOutLabel}
      />
    </MenuPopup>
  );

  if (trigger === "avatar") {
    return (
      <Menu>
        <MenuTrigger
          aria-label={label}
          className={className}
          render={<Button profile="avatar" variant="ghost" />}
        >
          {/* The rail's square, as its rows: a 32 px avatar in the 36 px
              circle of the avatar profile at the control size. The avatar
              names its size, so the profile keeps it, with a presence dot
              or without (button.css). */}
          <AccountMenuAvatar
            account={current}
            bordered
            size="sm"
            status={current.status}
          />
        </MenuTrigger>
        {popup}
      </Menu>
    );
  }

  if (trigger === "row") {
    // The sidebar's own two-line row: its 48 px row, a 32 px avatar, the
    // name over the email in the two-line row's text and the switcher caret
    // (rulebook M9), with the navigation row's fills and no card (Lukas,
    // 15 November 2026). On the collapsed
    // icon rail it is the rail's 36 px square with the 20 px of a row icon,
    // as every two-line row (B10). Outside a Sidebar it is the same row, the
    // Button's navigation row, which needs no Sidebar around it.
    const collapsed =
      sidebar !== null && sidebar.state === "collapsed" && !sidebar.isMobile;
    const menu = (
      <Menu>
        <MenuTrigger
          aria-label={`${current.name}, ${label}`}
          data-slot="account-card-trigger"
          render={
            sidebar ? (
              <SidebarMenuButton size={collapsed ? "sm" : "xl"} type="button" />
            ) : (
              <KitButton
                align="start"
                profile="navigation-row"
                size="xl"
                type="button"
                variant="ghost"
                width="full"
              />
            )
          }
        >
          <AccountMenuAvatar
            account={current}
            aria-hidden="true"
            size={collapsed ? "2xs" : "sm"}
            status={current.status}
          />
          <SidebarMenuButtonText>
            <SidebarMenuButtonTitle>{current.name}</SidebarMenuButtonTitle>
            {current.email ? (
              <SidebarMenuButtonDescription>
                {current.email}
              </SidebarMenuButtonDescription>
            ) : null}
          </SidebarMenuButtonText>
          <SidebarMenuChevron variant="switcher" />
        </MenuTrigger>
        {popup}
      </Menu>
    );
    return (
      <div
        className={cn(slotClass("account-card", props), className)}
        data-slot="account-card"
        ref={ref}
        {...props}
      >
        {sidebar ? (
          <SidebarMenu>
            <SidebarMenuItem>{menu}</SidebarMenuItem>
          </SidebarMenu>
        ) : (
          menu
        )}
      </div>
    );
  }

  return (
    // A Card with its 12 px inset around the avatar and the text, which end
    // 8 px before the chevron (Lukas, 3 November 2026, C8c: the whole card
    // opens the menu, the chevron centred). The card is its root, `card`;
    // the class of the row's root, account-card, stays off it (P6).
    <Card
      className={cn("flex-row items-center gap-3 p-3 pe-9", className)}
      ref={setCard}
      {...props}
    >
      <AvatarLabelGroup size="md" subtitle={current.email} title={current.name}>
        <AccountMenuAvatar account={current} status={current.status} />
      </AvatarLabelGroup>
      <Menu>
        {/* The card is one button: a ghost Button laid over the whole card,
            as Attachment's trigger lies over its card, with the card's
            corners, so the Button's own hover, pressed and open fills and its
            focus ring cover the card, from the navigation treatment of the
            kit's ghost navigation triggers (rulebook T5). Its one glyph is
            the caret of every account trigger (AccountMenuCaret), 16 px,
            tertiary at rest and primary on hover, press and while the menu
            is open, as on HeaderAccountMenu's card trigger. The caret is
            centred on the card's height at the card's inset. The button is
            named by the account's name and what it does. */}
        <MenuTrigger
          aria-label={`${current.name}, ${label}`}
          data-slot="account-card-trigger"
          render={
            <Button
              className="absolute inset-0 size-full justify-end rounded-[inherit] pe-3"
              profile="navigation-link"
              size="xs"
              variant="ghost"
            />
          }
        >
          <AccountMenuCaret />
        </MenuTrigger>
        {popup}
      </Menu>
    </Card>
  );
}
