/**
 * Keyboard shortcuts: one description serves both matching a key press and
 * showing the keys (components/shortcut-keys). ⌘ on macOS is Ctrl elsewhere;
 * either is accepted. Letters match by physical key (`event.code`), so they
 * work while a Korean input source is on.
 */
export type Shortcut = {
  /** `event.code` of the key, or "Enter". */
  code: string
  mod?: boolean
  shift?: boolean
}

export const shortcuts = {
  copy: { code: "KeyC", mod: true },
  paste: { code: "KeyV", mod: true },
  run: { code: "Enter" },
  runGroup: { code: "Enter", mod: true },
  runAll: { code: "Enter", mod: true, shift: true },
  addTask: { code: "KeyN", mod: true },
  undo: { code: "KeyZ", mod: true },
  redo: { code: "KeyZ", mod: true, shift: true },
} satisfies Record<string, Shortcut>

export const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

type KeyEvent = Pick<
  KeyboardEvent,
  "code" | "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>

export function matchesShortcut(event: KeyEvent, shortcut: Shortcut) {
  const key =
    shortcut.code === "Enter" ? event.key === "Enter" : event.code === shortcut.code
  return (
    key &&
    !event.altKey &&
    (event.metaKey || event.ctrlKey) === !!shortcut.mod &&
    event.shiftKey === !!shortcut.shift
  )
}

const keyName = (code: string) => code.replace(/^Key|^Digit/, "")

/** The keys as shown: ⇧⌘↵ on macOS (Apple's modifier order), Ctrl Shift Enter elsewhere. */
export function shortcutKeys(shortcut: Shortcut, mac = isMac()): string[] {
  const keys: string[] = []
  if (mac) {
    if (shortcut.shift) keys.push("⇧")
    if (shortcut.mod) keys.push("⌘")
    keys.push(shortcut.code === "Enter" ? "↵" : keyName(shortcut.code))
  } else {
    if (shortcut.mod) keys.push("Ctrl")
    if (shortcut.shift) keys.push("Shift")
    keys.push(keyName(shortcut.code))
  }
  return keys
}

/** The `aria-keyshortcuts` value. */
export function ariaShortcut(shortcut: Shortcut, mac = isMac()) {
  return [
    shortcut.mod && (mac ? "Meta" : "Control"),
    shortcut.shift && "Shift",
    keyName(shortcut.code),
  ]
    .filter(Boolean)
    .join("+")
}

/**
 * Where the app's shortcuts stay out of the way: typing, menus, popovers
 * and dialogs keep their own keys.
 */
export function ownsKeys(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return !!target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='dialog'], [role='alertdialog'], [role='menu'], [role='menubar'], [role='listbox']"
  )
}

/** A focused control that Enter already activates. */
export function activatesOnEnter(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      "button, a[href], summary, [role='button'], [role='link'], [role='tab'], [role='option'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='switch'], [role='slider'], [role='treeitem'], .react-flow__edge, .react-flow__handle"
    )
  )
}
