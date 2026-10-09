import { Menu } from "@base-ui/react/menu"
import { cn } from "cn"
import { Check } from "lucide-react"

const DropdownMenu = Menu.Root
const DropdownMenuTrigger = Menu.Trigger
const DropdownMenuGroup = Menu.Group
const DropdownMenuRadioGroup = Menu.RadioGroup

function DropdownMenuLabel({ className, ...props }: Menu.GroupLabel.Props) {
  return <Menu.GroupLabel className={cn("px-3 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />
}

function DropdownMenuSeparator({ className, ...props }: Menu.Separator.Props) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}

function DropdownMenuCheckboxItem({ className, children, ...props }: Menu.CheckboxItem.Props) {
  return <Menu.CheckboxItem className={cn("flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", className)} {...props}>
    {children}
    <Menu.CheckboxItemIndicator className="ml-auto pl-4"><Check /></Menu.CheckboxItemIndicator>
  </Menu.CheckboxItem>
}

function DropdownMenuRadioItem({ className, children, ...props }: Menu.RadioItem.Props) {
  return <Menu.RadioItem className={cn("flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", className)} {...props}>
    {children}
    <Menu.RadioItemIndicator className="ml-auto pl-4"><Check /></Menu.RadioItemIndicator>
  </Menu.RadioItem>
}

function DropdownMenuContent({ className, align = "start", side = "bottom", sideOffset = 4, ...props }: Menu.Popup.Props & Pick<Menu.Positioner.Props, "align" | "side" | "sideOffset">) {
  return <Menu.Portal>
    <Menu.Positioner align={align} side={side} sideOffset={sideOffset} className="isolate z-50">
      <Menu.Popup className={cn("min-w-40 max-h-(--available-height) overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-lg outline-none", className)} {...props} />
    </Menu.Positioner>
  </Menu.Portal>
}

function DropdownMenuItem({ className, variant = "default", ...props }: Menu.Item.Props & { variant?: "default" | "destructive" }) {
  return <Menu.Item data-variant={variant} className={cn("flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", variant === "destructive" ? "text-destructive data-highlighted:bg-destructive/10" : "data-highlighted:bg-accent data-highlighted:text-accent-foreground", className)} {...props} />
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuCheckboxItem }
