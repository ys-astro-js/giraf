import { useEffect, useState } from "react"
import { Columns2, Image, Link2, TableProperties } from "lucide-react"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
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
import type { ViewerChrome } from "@/features/viewer/types"
import { useWorkbench } from "@/features/workbench/context"
import type { AssetTarget } from "@/features/workbench/hooks/useAssetViewer"
import { usePanel } from "@/features/dock/context"
import { registerLockTarget } from "@/features/dock/store"
import { WindowControls } from "@/features/dock/WindowControls"
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
  if (!target)
    return (
      <div className="viewer-window">
        <div className="window-controls-row">
          <WindowControls />
        </div>
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
  // A single image hosts the window row in its own floating bar.
  const chromeInViewer = isImage && view === "image" && compare.length < 2
  const chrome: ViewerChrome = {
    title: (
      <span className="viewer-title-row">
        <WindowControls />
        {isImage ? (
          <Button
            variant="ghost"
            className="viewer-filename glass-surface"
            onClick={() => choose()}
            title="영상 변경"
          >
            <span>{row.label}</span>
          </Button>
        ) : (
          <span className="viewer-filename glass-surface" title={row.label}>
            <span>{row.label}</span>
          </span>
        )}
      </span>
    ),
    center: isImage && (
      <ToolbarGroup label="파일 보기" size="sm">
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
    ),
    actions: (
      <ToolbarGroup label="파일 동작">
        {isImage && (
          <ToolbarButton label="영상 비교" onClick={() => choose(true)}>
            <Columns2 />
          </ToolbarButton>
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
    ),
  }
  return (
    <div className="viewer-window">
      <div
        className="asset-content"
        data-chrome={chromeInViewer ? "viewer" : "dialog"}
      >
        {!chromeInViewer && (
          <header className="asset-topbar">
            <div className="viewer-title">{chrome.title}</div>
            <div className="viewer-top-center">{chrome.center}</div>
            <ToolbarCluster edge="end" size="sm" className="viewer-top-tools">
              {chrome.actions}
            </ToolbarCluster>
          </header>
        )}
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
                chrome={chrome}
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
