# IRAF parameter and file contracts

The shared analyzer is the `giraf/spp_schema/` package. It contains no task-name dispatch.
`task_schema.py` merges its evidence into the node schema, and
`task_discovery/` loads the same contract for installed and source-distributed
tasks. Help prose may supply descriptions or fallback guesses; it cannot
reverse a source-proven file direction or turn a proven setting into a port.

## Where definitions live

The reference implementation is IRAF Community **v2.18.1**:

| Definition | Authority | GIRAF handling |
| --- | --- | --- |
| Primitive type, mode, default, minimum, maximum, enumeration | `.par`; CL `pkg/cl/pfiles.c:scantype`, `pkg/cl/modes.c:inrange` | `read_parameters`; ordinary parameter validation and controls |
| File attributes `b`, `n`, `r`, `t`, `w` | `scantype`; `pkg/cl/param.h`; `inrange` | Preserve `declaredType` and `fileChecks`; IRAF checks its own filename namespace at execution |
| Image/file direction and format | SPP `immap`, `open`, their access modes and wrapper arguments | Follow parameter values through local procedures; produce input/output ports and evidence |
| Choice dictionaries | SPP `define` in source/includes, `clgwrd`, `strdic` | Resolve dictionary arguments; closed `clgwrd` choices can populate controls |
| Choice/file/header alternatives | SPP character-prefix branches and `strdic` | Preserve a native setting; expose `parameterConstraints` with known choices/prefixes, without claiming that a dictionary alone closes the domain |
| Conditional output counts | SPP boolean reads and `imtlen` comparisons | Recognize the supported one-output/per-input branch; carry `eachWhen` into validation and output previews |

`fw` means an existing writable file, **not** an output declaration. Likewise,
an `s` parameter may name an image. Neither primitive type nor an occurrence of
“image” in a prompt is sufficient to decide direction.

For example, imcombine's `t_imcombine.x` opens image-name lists and checks their
lengths, then passes them to `src/icombine.x`. That procedure maps output images
with `NEW_COPY`; `icpmmap.x` handles pixel masks. `icgscale.x` and `icscale.x`
resolve scale/zero/weight dictionaries from `icombine.h`, with `@` file and `!`
header-key alternatives. `headers` is a FITS image product, not a text input.
These are examples of the common analysis, not special cases in its code.

## Rebuilding and invalidation

Download the matching official source release and run:

```sh
.venv/bin/python scripts/build_task_schemas.py /path/to/iraf-2.18.1
```

The builder requires matching source/installed `.par` bytes. For explicit
`$(GEN) template.gx -o output.x` rules in `mkpkg`, it runs the installed IRAF
`generic.e` expander in the source tree before analysis. The source tree must
therefore be writable. It does not execute task code or arbitrary mkpkg commands.

The bundled JSON includes the analyzer version, parameter hash, source file
hashes, included local definition hashes, and per-parameter evidence. Cache
entries from older analyzers are not accepted as verified source. Live source
discovery hashes traversed helpers/includes too; changing those dependencies
invalidates the schema fingerprint. Generated cache paths are relative to the
source release, so they do not depend on the build directory.

## Supported scope

This is bounded data-flow analysis, not an SPP compiler. It indexes procedures
under the entry source directory, propagates arguments and literal constants,
and recognizes a documented subset of file APIs and branch patterns. Arbitrary
arithmetic, global common-block flow, unresolved external routines and every
runtime constraint are not statically solved. IRAF remains the execution-time
authority for those checks.

`sourceAnalysis.complete` concerns the recognized file contract, not proof of
all possible task constraints. Unresolved file-bearing calls are reported in
`sourceAnalysis.issues`; partial evidence is retained without setting complete.
Unproven roles may still use the existing prompt/help fallback and remain marked
as such in `ioEvidence`. A dictionary found by `strdic` is not automatically
turned into a restrictive dropdown, since its failure branch can accept a file.

Regression coverage in `tests/test_source_contracts.py` uses renamed synthetic
procedures, misleading/no help text, helper/include changes, stale cache entries,
and the installed task. `test_imcombine_schema.py` executes both CL and PyRAF.

Sources: [CL parameter documentation](https://iraf.readthedocs.io/en/latest/tasks/language/parameters.html),
[imcombine documentation](https://iraf.readthedocs.io/en/latest/tasks/images/immatch/imcombine.html),
[IRAF v2.18.1 source](https://github.com/iraf-community/iraf/tree/v2.18.1).
