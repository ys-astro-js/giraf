import { Columns2, Image, TableProperties, Link2, X } from "lucide-react"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
} from "@/components/toolbar"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { RevealFile } from "@/features/viewer/controls"
import type { ViewerChrome } from "@/features/viewer/types"
import { ViewerWorkspace } from "@/features/viewer/Comparison"
import { type Frame } from "@/lib/workbench"
import { type Source } from "@/lib/task-map"
import type * as React from "react"

export function AssetDialog({
  asset,
  setAsset,
  chooseViewerImage,
  assetView,
  setAssetView,
  link,
  assetText,
  compare,
  add,
  rows,
  headerEdit,
  headers,
}: {
  asset: { row: Frame; role?: string; taskId?: string } | null
  setAsset: React.Dispatch<
    React.SetStateAction<{ row: Frame; role?: string; taskId?: string } | null>
  >
  chooseViewerImage: (second?: boolean) => void
  assetView: string
  setAssetView: React.Dispatch<React.SetStateAction<string>>
  link: (target?: string, source?: Source) => void
  assetText: string
  compare: string[]
  add: (name: string, ids?: string[]) => void
  rows: Frame[]
  headerEdit: () => void
  headers: { key: string; value: string; comment: string; hdu: number }[]
}) {
  const isImage =
    !!asset &&
    !["plot", "text", "image-list"].includes(asset.row.asset || "image")
  // A single image hosts the window controls in its own floating row.
  const chromeInViewer = isImage && assetView === "image" && compare.length < 2
  const chrome: ViewerChrome = {
    title:
      asset &&
      (isImage ? (
        <Button
          variant="ghost"
          className="viewer-filename glass-surface"
          onClick={() => chooseViewerImage()}
          title="영상 변경"
        >
          <span>{asset.row.label}</span>
        </Button>
      ) : (
        <span className="viewer-filename glass-surface" title={asset.row.label}>
          <span>{asset.row.label}</span>
        </span>
      )),
    center: isImage && (
      <ToolbarGroup label="파일 보기" size="sm">
        <ToolbarButton
          label="영상"
          aria-pressed={assetView === "image"}
          onClick={() => setAssetView("image")}
        >
          <Image />
        </ToolbarButton>
        <ToolbarButton
          label="헤더"
          aria-pressed={assetView === "header"}
          onClick={() => setAssetView("header")}
        >
          <TableProperties />
        </ToolbarButton>
      </ToolbarGroup>
    ),
    actions: asset && (
      <>
        <ToolbarGroup label="파일 동작">
          {isImage && (
            <ToolbarButton
              label="영상 비교"
              onClick={() => chooseViewerImage(true)}
            >
              <Columns2 />
            </ToolbarButton>
          )}
          <ToolbarButton
            label="입력으로 사용"
            onClick={() => {
              const row = asset.row
              setAsset(null)
              link(undefined, {
                kind: row.job ? "result" : "files",
                ...(row.job ? { runId: row.job } : { label: row.label }),
                ids: [row.id],
              } as Source)
            }}
          >
            <Link2 />
          </ToolbarButton>
          <RevealFile id={asset.row.id} />
        </ToolbarGroup>
        <ToolbarGroup label="닫기">
          <DialogClose render={<ToolbarButton label="닫기" />}>
            <X />
          </DialogClose>
        </ToolbarGroup>
      </>
    ),
  }
  return (
    <Dialog
      open={!!asset}
      onOpenChange={(v) => {
        if (!v) setAsset(null)
      }}
    >
      <DialogContent
        className="asset-dialog"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <div
          className="asset-content"
          data-chrome={chromeInViewer ? "viewer" : "dialog"}
        >
          <DialogTitle className="sr-only">{asset?.row.label}</DialogTitle>
          {!chromeInViewer && (
            <header className="asset-topbar">
              <div className="viewer-title">{chrome.title}</div>
              <div className="viewer-top-center">{chrome.center}</div>
              <ToolbarCluster edge="end" size="sm" className="viewer-top-tools">
                {chrome.actions}
              </ToolbarCluster>
            </header>
          )}
          {asset && (
            <>
              {asset.row.asset === "plot" ? (
                <img
                  className="asset-plot"
                  src={"/api/plot?id=" + asset.row.id}
                  alt={asset.row.label}
                />
              ) : ["text", "image-list"].includes(asset.row.asset || "") ? (
                <pre className="asset-text">{assetText}</pre>
              ) : (
                <>
                  <section
                    aria-label="영상"
                    hidden={assetView !== "image"}
                    className="asset-image-panel"
                  >
                    <ViewerWorkspace
                      comparisonInHeader
                      chrome={chrome}
                      ids={compare}
                      onStatistics={() => {
                        const row = asset.row
                        setAsset(null)
                        add("imstatistics", [row.id])
                      }}
                      rows={rows}
                      onChoose={chooseViewerImage}
                    />
                  </section>
                  <section
                    aria-label="헤더"
                    hidden={assetView !== "header"}
                    className="asset-header-panel"
                  >
                    <Button
                      className="my-3"
                      variant="outline"
                      onClick={headerEdit}
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
                        {headers.map((c, i) => (
                          <TableRow key={i}>
                            <TableCell>{c.hdu}</TableCell>
                            <TableCell className="break-all">{c.key}</TableCell>
                            <TableCell className="break-all whitespace-normal">
                              {c.value}
                            </TableCell>
                            <TableCell className="whitespace-normal">
                              {c.comment}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
