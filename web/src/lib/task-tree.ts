import type { Spec } from './workbench'

export type TaskPackage = { label: string; path: string; children: TaskPackage[]; tasks: Spec[] }

export function taskPackageTree(tasks: Spec[]): TaskPackage[] {
  const roots: TaskPackage[] = []
  for (const task of tasks) {
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
