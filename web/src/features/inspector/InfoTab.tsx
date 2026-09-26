import type { Draft } from "@/lib/workbench"
import { taskDisplayName } from "@/lib/workbench"
import { useSyncExternalStore } from "react"
import { diagnostics, resolveDiagnosticNode } from "@/lib/diagnostics"
import { HelpCircle, Trash2, Copy, CircleX } from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { TabsContent } from "@/components/ui/tabs"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { type Spec } from "@/lib/workbench"
import { type Instance, type TaskMap } from "@/lib/task-map"

function NodeErrors({ map, nodeId }: { map: TaskMap; nodeId: string }) {
  const entries = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.getSnapshot,
    diagnostics.getSnapshot
  )
  const errors = entries.filter(
    (entry) =>
      entry.severity === "error" && resolveDiagnosticNode(entry, map) === nodeId
  )
  if (!errors.length) return null
  return (
    <Alert className="gap-3" aria-label="노드 오류">
      <AlertTitle className="flex items-center gap-2">
        <CircleX
          className="size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        오류
      </AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-3">
          {errors.map((entry) => (
            <li
              key={entry.id}
              className="whitespace-pre-wrap wrap-anywhere leading-relaxed"
            >
              {entry.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
export function InspectorInfo({
  map,
  task,
  spec,
  changedParameters,
  headerPreview,
  d,
  onDuplicate,
  onRemove,
}: {
  map: TaskMap
  task: Instance
  spec: Spec
  changedParameters: { name: string; value: string }[]
  headerPreview: { label: string; key: string; before: string }[]
  d: Draft
  onDuplicate: () => void
  onRemove: () => void
}) {
  return (
    <TabsContent value="info" className="inspector-info">
      <div className="inspector-sections inspector-info-body">
        <NodeErrors map={map} nodeId={task.id} />
        <section className="inspector-section">
          <h3>실행 명령어</h3>
          <code className="inspector-command">
            {spec.package
              ? `${spec.package}.${spec.taskName || taskDisplayName(spec.name)}`
              : spec.name}
          </code>
        </section>
        <section className="inspector-section parameter-changes">
          <h3>변경한 파라미터</h3>
          {changedParameters.length ? (
            <dl>
              {changedParameters.map((p) => (
                <div key={p.name}>
                  <dt>{p.name}</dt>
                  <dd>{p.value || "빈 값"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground">변경한 파라미터가 없습니다.</p>
          )}
        </section>
        {spec.name === "ccdhedit" && headerPreview.length > 0 && (
          <section className="inspector-section">
            <h3>변경 미리보기</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>파일 / 키</TableHead>
                  <TableHead>현재</TableHead>
                  <TableHead>변경 후</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {headerPreview.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      {p.label}
                      <br />
                      {p.key}
                    </TableCell>
                    <TableCell>{p.before}</TableCell>
                    <TableCell>
                      {String(d.parameters.value) === ""
                        ? "삭제"
                        : String(d.parameters.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )}
      </div>
      <footer className="inspector-info-actions">
        <div className="flex items-center gap-2">
          {!spec.executor && (
            <Button
              variant="outline"
              size="icon"
              render={
                <a
                  href={`https://iraf.readthedocs.io/en/latest/tasks/${spec.package.replaceAll(".", "/")}/${spec.taskName || taskDisplayName(spec.name)}.html`}
                  target="_blank"
                  rel="noreferrer"
                />
              }
              aria-label="IRAF 도움말"
              title="IRAF 도움말"
            >
              <HelpCircle />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={onDuplicate}
            aria-label="노드 복제"
            title="노드 복제"
          >
            <Copy />
          </Button>
        </div>
        <Button
          variant="destructive-outline"
          size="icon"
          onClick={onRemove}
          aria-label="작업 삭제"
          title="작업 삭제"
        >
          <Trash2 />
        </Button>
      </footer>
    </TabsContent>
  )
}
