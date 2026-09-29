import type { Param, Spec, Values } from "./workbench"

// Presentation only: these lists never change defaults or the execution payload.
const primary: Record<string, string[]> = {
  zerocombine: ["combine", "reject", "ccdtype", "scale"],
  darkcombine: ["combine", "reject", "ccdtype", "scale"],
  flatcombine: ["combine", "reject", "ccdtype", "scale", "statsec"],
  ccdproc: ["ccdtype"],
  imcombine: ["combine", "reject", "scale", "zero"],
  imalign: [],
  imexamine: ["logfile", "keeplog", "defkey", "ncstat", "nlstat"],
  imheader: ["longheader", "userfields"],
  hselect: ["fields", "expr", "missing"],
  ccdhedit: ["parameter", "value", "type"],
}
const inputs: Record<string, string[]> = {
  imcombine: ["input", "scale", "zero"],
  imalign: ["input", "reference", "coords", "shifts"],
  imexamine: ["input", "imagecur"],
}
const taskName = (spec: Spec) => spec.name.split(".").at(-1) || spec.name
export function primaryParameterNames(spec: Spec): string[] {
  const names = primary[taskName(spec)]
  return spec.parameters
    .filter(
      (p, i) =>
        p.required ||
        (names
          ? names.includes(p.name)
          : p.mode?.includes("q") ||
            ((!p.mode || p.mode.includes("a")) && i < 6))
    )
    .map((p) => p.name)
}
export function primaryInputNames(spec: Spec): string[] {
  const names = inputs[taskName(spec)]
  return spec.inputs
    .filter(
      (s, i) =>
        s.required ||
        (names
          ? names.includes(s.name)
          : i === 0 ||
            s.valueType === "cursor" ||
            (s.required !== false && spec.inputs.length <= 4))
    )
    .map((s) => s.name)
}
export type ParameterGroup = {
  id: string
  label: string
  parameters: Param[]
  values: Values
  change: (key: string, value: string) => void
}
/**
 * Put schema-defined groups first. Keys are `name` for the task and
 * `pset.name` for parameter sets; values still live in their original group.
 */
export function schemaParameterGroups(
  spec: Spec,
  groups: ParameterGroup[]
): ParameterGroup[] {
  if (!spec.groups?.length) return groups
  const owner = (key: string) => {
    const [set, name] = key.includes(".") ? key.split(".", 2) : ["", key]
    const group = groups.find((g) => g.id === (set ? `set-${set}` : "task"))
    const p = group?.parameters.find((p) => p.name === name)
    return group && p ? { group, p } : undefined
  }
  const used = new Set<string>()
  const custom = spec.groups.map((schema, index): ParameterGroup => {
    const members = schema.parameters.flatMap((key) => {
      const found = owner(key)
      if (!found) return []
      used.add(`${found.group.id}\n${found.p.name}`)
      return [{ key, ...found }]
    })
    return {
      id: `schema-${index}`,
      label: schema.label,
      parameters: members.map(({ key, p }) => ({ ...p, name: key })),
      values: Object.fromEntries(
        members.map(({ key, group, p }) => [key, group.values[p.name]])
      ),
      change: (key, value) => {
        const member = members.find((m) => m.key === key)
        member?.group.change(member.p.name, value)
      },
    }
  })
  const rest = groups.map((group) => ({
    ...group,
    parameters: group.parameters.filter(
      (p) => !used.has(`${group.id}\n${p.name}`)
    ),
  }))
  return [...custom, ...rest].filter((group) => group.parameters.length)
}
const layerNames: Record<string, string> = {
  giraf: "GIRAF 기본",
  user: "사용자",
}
/** Values the schema pins for execution; shown read-only in the Info tab. */
export function fixedParameters(spec: Spec) {
  const entries = [
    ...Object.entries(spec.fixed || {}),
    ...(spec.parameterSets || []).flatMap((set) =>
      Object.entries(set.fixed || {}).map(
        ([name, value]) => [`${set.name}.${name}`, value] as const
      )
    ),
  ]
  return entries.map(([name, value]) => {
    const layer = spec.schemaProvenance?.[`parameters.${name}.fixed`]
    return {
      name,
      value: String(value ?? ""),
      source: layer ? layerNames[layer] || layer : "작업 정의",
    }
  })
}
export const parameterChanged = (p: Param, values: Values) =>
  String(values[p.name] ?? p.default) !== String(p.default ?? "")
export function filterParameterGroups(
  groups: ParameterGroup[],
  query: string,
  changedOnly: boolean
): ParameterGroup[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return groups
    .map((group) => ({
      ...group,
      parameters: group.parameters.filter((p) => {
        const text =
          `${group.label}.${p.name} ${group.id}.${p.name} ${p.label ?? ""} ${p.prompt}`.toLowerCase()
        return (
          terms.every((term) => text.includes(term)) &&
          (!changedOnly || parameterChanged(p, group.values))
        )
      }),
    }))
    .filter((group) => group.parameters.length)
}
