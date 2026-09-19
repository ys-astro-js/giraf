import { ParameterTable } from "./parameter-fields"
import {
  filterParameterGroups,
  type ParameterGroup,
} from "@/lib/parameter-presentation"

export function ParameterEditorFields({
  groups,
  query,
  changedOnly,
  hasOtherResults = false,
}: {
  groups: ParameterGroup[]
  query: string
  changedOnly: boolean
  hasOtherResults?: boolean
}) {
  const visible = filterParameterGroups(groups, query, changedOnly)
  return (
    <>
      {visible.map((group) => (
        <section
          key={group.id}
          className="parameter-editor-section"
          aria-label={group.label}
        >
          <h3>{group.label}</h3>
          <ParameterTable
            parameters={group.parameters}
            values={group.values}
            change={group.change}
            scope={`editor-${group.id}`}
            showInactive
          />
        </section>
      ))}
      {!visible.length && !hasOtherResults && (
        <p role="status" className="text-muted-foreground">
          {changedOnly && !query.trim()
            ? "변경한 파라미터가 없습니다."
            : "검색 결과가 없습니다. 이름이나 검색 조건을 확인해 주세요."}
        </p>
      )}
    </>
  )
}
