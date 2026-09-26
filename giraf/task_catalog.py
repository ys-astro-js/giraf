"""Declarative IRAF task capabilities and parameters, independent of the UI/runner.

Legacy CCD adapters retain an unlearned IRAF parameter snapshot. Other tasks
are discovered and compiled from installed IRAF metadata on catalog refresh.
"""
import json
from pathlib import Path
from copy import deepcopy
from threading import RLock

SNAPSHOT = json.loads(Path(__file__).with_name('task_parameters.json').read_text())
from .task_capabilities import load_installed
CAPABILITIES = load_installed(SNAPSHOT)
CCD = 'noao.imred.ccdred'


def slot(name, multiple=True, required=False, kind='image'):
    return dict(name=name, label=name, multiple=multiple, required=required, kind=kind)


def definition(name, inputs, output=None, kind='image', package=CCD, **extra):
    pars = {p['name']: p for p in SNAPSHOT['tasks'][name]}
    inputs = [dict(item, label=pars.get(item['name'], {}).get('prompt') or item['name']) for item in inputs]
    return dict(name=name, package=package, title=name, description='',
                inputs=inputs, output=output, kind=kind, **extra)


CALIBRATIONS = [dict(slot(name, multiple=name != 'fixfile', kind='text' if name == 'fixfile' else 'image'),
                     label=next(p['prompt'] for p in SNAPSHOT['tasks']['ccdproc'] if p['name'] == name))
                for name in ('zero', 'dark', 'flat', 'illum', 'fringe', 'fixfile')]
TASKS = {t['name']: t for t in [
    *[definition(name, [slot('input', required=True)],
                 dict(name='output', mode='combine', default=output), preprocess=True)
      for name, output in [('zerocombine', 'Zero.fits'), ('darkcombine', 'Dark.fits'), ('flatcombine', 'Flat.fits')]],
    definition('combine', [slot('input', required=True), slot('offsets', False, kind='text')],
               dict(name='output', mode='combine', default='Combined.fits')),
    definition('ccdproc', [slot('images', required=True), *CALIBRATIONS], dict(name='output', mode='each', default='p')),
    definition('ccdhedit', [slot('images', required=True)], dict(name='images', mode='edit', default='h')),
    definition('ccdlist', [slot('images', required=True)], kind='text', preprocess=True),
    definition('ccdgroups', [slot('images', required=True)], dict(name='output', mode='text', default='Group'), kind='text'),
    definition('ccdmask', [slot('image', False, True)], dict(name='mask', mode='single', default='Mask.pl'), kind='mask'),
    definition('badpiximage', [slot('fixfile', False, True, 'text'), slot('template', False, True)],
               dict(name='image', mode='single', default='BadPixels.fits')),
    *[definition(name, [slot('input', required=True)], dict(name='output', mode='each', default=name+'_'), preprocess=True)
      for name in ('mkfringecor', 'mkillumcor', 'mkillumflat', 'mkskycor', 'mkskyflat')],
    definition('ccdinstrument', [slot('images', required=True)], kind='text'),
    *[definition(name, [slot('images', required=True)], kind='text', package='images.imutil')
      for name in ('imheader', 'imstatistics')],
    definition('imexamine', [slot('input', False, True)], kind='text', package='images.tv'),
]}

# Parameters owned by the job filesystem, UI, or non-interactive adapter.
MANAGED = {
    'ccdred': {'version', 'instrument'},
    'ccdproc': set(), 'ccdinstrument': {'instrument'},
    'imheader': {'imlist'},

}


def parameters(name):
    excluded = MANAGED.get(name, set()) | {'mode', '$nargs', 'ccdproc'}
    if name in TASKS:
        spec = TASKS[name]
        excluded |= {s['name'] for s in spec['inputs']}
        if spec['output']:
            excluded.add(spec['output']['name'])
    return [p for p in SNAPSHOT['tasks'][name] if p['name'] not in excluded]


LEGACY_TASKS = {name: spec for name, spec in TASKS.items() if name not in ('ccdproc', 'imexamine')}
DISCOVERED_ALIASES = {'noao.imred.ccdred.ccdproc': 'ccdproc', 'images.tv.imexamine': 'imexamine'}
DISCOVERY = {}
_catalog_lock = RLock()


def refresh_catalog():
    from .task_discovery import discover, env_paths
    from .image_lists import image_list_spec
    global DISCOVERY
    with _catalog_lock:
        discovery = discover(extra_roots=env_paths('GIRAF_IRAF_PACKAGE_ROOTS'),
                             descriptors=env_paths('GIRAF_TASK_DESCRIPTORS'))
        tasks = {name: dict(task, description=discovery.get('descriptions', {}).get(task['package'] + '.' + task['name'], ''))
                 for name, task in LEGACY_TASKS.items()}
        tasks.update({DISCOVERED_ALIASES.get(k, k): dict(v, name=DISCOVERED_ALIASES.get(k, k)) for k, v in discovery['tasks'].items()
                      if not any(t['package'] + '.' + t['name'] == k for t in LEGACY_TASKS.values())})
        utility = image_list_spec()
        tasks[utility['name']] = utility
        # Build completely before publishing; a failed discovery retains the
        # previous catalog. Existing imports keep the same registry identity.
        removed = TASKS.keys() - tasks.keys()
        TASKS.update(tasks)
        for name in removed:
            del TASKS[name]
        DISCOVERY = discovery


refresh_catalog()


def catalog(*, refresh=False):
    with _catalog_lock:
        if refresh:
            refresh_catalog()
        return deepcopy(dict(version=SNAPSHOT['version'], capabilities=CAPABILITIES, tasks=[dict(t, parameters=t['parameters'] if t.get('adapter') == 'generic' else parameters(t['name'])) for t in TASKS.values()], discovery=dict(diagnostics=DISCOVERY.get('diagnostics', []), count=len(DISCOVERY.get('tasks', {}))),
                    ccdproc=dict(parameters=parameters('ccdproc'), inputs=CALIBRATIONS),
                    ccdred=parameters('ccdred'),
                    exam={n:parameters(n) for n in ('rimexam','limexam','cimexam')}))
