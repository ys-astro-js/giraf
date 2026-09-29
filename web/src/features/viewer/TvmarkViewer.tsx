import { useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ImageViewer } from "./ImageViewer"
import type { Frame } from "@/lib/workbench"
import type { TvmarkSession } from "@/lib/tvmark"
import "@/styles/viewer/tvmark.css"

export function TvmarkViewer({ session, rows, onClose }: {
  session: TvmarkSession
  rows: Frame[]
  onClose: () => void
}) {
  const [frameId, setFrameId] = useState(session.frame?.id || "")
  const images = [...new Map([...(session.frame ? [session.frame] : []), ...rows]
    .filter(row => row.asset === "image" && row.viewer_supported !== false)
    .map(row => [row.id, row])).values()]
  const frame = images.find(row => row.id === frameId)
  const items = images.map(row => ({ value: row.id, label: row.label }))
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="tvmark-dialog" aria-describedby={undefined}>
        <header className="tvmark-header">
          <DialogTitle>tvmark</DialogTitle>
          <Select items={items} value={frameId || null} onValueChange={value => setFrameId(value || "")}>
            <SelectTrigger aria-label="표시할 영상" className="min-w-0 max-w-full"><SelectValue placeholder="영상 선택" /></SelectTrigger>
            <SelectContent><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <span className="truncate text-muted-foreground" title={session.coords.label}>{session.coords.label}</span>
        </header>
        <div className="tvmark-image">
          {frame && <ImageViewer key={frame.id} frame={frame} embedded markers={session.markers} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
