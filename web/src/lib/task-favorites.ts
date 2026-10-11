import { isGirafNode, type Spec } from './workbench'

/**
 * Favorite IRAF tasks, by full catalog name (`noao.imred.ccdred.ccdproc`),
 * most recently starred first. Kept per user on the server (/api/home).
 */
/** A task's full catalog name: some catalog entries go by their short name alone. */
export function favoriteName(task: Spec): string {
  return `${task.package}.${task.taskName || task.name.split('.').pop()}`
}

export function toggleFavorite(favorites: string[], name: string): string[] {
  return favorites.includes(name) ? favorites.filter((item) => item !== name) : [name, ...favorites]
}

/** The favorites' tasks in order; a favorite no longer in the catalog is skipped, not forgotten. */
export function favoriteTasks(favorites: string[], tasks: Spec[]): Spec[] {
  const byName = new Map(tasks.filter((task) => !isGirafNode(task)).map((task) => [favoriteName(task), task]))
  return favorites.flatMap((name) => byName.get(name) ?? [])
}
