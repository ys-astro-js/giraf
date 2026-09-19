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
          `${group.label}.${p.name} ${group.id}.${p.name} ${p.prompt}`.toLowerCase()
        return (
          terms.every((term) => text.includes(term)) &&
          (!changedOnly || parameterChanged(p, group.values))
        )
      }),
    }))
    .filter((group) => group.parameters.length)
}
