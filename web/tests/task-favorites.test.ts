import { expect, test } from "bun:test"
import { favoriteName, favoriteTasks, toggleFavorite } from "../src/lib/task-favorites"
import type { Spec } from "../src/lib/workbench"

const task = (name: string, pkg = name.split(".").slice(0, -1).join(".")) => ({ name, package: pkg }) as Spec

test("starring puts a task first and starring it again takes it out", () => {
  let favorites = toggleFavorite([], "noao.imred.ccdred.ccdproc")
  favorites = toggleFavorite(favorites, "images.imutil.imarith")
  expect(favorites).toEqual(["images.imutil.imarith", "noao.imred.ccdred.ccdproc"])
  expect(toggleFavorite(favorites, "images.imutil.imarith")).toEqual(["noao.imred.ccdred.ccdproc"])
})

test("favorites keep their order and skip tasks missing from the catalog without forgetting them", () => {
  const favorites = ["images.imutil.imarith", "gone.task", "noao.imred.ccdred.ccdproc", "giraf.value"]
  const tasks = [{ name: "ccdproc", taskName: "ccdproc", package: "noao.imred.ccdred" } as Spec, task("images.imutil.imarith"), task("giraf.value", "giraf")]
  expect(favoriteTasks(favorites, tasks).map(favoriteName)).toEqual(["images.imutil.imarith", "noao.imred.ccdred.ccdproc"])
  expect(favorites).toContain("gone.task")
})

test("a task is known by its full catalog name even when the catalog uses its short name", () => {
  expect(favoriteName({ name: "ccdproc", taskName: "ccdproc", package: "noao.imred.ccdred" } as Spec)).toBe("noao.imred.ccdred.ccdproc")
  expect(favoriteName(task("noao.imred.quadred.ccdproc"))).toBe("noao.imred.quadred.ccdproc")
})
