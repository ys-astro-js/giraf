import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ParamControl } from "../src/components/parameter-fields"
import { tvmarkColors } from "../src/lib/tvmark"
import { tvmarkStyle } from "../src/lib/tvmark"
import type { Param } from "../src/lib/workbench"

const param = (name: string): Param => ({name,type:name === "mark" ? "s" : "i",default:"",choices:[],prompt:"",min:"",max:""})
test("tvmark mark and color are semantic selectors even without schema choices", () => {
  const mark = renderToStaticMarkup(<ParamControl task="images.tv.tvmark" p={param("mark")} value="cross" onChange={()=>{}} id="mark" />)
  expect(mark).toContain('role="combobox"')
  expect(mark).toContain('cross')
  const color = renderToStaticMarkup(<ParamControl task="images.tv.tvmark" p={param("color")} value="204" onChange={()=>{}} id="color" />)
  expect(color).toContain('role="combobox"')
  expect(color).toContain('빨강')
  expect(color).toContain('204')
  expect(color).toContain('background-color:red')
  expect(tvmarkColors.find(c => c.value === "204")?.color).toBe(tvmarkStyle({color:204,mark:"cross"}).color)
})

test("numeric display options use number controls; unrelated tasks retain their own schema", () => {
  for (const name of ["frame","pointsize","txsize","nxoffset","nyoffset"]) {
    expect(renderToStaticMarkup(<ParamControl task="images.tv.tvmark" p={param(name)} value="1" onChange={()=>{}} id={name} />)).toContain('type="number"')
  }
  const other = renderToStaticMarkup(<ParamControl task="other" p={param("color")} value="204" onChange={()=>{}} id="other" />)
  expect(other).not.toContain('role="combobox"')
  const gray = renderToStaticMarkup(<ParamControl task="images.tv.tvmark" p={param("color")} value="100" onChange={()=>{}} id="gray" />)
  expect(gray).toContain('회색조')
  expect(gray).toContain('type="number"')
  expect(gray).toContain('value="100"')
})
