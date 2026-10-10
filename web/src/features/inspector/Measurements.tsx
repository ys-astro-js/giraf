import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import { apiQueryOptions } from "@/lib/queries"
import { api, type Spec } from "@/lib/workbench"
import type { TaskMap } from "@/lib/task-map"

/** One group's remembered measurement (giraf/measurements.py; the field keeps its older name `round`). */
type Measurement = { round: string; job: string; label: string; count: number; at: number }

/**
 * What a cursor task measured in workflow runs, group by group of its split
 * (lib/splits). A later run uses a group's measurement again while its image
 * is unchanged; 다시 측정 forgets the chosen groups so the next run asks again.
 */
export function MeasurementsSection({
  spec,
  instance,
  map,
}: {
  spec: Spec
  instance: string
  map: TaskMap
}) {
  const queryClient = useQueryClient()
  // A new run of this node may have measured again.
  const latest = map.runs.filter((r) => r.instanceId === instance).at(-1)?.id ?? ""
  const options = apiQueryOptions<Measurement[]>(
    `measurements?instance=${encodeURIComponent(instance)}`,
    latest
  )
  const { data } = useQuery({ ...options, enabled: !!spec.cursor, staleTime: 0 })
  if (!spec.cursor || !data?.length) return null
  const count = (n: number) =>
    spec.cursor?.image?.count?.replace("{n}", String(n)) ?? `${n}개`
  async function forget(rounds: string[] | null) {
    try {
      const left = await api<Measurement[]>("measurements", { instance, rounds })
      queryClient.setQueryData(options.queryKey, left)
    } catch (e) {
      toast.add({ title: (e as Error).message, type: "error" })
    }
  }
  const rounds = data.filter((m) => m.round)
  return (
    <section className="inspector-section" aria-label="측정">
      <h3>측정</h3>
      <FieldGroup>
        <ul className="input-files pass-files" aria-label="그룹별 측정">
          {data.map((m) => (
            <li key={m.round}>
              <span>{[m.round, m.label].filter(Boolean).join(" ")}</span>
              <span className="pass-value">{count(m.count)}</span>
            </li>
          ))}
        </ul>
        <div className="flex">
          {rounds.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" />}
              >
                <RotateCcw data-icon="inline-start" />
                다시 측정
                <ChevronDown data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent aria-label="다시 측정할 그룹" align="start">
                <DropdownMenuGroup>
                  {rounds.map((m) => (
                    <DropdownMenuItem key={m.round} onClick={() => void forget([m.round])}>
                      {m.round}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onClick={() => void forget(null)}>
                    모든 그룹
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void forget(null)}>
              <RotateCcw data-icon="inline-start" />
              다시 측정
            </Button>
          )}
        </div>
      </FieldGroup>
    </section>
  )
}
