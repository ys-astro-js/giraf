# React Flow migration verification

Acceptance scenarios recorded before implementation:

- Native node drag and keyboard movement persist across reload, including negative coordinates and zoomed views.
- Connect by dragging or clicking output/input handles. Named roles remain distinct. Reject cycles, self links, incompatible types, disabled corrections and invalid cardinality. Replace only the selected input.
- Reconnect an edge; delete a selected edge without deleting files. Node deletion keeps the existing undo action and completed result provenance.
- Controls zoom, fit, interaction lock and selected-node focus work. Pan/pinch/wheel use React Flow. Restore the viewport after reload and convert old scroll offsets.
- Search hides unrelated nodes and edges without deleting anything. Auto layout still follows dependencies and fits the visible graph.
- Parameter changes add/remove handles and update edge anchors. Node selection/input buttons still open the inspector. File/result drops keep role selection.
- Desktop and narrow screen: nodes, controls, input labels, run state and output counts stay readable in both themes. Empty/search-empty states and keyboard focus remain usable.
- Existing Bun regression tests, new adapter/render tests, TypeScript and production build pass; report any pre-existing unrelated failures separately.

## Implementation and documentation

- Bun installed `@xyflow/react@12.11.6`; the application imports the required `@xyflow/react/dist/style.css` before its theme overrides.
- Controlled nodes use `applyNodeChanges`; measured dimensions and drag state remain transient. Task positions/selection are persisted in the domain model. The `coordinateSystem` marker migrates old positive scroll offsets to React Flow viewport translations.
- Native `Handle` components use unique input-role IDs, a source `output` ID, and `useUpdateNodeInternals` for dynamic inputs. Native edges, connection previews, reconnection, keyboard movement/deletion, panning, zoom, `fitView`, `Background`, `Controls`, `ControlButton` and `Panel` replace the former pointer/SVG renderer.
- `isValidConnection` and `onConnect` retain the existing domain validation. `onBeforeDelete` delegates to existing deletion/undo callbacks so deleting an upstream node does not discard completed result provenance.
- Node content and automatic dependency layout remain application-specific; React Flow supplies interaction and rendering. No custom edge renderer or custom pointer pan/drag implementation remains.

Official references consulted:

- [Quick Start](https://reactflow.dev/learn)
- [ReactFlow API](https://reactflow.dev/api-reference/react-flow)
- [Handles and dynamic handles](https://reactflow.dev/learn/customization/handles)
- [Utility classes](https://reactflow.dev/learn/customization/utility-classes)
- [Accessibility](https://reactflow.dev/learn/advanced-use/accessibility)
- [Server-side rendering and initial dimensions](https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration)

## Results — 2026-09-16

- Tests were authored before implementation; the new test suite first failed because the adapter did not yet exist.
- Bun regression suites: 68 passed; 1 pre-existing failure in `tests/ui/workbench.test.ts` (`application code does not override shadcn typography or import legacy styles`). Baseline before implementation: 59 passed, the same 1 failed.
- TypeScript and production build passed. Focused ESLint passed. Impeccable detector returned no findings. Vite reports a bundle-size warning (the main bundle exceeds 500 kB).
- Browser verification used a copied backend/workspace under `/tmp/giraf-react-flow-qa`, not the user's workspace data. Desktop light and 390×844 dark layouts were inspected.
- Verified live: native fit/zoom; mouse drag and arrow-key movement; persisted positions and viewport after reload; click and keyboard handle connections; selected-edge keyboard deletion; input-port updates after disabling Dark correction; automatic layout; empty search and restoration; mobile connections without leaving the canvas. No browser errors/warnings were reported during these checks.
- Adapter/regression tests cover validation, reconnection, cycle rejection, output provenance, deletion semantics and inactive edges. Actual IRAF execution and external file-drop gestures were not exercised in this UI migration check.

## Port interaction follow-up acceptance (before implementation)

- Connected source and target handles are filled; disconnecting the last edge restores hollow styling.
- Click a source handle, then a target handle or its labeled input row to connect through React Flow's native click-to-connect state. The starting port is visibly marked.
- Drag-to-connect continues working and the existing type/cycle validation applies equally to clicks.

Port follow-up result: 10 adapter/render tests passed, production build and focused ESLint passed. In the isolated browser, verified source→target clicks and source→input-row clicks both create edges, the clicked source receives the native `clickconnecting` class, connected ports use the foreground fill, and deleting an edge restores the target's unconnected state.

## Click preview acceptance (before implementation)

- After clicking a port, a native connection line follows pointer movement with no button held. Pan/zoom coordinates remain correct.
- Hover a compatible port or labeled input row: snap the line to the port and highlight its target node and input. Invalid/self/cycle targets must not appear valid.
- Click completion, clicking the start port again, Escape, blank-pane click, deleting/hiding the start node, and leaving the canvas clear the preview appropriately. Drag connections keep native rendering and validation.

Click preview results: 14 focused tests (50 assertions), TypeScript/production build and focused ESLint passed. Browser checks in the isolated workspace confirmed pointer-following native connection paths, target snapping/highlighting, Escape cancellation and click completion clearing the preview. Completion produced no browser errors or warnings. Target highlighting overlaps the existing border (`outline-offset: -1px`) to avoid a separated double outline.

The click preview bridge uses [useStoreApi](https://reactflow.dev/api-reference/hooks/use-store-api) to update React Flow's native connection state; line rendering remains native. Node data stores serializable input coordinates so native connection-state cloning succeeds. Preview-coordinate tests and the structured-clone regression assertion were added before these implementation changes.


## MiniMap and subflows — initial verification, 2026-09-16

Historical record: the checklist creation/membership editor below was replaced by the rectangle-selection and drag workflow in the follow-up section. The existing screenshot paths now show the latest follow-up.

- Native [MiniMap](https://reactflow.dev/api-reference/components/minimap) enables panning and zooming. Named [subflow parent nodes](https://reactflow.dev/learn/layouting/sub-flows) contain tasks using `parentId` and relative canvas coordinates; persisted task positions remain absolute. Native `NodeResizeControl` resizes groups within their member bounds.
- The checklist editor creates groups, renames them and changes membership. Tasks already in another group must be removed there first. Group movement, resize, automatic layout and dissolution preserve task connections; dissolution removes only the grouping.
- Group execution submits only its member tasks. Internal dependencies use results from that run; external predecessors are not executed, and their explicitly connected result IDs remain fixed. A missing external result blocks submission with an instruction to run that task and connect the desired result.
- Validation: full Bun suite 64 passed; focused suite 29 passed; production build and focused ESLint passed. Browser verification in an isolated `/tmp` workspace covered creation, name/member edits, group movement and reload, automatic layout, missing-external-result blocking, and dissolution retaining 2 tasks and 3 edges. Native resize changed the group from 720×416 to 777×487. No console errors or warnings were observed. Actual IRAF execution was not tested in this feature pass.
- Visual review disposition: ship, with no material fixes. Evidence: [1280×720 light](../.impeccable/review/desktop.png), [390×844 dark](../.impeccable/review/mobile.png), and [narrow editor](../.impeccable/review/mobile-editor.png). New surfaces reuse the incumbent semantic palette, Inter typography, 12px panel corners, thin borders and Base UI controls. `DESIGN.md` and `.impeccable/design.json` remain unchanged.


## Rectangle selection and drag membership — follow-up, 2026-09-16

- The bottom-left creation tool is separated from native viewport controls by 12px. It starts React Flow rectangle selection for ungrouped tasks only; edges and existing group members are excluded. Finishing the rectangle opens the name and six-color radio editor directly, then **그룹 만들기** creates the group. The summary reads **N개 작업**, the name label is **이름**, and **다시 선택** preserves draft name/color. The selection hint has no completion/cancel buttons. The edit button sits directly next to the group name. Existing groups expose name/color editing and dissolution, with no membership checklist or redundant dissolution explanation.
- Membership changes by native task dragging. `getIntersectingNodes` identifies candidates around the task center; the center must fall below the group's 56px header. `parentId` and relative React Flow child coordinates remain, but `extent: "parent"` is removed so members can leave. Persisted task positions remain absolute. Group bounds stay fixed during dragging and expand to contain members on insertion; task connections are preserved.
- Selected creation tasks use a primary-colored 2px outline. Entering groups use a solid 2px outline in their own color; leaving groups use a 2px dashed border. Six light/dark group colors are feature-specific. The native MiniMap is 120×80px on desktop and 96×64px at widths up to 640px, with color-coded parent groups.
- Tests were authored before implementation. Full Bun suite: 69 passed; focused suites: 25 passed. Production build and focused ESLint passed; the layout detector returned `[]`. Browser checks confirmed selection of 2 tasks and 0 edges, blue group creation, drag-out membership 2→1 and drag-in 1→2 while retaining 3 edges, color persistence after reload, the 12px toolbar separation and both MiniMap sizes.
- Mid-drag entering/leaving feedback was checked in code/CSS, not a captured browser frame: the automation tool performs each drag atomically. Actual IRAF execution was not part of this interaction follow-up.
- Final visual review disposition: ship, no material fixes. Current evidence: [1280×720 light](../.impeccable/review/desktop.png), [rectangle selection](../.impeccable/review/selection.png), [390×844 dark](../.impeccable/review/mobile.png), [narrow editor](../.impeccable/review/mobile-editor.png). Compared implementation evidence: `task-map-view.tsx`, `subflow-editor.tsx`, `subflow.ts`, `workflow-flow.ts`, `task-map.ts` and `index.css`. The incumbent semantic palette, Inter type, thin borders, 12px panel corners and Base UI controls remain; the feature palette does not replace the global system. `DESIGN.md` and `.impeccable/design.json` are unchanged.

Latest copy/creation refinement: all visible terminology uses 그룹; 70 Bun tests, production build and focused ESLint passed; layout detector returned `[]`.
