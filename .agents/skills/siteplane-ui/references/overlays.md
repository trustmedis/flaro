# Overlays

- `Tooltip` is non-essential hover/focus help; never put required instructions inside it. For a short title with a sentence under it, put `TooltipTitle` and `TooltipDescription` in the `TooltipPopup`. A tooltip is a visual label that screen readers do not read, so the trigger names itself, such as an icon button with `aria-label`. Set `describeTrigger` on a `Tooltip` that adds what its trigger does not say, such as that title and sentence: its trigger then names the open popup in `aria-describedby`. `describeTrigger="always"` keeps that link while the popup is closed, so screen readers read the text on touch screens too, where no tooltip opens; give such a tooltip one trigger, or triggers that share its text. Field help icons (`tooltip` on Input, InputGroup, FieldLabel or SelectLabel) already work this way. Leave it off where the tooltip repeats the trigger's name.
- `Popover` is a contextual anchored helper or small form. Put its `PopoverTitle` and `PopoverDescription` in a `PopoverHeader`, which keeps them 4 px apart as `DialogHeader` does; do not space them with a wrapper and gap classes of your own.
- `Menu` owns a triggered action list; `ContextMenu` owns contextual pointer/keyboard actions.
- `Dialog` owns a focused modal task; `AlertDialog` owns a destructive confirmation.
- `Sheet` is a side form; `Drawer` is an edge panel suited to details and mobile composition.
- Use the installed trigger, portal, positioner, popup, title, description, close, and backdrop parts instead of rebuilding focus or dismissal. The popup parts end in `Popup`, such as `DialogPopup`, `SheetPopup`, `DetailDrawerPopup`, `PopoverPopup` and `MenuPopup`; shadcn's `*Content` names are aliases of the same parts.
- `DialogPopup` and `AlertDialogPopup` are 440 px wide by default (`size="sm"`). Set `size` to `xs` (400 px), `md` (600 px) or `lg` (880 px) for a different width instead of a `max-w-*` class. Below 640 px both open at full width from the bottom of the screen.
- In Menu, Dropdown Menu, Context Menu and Drawer Menu, checkbox and radio items end their row with the check, as Select, Combobox and List Box options do. Pass a row's logo, avatar or icon as its first child, such as the workspaces of a switcher, whose mark is `Avatar` with `shape="square"` and no `size` (a person keeps the round `Avatar`); it takes the leading slot, and a row of text alone starts where the other labels start. Leave `indicatorPosition` at its default. A row's secondary text, such as the email beside a person's name, goes after the label in `MenuItemDescription` (`DropdownMenuItemDescription`, `ContextMenuItemDescription` and `DrawerMenuItemDescription` in the other menus); in a Menu, `stacked` puts it under the name instead. A status dot, `BadgeDot` from `badge`, can lead a row in the same slot as an icon. In a Menu, `variant="checkbox"` on `MenuCheckboxItem` leads the row with the Checkbox's box instead of ending it with a check. `variant="switch"` ends a checkbox item with a Switch, for a setting such as dark mode; a switch row keeps the menu open when it is pressed, whatever `closeOnClick` says, and checkbox items stay open too unless you set `closeOnClick` on them. A radio item closes its menu, or a Drawer Menu's drawer, when it is picked; pass no `closeOnClick` for that, and `closeOnClick={false}` only to keep it open.
- A Menu, and so a Dropdown Menu, can hold bands above and below its rows, which scroll between them: `MenuHeader` with `MenuHeaderTitle` and `MenuHeaderDescription`, such as the signed-in account, and `MenuFooter` for an action or a line of text. `MenuSearch` is a header band with a search field that filters the rows as people type; put a `MenuEmpty` among the rows for the message when nothing matches. Do not build a search field or a header of your own inside `MenuPopup`.
- A menu button that names its menu, such as Actions, ends with `MenuTriggerIcon` (`DropdownMenuTriggerIcon`) after its label: the kit's down caret, 16 px, which turns while the menu is open, as the Select caret does. Do not pass a `CaretDownIcon` of your own; it stays still. A trigger that switches between accounts, workspaces or plans ends with `MenuTriggerIcon variant="switcher"`, the still up-down caret, which rests in the tertiary text color and turns primary on hover, press and while the menu is open; a Sidebar switcher row ends with `SidebarMenuChevron variant="switcher"`, which draws the same caret. Do not pass a `CaretUpDownIcon` of your own. The three dots of a trigger that opens more actions are `OverflowGlyph` from `button` (`orientation="vertical"` for vertical dots), the dots every "more" trigger of the kit draws, rather than a dots icon of your own.
- `TooltipProvider` gives nearby tooltips the kit's shared hover delays; mount it once at the application root. Charts open their own tooltips and need none. Mount `ToastProvider` once when using `toastManager`.
- Keep accessible titles/descriptions, focus return, Escape handling, outside-interaction rules, and reduced-motion behavior intact.

## Correct: compose the existing trigger and accessible title

```tsx
import { Button } from "@/siteplane/components/button";
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/siteplane/components/dialog";

<Dialog>
  <DialogTrigger render={<Button />}>Edit profile</DialogTrigger>
  <DialogPopup>
    <DialogHeader>
      <DialogTitle>Edit profile</DialogTitle>
      <DialogDescription>Update your public information.</DialogDescription>
    </DialogHeader>
  </DialogPopup>
</Dialog>;
```

Incorrect: nesting a Button in a trigger that already renders a button, or substituting a Radix `asChild` recipe without checking the installed API. Do not build a fixed-position div to replace modal focus, dismissal or scroll locking.

Read the selected overlay's complete example before adding controlled state or nested overlays: [Dialog](https://ui.siteplane.io/docs-markdown/components/dialog.md), [Sheet](https://ui.siteplane.io/docs-markdown/components/sheet.md), [Drawer](https://ui.siteplane.io/docs-markdown/components/drawer.md).
