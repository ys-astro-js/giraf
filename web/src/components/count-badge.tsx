import { Badge } from "@/components/ui/badge"

/** Reserved for remaining items in “더 보기” and active filter counts. */
export function CountBadge({
  count,
  className,
}: {
  count: number
  className?: string
}) {
  return (
    <Badge variant="secondary" className={className} aria-label={`${count}개`}>
      {count}
    </Badge>
  )
}
