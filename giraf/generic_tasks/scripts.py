"""Render CL and PyRAF scripts from the same frozen invocation plan."""
from pathlib import Path


def cl_literal(value, typ='s'):
    if value == 'INDEF': return 'INDEF'
    if typ == 'b': return 'yes' if value in (True, 'yes') else 'no'
    if isinstance(value, (int, float)): return str(value)
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'


def write_scripts(job, manifest, calls, only=None):
    spec = manifest['definition']
    lines = ['set uparm = ' + cl_literal(str(job / 'uparm') + '/'), 'set imtype = "fits"', 'set clobber = "no"']
    py = ['from pyraf import iraf', f'iraf.set(uparm={str(job / "uparm") + "/"!r}, imtype="fits", clobber="no")']
    boot = spec.get('bootstrap')
    if boot:
        lines += [f'set {boot["name"]} = {cl_literal(str(Path(boot["path"]).parent) + "/")}', f'task {boot["name"]}.pkg = {cl_literal(boot["path"])}']
        py += [f'iraf.set(**{{{boot["name"]!r}: {str(Path(boot["path"]).parent) + "/"!r}}})', f'iraf.task(**{{{boot["name"] + ".pkg"!r}: {boot["path"]!r}}})']
    for package in spec['loadPackages']:
        lines.append(package); py.append(f'iraf.getPkg({package!r})(_doprint=0)')
    schemas = [(spec['qualified'], spec.get('allParameters', spec['parameters']), manifest['parameters'])]
    schemas += [(s['task'], s['parameters'], manifest['parameterSets'][s['name']]) for s in spec['parameterSets']]
    for task, pars, values in schemas:
        if any(s['name'] == '$package' and s['task'] == task for s in spec['parameterSets']):
            continue  # Package unlearn recursively touches unrelated broken tasks.
        lines.append('unlearn ' + task); py.append(f'iraf.unlearn(iraf.getTask({task!r}))')
    for task, pars, values in schemas[1:]:
        for p in pars:
            if p['name'] not in values:
                continue
            value = values[p['name']]
            lines.append(f'{task}.{p["name"]} = {cl_literal(value, p["type"])}')
            py.append(f'iraf.getTask({task!r}).setParam({p["name"]!r}, {"iraf.INDEF" if value == "INDEF" else repr(value)})')
    types = {p['name']: p['type'] for p in spec.get('allParameters', spec['parameters'])}
    for index, (params, expected) in enumerate(calls):
        if only is not None and index != only: continue
        # Required parameters stay keyword assignments; mode=h prevents CL queries.
        for name, value in params.items(): lines.append(f'{spec["qualified"]}.{name} = {cl_literal(value, types.get(name, "s"))}')
        stdout = next((p['file'] for p in expected if p['role'] == '$stdout'), None)
        redirect = (', > ' + cl_literal(stdout)) if stdout else ''
        lines += [f'lpar {spec["qualified"]} > "parameters-{index:03d}.txt"', f'{spec["qualified"]} (mode="h"{redirect})']
        kwargs = ', '.join(f'{key!r}: {"iraf.INDEF" if value == "INDEF" else repr(value)}' for key, value in params.items())
        py_stdout = (', Stdout=' + repr(stdout)) if stdout else ''
        py += [f'iraf.getTask({spec["qualified"]!r})(**{{{kwargs}}}, mode="h"{py_stdout})', f'iraf.lpar(iraf.getTask({spec["qualified"]!r}), Stdout="parameters-{index:03d}.txt")']
    lines += ['print ("GIRAF_GENERIC_DONE")', 'logout']; py += ['print("GIRAF_GENERIC_DONE")']
    (job / 'commands.cl').write_text('\n'.join(lines) + '\n')
    (job / 'commands.py').write_text('\n'.join(py) + '\n')
