# Conventions

- Installed local source is the API authority.
- Use canonical compound-part exports and stable `data-slot` names from that source.
- Use Siteplane UI props, variants, tokens, and named utilities. Do not invent hex colors or arbitrary Tailwind values to replace a primitive’s visual contract.
- A utility in `className` overrides the kit’s styles (the kit sits in the `siteplane` cascade layer, below `utilities`). Use it for layout and placement; change a part’s look through its props, variants and tokens.
- The footers of Card, Frame and CardFrame are rows that keep their actions 12 px apart, as every overlay footer does (`--sp-rw-action-gap`). Give a footer layout classes such as `justify-end` or `justify-between`, not `flex` or a gap.
- Icons are Phosphor icons in their default Regular weight, the set the kit draws with. The registry installs `@phosphor-icons/react` with the components. Import icons from `@phosphor-icons/react/dist/ssr` as the kit does; that entry also works in Server Components. Their names end in `Icon` and often differ from Lucide's, such as `CaretDownIcon` for a chevron and `GearIcon` for settings. A decorative icon takes `aria-hidden="true"`; Phosphor does not set it.
- Keep the hairline edges. Card, Frame, Separator, Table and the other kit parts draw their own edges; prefer them for outlines and dividers. For a custom edge, use the hairline tokens: `border-(length:--sp-rw-border-default) border-(--sp-rw-surface-edge)` around a surface of your own, in the edge color of Card and the default Alert, or `border-b-(length:--sp-rw-border-default) border-(--sp-rw-border-translucent)` for a divider on one side, in the color of Separator. `--sp-rw-border-default` is 1px, and 0.5px on screens with two device pixels per CSS pixel, so the edge stays one physical pixel. A bare `border` or `border-border` stays 1 CSS pixel, two physical pixels on Retina screens, and is thicker than the kit's own edges beside it.
- Let components own state motion. Use the shared Motion provider and preserve reduced-motion behavior.
- Preserve accessible names, labels, validation, focus visibility, keyboard operation, dismissal, and disabled states.
- Keep providers mounted once at the application root. Add only providers required by installed components.
- Keep product data, copy, navigation models, permissions, layout and product styling outside the installed primitive files.
- Before updating installed source, inspect the diff. Preserve local customizations and reconcile incoming changes according to the user's request; never silently overwrite them.
- Keep the license and trademark notices delivered by the base registry item.

## Correct: use the component's existing pending state

```tsx
import { Button } from "@/siteplane/components/button";

<Button loading>Saving changes</Button>;
```

Incorrect: `<Button isLoading>` or `<Button isPending>`; these are not this component's props. Set `type="submit"` when the button submits a form. Use the documented LoadingButton recipe for an async action with its own pending label.

Prefer semantic classes such as `bg-background`, `text-foreground` and `text-muted-foreground` over hardcoded color substitutions. Use the [theming guide](https://ui.siteplane.io/docs-markdown/customization/theming.md) to change application tokens, and the installed `cn` utility for conditional classes. Preserve reduced-motion behavior instead of adding a separate animation system around stateful primitives.

## Correct: take a small action from the kit

```tsx
import { CopyButton } from "@/siteplane/components/copy-button";

<CopyButton
  labels={{ copy: "Copy address" }}
  value="https://portal.example.com"
/>;
```

Incorrect: a Phosphor `CopyIcon` in a ghost Button with a `copied` state of your own. That rebuilds CopyButton without its check, its tooltip, its failure state and its announcement. A Phosphor icon belongs inside a kit part as a static glyph, such as the icon of a `MenuItem`.
