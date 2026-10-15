import { CircleArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import {
  inlineCode,
  installUpdate,
  parseReleaseNotes,
  useAppUpdate,
  type UpdateState,
} from "@/lib/app-update"

/**
 * The desktop app's downloaded update, in the toolbar while it downloads and
 * until the restart that installs it (quitting installs it too).
 */
export function UpdateButton() {
  const update = useAppUpdate()
  if (!update) return null
  const downloaded = update.state === "downloaded"
  const shown = downloaded || update.state === "downloading"
  const percent = Math.round(update.percent ?? 0)
  const label = downloaded ? "업데이트" : `업데이트 받는 중 ${percent}%`
  return (
    <ToolbarGroup label="업데이트" hidden={!shown}>
      <Popover>
        <PopoverTrigger render={<ToolbarButton label={label} />}>
          {downloaded ? (
            <CircleArrowDown className="text-primary" />
          ) : (
            <DownloadRing percent={percent} />
          )}
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-85">
          <PopoverHeader>
            <PopoverTitle>GIRAF {update.version}</PopoverTitle>
            <PopoverDescription>지금 {update.current}</PopoverDescription>
          </PopoverHeader>
          <ReleaseNotes update={update} />
          {downloaded ? (
            <Button className="w-full" onClick={installUpdate}>
              다시 시작해서 업데이트
            </Button>
          ) : (
            <Progress value={percent}>
              <ProgressLabel className="font-normal">받는 중</ProgressLabel>
              <ProgressValue>{() => `${percent}%`}</ProgressValue>
            </Progress>
          )}
        </PopoverContent>
      </Popover>
    </ToolbarGroup>
  )
}

function ReleaseNotes({ update }: { update: UpdateState }) {
  const sections = parseReleaseNotes(update.notes ?? "")
  if (!sections.length) return null
  return (
    <div className="flex max-h-[min(50vh,24rem)] flex-col gap-3 overflow-y-auto overscroll-contain">
      {sections.map((section, index) => (
        <section key={index} className="flex flex-col gap-1.5">
          {section.title && (
            <h3 className="text-xs font-semibold text-muted-foreground">
              {section.title}
            </h3>
          )}
          <ul className="flex list-disc flex-col gap-1 ps-4 leading-relaxed">
            {section.items.map((item, line) => (
              <li key={line}>
                {inlineCode(item).map((part, at) =>
                  part.code ? (
                    <code key={at} className="rounded bg-muted px-1 font-mono text-[0.9em]">
                      {part.text}
                    </code>
                  ) : (
                    part.text
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** lucide's CircleArrowDown, its circle a ring that fills as the download goes. */
function DownloadRing({ percent }: { percent: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="var(--border)" />
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--primary)"
        pathLength={100}
        strokeDasharray={`${percent} 100`}
        transform="rotate(-90 12 12)"
        className="transition-[stroke-dasharray] duration-200 motion-reduce:transition-none"
      />
      <path d="M12 8v8" />
      <path d="m8 12 4 4 4-4" />
    </svg>
  )
}
