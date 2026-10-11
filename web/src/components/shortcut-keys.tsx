import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { shortcutKeys, type Shortcut } from "@/lib/shortcuts"

/** A shortcut's keys, as in a tooltip after the action's name. */
export function ShortcutKeys({ shortcut }: { shortcut: Shortcut }) {
  return (
    <KbdGroup>
      {shortcutKeys(shortcut).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}
