import { Columns2, Image, TableProperties, Link2 } from "lucide-react"
import { ButtonGroup } from "@/components/ui/button-group"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { RevealFile, ViewerToolButton } from "@/features/viewer/controls"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
  return (
    <Dialog
      open={!!asset}
      onOpenChange={(v) => {
        if (!v) setAsset(null)
      }}
    >
      <DialogContent className="asset-dialog" aria-describedby={undefined}>
        <div className="asset-content">
          <header className="asset-topbar">
            <DialogTitle className="asset-title" title={asset?.row.label}>
              {asset &&
              !["plot", "text", "image-list"].includes(
                asset.row.asset || "image"
              ) ? (
                <Button
                  variant="ghost"
                  className="viewer-filename"
                  onClick={() => chooseViewerImage()}
                  title="영상 변경"
                >
                  <span>{asset.row.label}</span>
                </Button>
              ) : (
                asset?.row.label
              )}
            </DialogTitle>
            {asset &&
              !["plot", "text", "image-list"].includes(
                asset.row.asset || "image"
              ) && (
                <ToggleGroup
                  aria-label="파일 보기"
                  variant="outline"
                  spacing={0}
                  value={[assetView]}
                  onValueChange={(values) => {
                    if (values.length) setAssetView(values[0])
                  }}
                >
                  <ToggleGroupItem value="image" aria-label="영상" title="영상">
                    <Image />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="header"
                    aria-label="헤더"
                    title="헤더"
                  >
                    <TableProperties />
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
            {asset && (
              <ButtonGroup className="asset-actions" aria-label="파일 동작">
                {!["plot", "text", "image-list"].includes(
                  asset.row.asset || "image"
                ) && (
                  <ViewerToolButton
                    label="영상 비교"
                    onClick={() => chooseViewerImage(true)}
                  >
                    <Columns2 />
                  </ViewerToolButton>
                )}
                <ViewerToolButton
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
                </ViewerToolButton>
                <RevealFile id={asset.row.id} />
              </ButtonGroup>
            )}
          </header>
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
