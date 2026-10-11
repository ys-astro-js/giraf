import { isGirafNode, taskDisplayName, type Spec } from './workbench'

export type TaskPackage = { label: string; path: string; children: TaskPackage[]; tasks: Spec[] }

/**
 * Top-level packages left out of the tree because newer tasks supersede
 * them. Their tasks are still found by search.
 */
export const HIDDEN_PACKAGES = ['obsolete']

export function taskPackageTree(tasks: Spec[]): TaskPackage[] {
  const roots: TaskPackage[] = []
  for (const task of tasks) {
    if (HIDDEN_PACKAGES.includes(task.package.split('.')[0])) continue
    let siblings = roots
    let path = ''
    let branch: TaskPackage | undefined
    for (const label of task.package.split('.').filter(Boolean)) {
      path = path ? `${path}.${label}` : label
      branch = siblings.find(node => node.path === path)
      if (!branch) {
        branch = { label, path, children: [], tasks: [] }
        siblings.push(branch)
      }
      siblings = branch.children
    }
    if (branch) branch.tasks.push(task)
  }
  function sort(nodes: TaskPackage[]) {
    nodes.sort((a,b) => a.label.localeCompare(b.label))
    for (const node of nodes) {
      node.tasks.sort((a,b) => (a.taskName || a.name).localeCompare(b.taskName || b.name))
      sort(node.children)
    }
  }
  sort(roots)
  return roots
}

/**
 * What a task's row says: its name, the package it is in (IRAF tasks share
 * names across packages), and what it does, left out when that only repeats
 * the name.
 */
export function taskRowText(task: Spec): { name: string; package?: string; description?: string } {
  const name = isGirafNode(task) ? task.title || task.taskName || task.name : task.taskName || taskDisplayName(task.name)
  const description = [task.description, task.title].map((text) => text?.trim())
    .find((text) => text && text.toLowerCase() !== name.toLowerCase())
  return { name, ...(isGirafNode(task) ? {} : { package: task.package }), ...(description ? { description } : {}) }
}
