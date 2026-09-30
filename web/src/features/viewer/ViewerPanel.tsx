import { useEffect, useState } from "react"
import { Columns2, Image, Link2, Replace, TableProperties } from "lucide-react"
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarSpacer,
} from "@/components/toolbar"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Blank } from "@/components/workbench-controls"
import { RevealFile } from "@/features/viewer/controls"
import { ViewerWorkspace } from "@/features/viewer/Comparison"
import { useWorkbench } from "@/features/workbench/context"
import type { AssetTarget } from "@/features/workbench/hooks/useAssetViewer"
import { usePanel } from "@/features/dock/context"
import { WindowTitle, WindowToolbar } from "@/features/dock/WindowToolbar"
import { registerLockTarget } from "@/features/dock/store"
import { api, type Frame } from "@/lib/workbench"
import type { Source } from "@/lib/task-map"

type HeaderCard = { key: string; value: string; comment: string; hdu: number }

/**
 * A result window: follows the file last opened, or keeps one file while
 * locked so several can stay side by side.
 */
export function ViewerPanel() {
  const w = useWorkbench()
  const locked = usePanel()?.params.locked
  const following = w.assetViewer.asset
  const target: AssetTarget | undefined = locked
    ? (() => {
        const row = w.rows.find((file) => file.id === locked)
        return row && { row }
      })()
    : (following ?? undefined)
  const panel = usePanel()?.panel
  const empty = !target
  useEffect(() => {
    if (empty && panel && panel.title !== "뷰어") panel.api.setTitle("뷰어")
  }, [empty, panel])
  if (!target)
    return (
      <div className="viewer-window">
        <Blank>
          {locked
            ? "잠근 파일을 찾을 수 없습니다"
            : "파일을 열면 여기에 표시됩니다"}
        </Blank>
      </div>
    )
  return <AssetView key={target.row.id} target={target} />
}

function AssetView({ target }: { target: AssetTarget }) {
  const w = useWorkbench()
  const panel = usePanel()?.panel
  const [compare, setCompare] = useState([target.row.id])
  const [view, setView] = useState("image")
  const [text, setText] = useState("")
  const [headers, setHeaders] = useState<HeaderCard[]>([])
  const row: Frame = w.rows.find((file) => file.id === compare[0]) ?? target.row
  const kind = row.asset || "image"
  const isImage = !["plot", "text", "image-list"].includes(kind)
  const { setError } = w

  useEffect(() => {
    if (!["image", "text", "image-list"].includes(kind)) return
    let done = false
    const action = kind === "image" ? "header" : "text"
    api<{ text?: string; cards?: HeaderCard[] }>(`${action}?id=${row.id}`)
      .then((result) => {
        if (done) return
        setText(result.text || "")
        setHeaders(result.cards || [])
      })
      .catch((error) => {
        if (!done) setError(error.message)
      })
    return () => {
      done = true
    }
  }, [row.id, kind, setError])
  useEffect(() => {
    if (panel && panel.title !== row.label) panel.api.setTitle(row.label)
  }, [panel, row.label])
  useEffect(
    () => panel && registerLockTarget(panel.id, () => row.id),
    [panel, row.id]
  )

  function choose(second = false) {
    w.pick(
      {
        name: "view",
        label: second ? "비교" : "영상 변경",
        kind: "image",
        multiple: false,
      },
      [],
      (ids) => {
        if (!ids[0]) return
        setCompare((current) =>
          second ? [current[0], ids[0]] : [ids[0], ...current.slice(1)]
        )
      }
    )
  }
  // A lone image fills the window under clear bars; the header table, text
  // and comparisons are read between the bars like other text windows.
  const loneImage = isImage && view === "image" && compare.length < 2
  const setCanvas = usePanel()?.setCanvas
  useEffect(() => setCanvas?.(loneImage), [setCanvas, loneImage])
  return (
    <div className="viewer-window">
      <WindowTitle title={row.label} tooltip={row.label} />
      <WindowToolbar className="viewer-file-tools">
        {isImage && (
          <>
            <ToolbarGroup label="파일 보기" overflow>
              <ToolbarButton
                label="영상"
                aria-pressed={view === "image"}
                onClick={() => setView("image")}
              >
                <Image />
              </ToolbarButton>
              <ToolbarButton
                label="헤더"
                aria-pressed={view === "header"}
                onClick={() => setView("header")}
              >
                <TableProperties />
              </ToolbarButton>
            </ToolbarGroup>
            <ToolbarSpacer />
          </>
        )}
        <ToolbarGroup label="파일 동작" overflow>
          {isImage && (
            <>
              <ToolbarButton label="영상 변경" onClick={() => choose()}>
                <Replace />
              </ToolbarButton>
              <ToolbarButton label="영상 비교" onClick={() => choose(true)}>
                <Columns2 />
              </ToolbarButton>
            </>
          )}
          <ToolbarButton
            label="입력으로 사용"
            onClick={() =>
              w.link(undefined, {
                kind: row.job ? "result" : "files",
                ...(row.job ? { runId: row.job } : { label: row.label }),
                ids: [row.id],
              } as Source)
            }
          >
            <Link2 />
          </ToolbarButton>
          <RevealFile id={row.id} />
        </ToolbarGroup>
      </WindowToolbar>
      <div
        className="asset-content"
      >
        {kind === "plot" ? (
          <img
            className="asset-plot"
            src={"/api/plot?id=" + row.id}
            alt={row.label}
          />
        ) : !isImage ? (
          <pre className="asset-text">{text}</pre>
        ) : (
          <>
            <section
              aria-label="영상"
              hidden={view !== "image"}
              className="asset-image-panel"
            >
              <ViewerWorkspace
                comparisonInHeader
                windowBars
                ids={compare}
                onStatistics={() => w.add("imstatistics", [row.id])}
                rows={w.rows}
                onChoose={choose}
              />
            </section>
            <section
              aria-label="헤더"
              hidden={view !== "header"}
              className="asset-header-panel"
            >
              <Button
                className="my-3"
                variant="outline"
                onClick={() => w.assetViewer.headerEdit({ ...target, row })}
              >
                ccdhedit으로 편집
              </Button>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>HDU</TableHead>
                    <TableHead>키</TableHead>
                    <TableHead>값</TableHead>
                    <TableHead>설명</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {headers.map((card, i) => (
                    <TableRow key={i}>
                      <TableCell>{card.hdu}</TableCell>
                      <TableCell className="break-all">{card.key}</TableCell>
                      <TableCell className="break-all whitespace-normal">
                        {card.value}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {card.comment}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
