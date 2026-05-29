<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# UI conventions

- **Always add `cursor-pointer` to clickable elements.** This project is on Tailwind v4, where `<button>` and `[role="button"]` no longer default to the pointer cursor. Any interactive element — buttons, chips, pills, custom clickable `<div>`/`<span>`s, dropdown/menu rows — must include `cursor-pointer`. For elements that can be disabled, follow the `Button` component convention: `cursor-pointer disabled:cursor-not-allowed`. Whenever you write or edit a clickable element, stop and confirm the cursor is set.

- **Reuse the shared UI components in `src/components/ui` — don't recreate primitives inline.** Before building any UI element (input, select/dropdown, button, checkbox, card, modal, badge, etc.), follow this order:
  1. **Check if a component already exists** in `src/components/ui` (and `src/components/context`, `src/components/icons`). Use it.
  2. **If it almost fits, extend it** with a small prop/variant rather than hand-rolling a one-off. Keep the component the single source of truth.
  3. **If nothing exists, create it** in `src/components/ui` as a reusable, design-system-aligned component — then consume it. Don't inline bespoke markup that duplicates a primitive.
  Keep `src/components/ui` caught up: when you find duplicated inline markup for something that should be a primitive, factor it into a component.

- **Never use native HTML `<select>` / dropdowns.** Use the `Select` component (`src/components/ui/Select.tsx`), which renders a styled, portal-based custom dropdown matching the design system. It takes `options`, `value`, `onChange(value)`, plus `label`/`size`/`fullWidth`/`placeholder`/`disabled`. Same goes for other native form controls: prefer `Input`, `Checkbox`, `Button`, etc. over raw elements.
