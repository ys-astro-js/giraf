"""Batch IRAF runner. All combination/calibration pixels are produced by IRAF."""
from __future__ import annotations

from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import traceback

from astropy.io import fits
import numpy as np

from .jobs import atomic_json
from .model import Settings, dark_for, inspect_file, validate
from .products import product_name, publish_product


def checksum(path):
    h = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def bootstrap(job):
    os.environ['PYRAF_NO_DISPLAY'] = '1'
    for path in ['/opt/homebrew/opt/iraf/libexec', '/usr/local/lib/iraf', '/usr/lib/iraf']:
        if Path(path).is_dir():
            os.environ.setdefault('iraf', path + '/')
            break
    from pyraf import iraf
    (job / 'uparm').mkdir(exist_ok=True)
    iraf.set(uparm=str(job / 'uparm') + '/')
    iraf.chdir(str(job))
    iraf.noao(_doprint=0)
    iraf.imred(_doprint=0)
    iraf.ccdred(_doprint=0)
    for name in ('ccdred', 'ccdproc', 'combine', 'zerocombine', 'darkcombine', 'flatcombine', 'imarith', 'imstatistics', 'imcopy'):
        iraf.unlearn(getattr(iraf, name))
    (job / 'instrument.dat').write_text('imagetyp IMAGETYP\nexptime EXPTIME\ndarktime DARKTIME\nsubset FILTER\n')
    iraf.ccdred.instrument = 'instrument.dat'
    iraf.ccdred.logfile = 'iraf.log'
    iraf.ccdred.ssfile = 'subsets'
    iraf.ccdred.verbose = 'yes'
    iraf.ccdred.pixeltype = 'real real'
    iraf.set(imtype='fits', clobber='no')
    (job / 'engine.json').write_text(json.dumps({'iraf': iraf.envget('iraf'), 'version': str(iraf.envget('version')), 'python': sys.version}, indent=2))
    return iraf


class Reduction:
    def __init__(self, job):
        self.job = Path(job).resolve()
        payload = json.loads((self.job / 'manifest.json').read_text())
        self.rows, self.s = payload['rows'], Settings(**payload['settings'])
        self.operation = payload.get('operation', 'reduction')
        self.name = payload.get('name', '')
        self.calls, self.products, self.sources = [], [], []
        self._published_products = {}
        self.progress = 0

    def state(self, message, progress, state='running'):
        self.progress = progress
        atomic_json(self.job / 'status.json', dict(state=state, message=message, progress=progress))
        print(message, flush=True)

    def call(self, task, **kwargs):
        # No command shell or generated CL expressions: names/paths are controlled aliases.
        self.calls.append(dict(task=task, parameters=kwargs))
        atomic_json(self.job / 'commands.json', self.calls)
        with (self.job / 'commands.py').open('a') as script:
            script.write(f'iraf.{task}(' + ', '.join(f'{k}={v!r}' for k, v in kwargs.items()) + ')\n')
        print(f'IRAF {task}: {kwargs}', flush=True)
        getattr(self.iraf, task)(**kwargs)
        # Includes hidden parameters and defaults from this installed IRAF version.
        snapshot = {p.name: str(p.value) for p in getattr(self.iraf, task).getParList()}
        atomic_json(self.job / f'parameters-{len(self.calls):03d}.json', snapshot)

    def product(self, name, label, source=None):
        p = self.job / name
        with fits.open(p, memmap=False) as hdus:
            a = hdus[0].data.astype(float)
            if not np.isfinite(a).all():
                raise ValueError(f'{name}: NaN/Inf 픽셀이 있습니다. 입력과 보정 조건을 확인하세요.')
            stats = dict(mean=float(a.mean()), median=float(np.median(a)), std=float(a.std()),
                         min=float(a.min()), max=float(a.max()), shape=list(a.shape))
        self.products.append(dict(file=name, label=product_name(label, 'image'), source=source, asset='image', **stats))
        self.save_products()

    def save_products(self):
        published = []
        for index, product in enumerate(self.products):
            stat = (self.job / product['file']).stat()
            version = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, stat.st_dev, stat.st_ino)
            cached = self._published_products.get(index)
            # IRAF can update master headers after publication. Keep their final
            # contents, but do not copy/hash every unchanged image at each step.
            if (cached is None or cached[0] != version or cached[1] != product
                    or not (self.job / cached[2]['file']).is_file()):
                result = publish_product(self.job, product, index)
                cached = (version, dict(product), result)
                self._published_products[index] = cached
            published.append(cached[2])
        atomic_json(self.job / 'products.json', published)

    def combine(self, task, inputs, output, scale='none', override=None):
        listfile = f'lists/{Path(output).stem}.list'
        (self.job / listfile).write_text('\n'.join(inputs) + '\n')
        options = dict(input='@' + listfile, output=output, combine=self.s.combine,
                       reject=self.s.reject, ccdtype='', process='no', delete='no', clobber='no',
                       scale=scale, statsec='', nlow=self.s.nlow, nhigh=self.s.nhigh,
                       nkeep=1, mclip='yes', lsigma=self.s.sigma, hsigma=self.s.sigma,
                       rdnoise='0.', gain='1.', snoise='0.', pclip=-0.5,
                       blank=1.0 if task == 'flatcombine' else 0.0)
        if task == 'flatcombine':
            options['subsets'] = 'no'
        options.update(override or {})
        self.call(task, **options)
        if not (self.job / output).is_file():
            raise RuntimeError(f'{task}가 출력을 생성하지 않았습니다: {output}')

    def process(self, image, output, zero='', dark='', flat='', geometry=False):
        header = fits.getheader(self.job / image)
        if self.s.resume:
            zero = '' if 'ZEROCOR' in header else zero
            dark = '' if 'DARKCOR' in header else dark
            flat = '' if 'FLATCOR' in header else flat
        if not (zero or dark or flat or (geometry and (self.s.overscan or self.s.trim))):
            # Some IRAF builds crash on the no-op ccdproc output-copy path.
            self.call('imcopy', input=image, output=output, verbose='yes')
            return
        self.call('ccdproc', images=image, output=output, ccdtype='', noproc='no',
                  fixpix='no', overscan='yes' if geometry and self.s.overscan else 'no',
                  trim='yes' if geometry and self.s.trim else 'no',
                  zerocor='yes' if zero else 'no', darkcor='yes' if dark else 'no',
                  flatcor='yes' if flat else 'no', illumcor='no', fringecor='no',
                  readcor='no', scancor='no', biassec=self.s.biassec, trimsec=self.s.trimsec,
                  readaxis=self.s.readaxis, zero=zero, dark=dark, flat=flat,
                  interactive='no', function='legendre', order=1, sample='*', naverage=1,
                  niterate=1, low_reject=3., high_reject=3., grow=0., minreplace=1.)
        if not (self.job / output).is_file():
            raise RuntimeError(f'ccdproc가 출력을 생성하지 않았습니다: {output}')

    def copy_master(self, source, output, label):
        shutil.copy2(source, self.job / output)
        self.sources.append(dict(original=source, alias=output, sha256=checksum(self.job / output), role='existing master'))
        atomic_json(self.job / 'sources.json', self.sources)
        self.product(output, label)

    def run_combination(self):
        from .combine import validate_combination
        rows = [dict(inspect_file(Path(r['path'])), use=True) for r in self.rows]
        errors, _ = validate_combination(rows, self.s)
        if errors:
            raise ValueError('\n'.join(errors))
        for folder in ('input', 'masters', 'lists'):
            (self.job / folder).mkdir(exist_ok=True)
        self.iraf = bootstrap(self.job)
        (self.job / 'commands.py').write_text('from pathlib import Path\nfrom giraf.worker import bootstrap\niraf = bootstrap(Path.cwd())\n')
        inputs = []
        self.state('선택한 영상 복사 중', .1)
        for i, row in enumerate(rows):
            alias = f'input/f{i:04d}.fits'
            shutil.copy2(row['path'], self.job / alias)
            with fits.open(self.job / alias, memmap=False) as h:
                if not np.isfinite(h[0].data).all():
                    raise ValueError(f"{row['name']}: NaN/Inf 픽셀이 있습니다.")
            inputs.append(alias)
            self.sources.append(dict(original=row['path'], alias=alias, sha256=checksum(self.job / alias)))
        atomic_json(self.job / 'sources.json', self.sources)
        self.state(f'{len(inputs)}장 결합 중', .4)
        self.combine('zerocombine', inputs, 'masters/result.fits')
        self.product('masters/result.fits', self.name or 'Combined.fits')
        self.state('결합 완료', 1., 'completed')

    def run(self):
        if self.operation == 'combine':
            return self.run_combination()
        groups = self.prepare_reduction_inputs()
        zero = self.build_bias(groups['bias'])
        darks = self.build_darks(groups['dark'], zero)
        flats = self.build_flats(groups['flat'], zero, darks)
        self.reduce_science(groups['science'], zero, darks, flats)
        self.finish_reduction()

    def prepare_reduction_inputs(self):
        self.state('입력 무결성과 보정 조건 확인', 0.02)
        # Re-read headers at execution, rather than trusting a stale UI inventory.
        fresh = []
        for r in self.rows:
            check = inspect_file(Path(r['path']))
            check.update({k: r[k] for k in ('use', 'kind', 'filter', 'exposure')})
            fresh.append(check)
        self.rows = fresh
        errors, _ = validate(fresh, self.s)
        if errors:
            raise ValueError('\n'.join(errors))
        for folder in ('input', 'prepared', 'masters', 'reduced', 'lists'):
            (self.job / folder).mkdir(exist_ok=True)
        self.iraf = bootstrap(self.job)
        (self.job / 'commands.py').write_text(
            '# Run with the project environment from THIS run directory.\n'
            '# Input copies and instrument.dat are recorded alongside this script.\n'
            '# Existing outputs must be moved to a backup before replay.\n'
            'from pathlib import Path\nfrom giraf.worker import bootstrap\niraf = bootstrap(Path.cwd())\n')
        groups = defaultdict(list)
        for i, r in enumerate(self.rows):
            alias = f'input/f{i:04d}.fits'
            target = self.job / alias
            shutil.copy2(r['path'], target)
            digest = checksum(target)
            # Metadata edits apply ONLY to copies; detector pixels are unchanged.
            with fits.open(target, mode='update', memmap=False) as h:
                head = h[0].header
                head['IMAGETYP'] = {'bias': 'zero', 'dark': 'dark', 'flat': 'flat', 'science': 'object'}[r['kind']]
                head['EXPTIME'] = float(r['exposure'])
                head['DARKTIME'] = float(r['exposure'])
                head['FILTER'] = str(r['filter'])
                head.add_history('GIRAF: user-reviewed type/exposure/filter on private input copy.')
                h.flush()
            with fits.open(target, memmap=False) as h:
                if not np.isfinite(h[0].data).all():
                    raise ValueError(f"{r['name']}: 입력에 NaN/Inf가 있습니다.")
            self.sources.append(dict(original=r['path'], alias=alias, sha256=digest,
                                     metadata={k: r[k] for k in ('kind', 'exposure', 'filter')}, prior_history=r.get('history', {})))
            groups[r['kind']].append(dict(r, alias=alias, index=i))
        atomic_json(self.job / 'sources.json', self.sources)
        return groups

    def build_bias(self, rows):
        zero = ''
        self.state('Master bias의 전자적 기준 레벨 결합', 0.15)
        if self.s.master_bias and self.s.bias:
            zero = 'masters/bias.fits'
            self.copy_master(self.s.master_bias, zero, '기존 Master bias 영상')
        elif self.s.bias:
            inputs = []
            for r in rows:
                name = r['alias']
                if self.s.overscan or self.s.trim:
                    out = f"prepared/bias{r['index']:04d}.fits"
                    self.process(name, out, geometry=True)
                    name = out
                inputs.append(name)
            zero = 'masters/bias.fits'
            if self.s.split_bias:
                for j in (0, 1):
                    out = f'masters/bias_group{j + 1}.fits'
                    self.combine('zerocombine', inputs[j * 5:(j + 1) * 5], out)
                    self.product(out, f'Bias 묶음 {j + 1}')
                self.combine('zerocombine', ['masters/bias_group1.fits', 'masters/bias_group2.fits'], zero,
                             override=dict(combine='average', reject='none'))
            else:
                self.combine('zerocombine', inputs, zero)
            self.product(zero, 'Master bias')
        return zero

    def build_darks(self, rows, zero):
        darks = {}
        self.state('Master dark 생성: bias 제거 후 노출시간별 결합', 0.32)
        if self.s.master_darks and self.s.dark:
            for j, path in enumerate(self.s.master_darks):
                master = f'masters/dark{j:02d}.fits'
                self.copy_master(path, master, '기존 Master dark 영상')
                t = float(fits.getheader(self.job / master)['EXPTIME'])
                darks[t] = master
        elif self.s.dark:
            for j, t in enumerate(sorted({r['exposure'] for r in rows})):
                inputs = []
                for r in rows:
                    if r['exposure'] != t:
                        continue
                    out = f"prepared/dark{r['index']:04d}.fits"
                    self.process(r['alias'], out, zero=zero, geometry=True)
                    inputs.append(out)
                master = f'masters/dark{j:02d}.fits'
                self.combine('darkcombine', inputs, master, scale='none')
                darks[t] = master
                self.product(master, f'Master dark {t:g} s.fits')

        return darks

    def choose_dark(self, row, darks):
        if not self.s.dark or (self.s.resume and 'DARKCOR' in row.get('history', {})):
            return ''
        t = dark_for(float(row['exposure']), list(darks), self.s.dark_policy)
        if t is None:
            raise ValueError(f"{row['name']}: 일치하는 dark가 없습니다.")
        return darks[t]


    def build_flats(self, rows, zero, darks):
        flats = {}
        self.state('Master flat 생성: bias와 dark 제거 후 필터별 결합', 0.55)
        if self.s.master_flats and self.s.flat:
            for j, path in enumerate(self.s.master_flats):
                master = f'masters/flat{j:02d}.fits'
                self.copy_master(path, master, '기존 Master flat 영상')
                if np.min(fits.getdata(self.job / master)) <= 0:
                    raise ValueError('Master flat에 0 이하 픽셀이 있습니다.')
                filt = str(fits.getheader(self.job / master).get('FILTER', '')).strip()
                flats[filt] = master
        elif self.s.flat:
            for j, filt in enumerate(sorted({r['filter'] for r in rows})):
                inputs = []
                for r in rows:
                    if r['filter'] != filt:
                        continue
                    out = f"prepared/flat{r['index']:04d}.fits"
                    self.process(r['alias'], out, zero=zero, dark=self.choose_dark(r, darks), geometry=True)
                    inputs.append(out)
                master = f'masters/flat{j:02d}.fits'
                self.combine('flatcombine', inputs, master, scale=self.s.flat_scale)
                a = fits.getdata(self.job / master).astype(float)
                if not np.isfinite(a).all() or a.min() <= 0:
                    raise ValueError(f'{filt} master flat에 0 이하 또는 비유한 픽셀이 있습니다. 입력과 보정 조건 또는 bad-pixel 처리가 필요합니다.')
                flats[filt] = master
                # IRAF ccdproc computes and uses the flat mean internally.
                self.product(master, f'Master flat {filt} 정규화 전 ADU.fits')
        return flats

    def reduce_science(self, rows, zero, darks, flats):
        self.state('Science에 bias, dark, flat 순으로 보정 적용', 0.75)
        for i, r in enumerate(rows):
            out = f"reduced/science{r['index']:04d}.fits"
            if not (self.s.bias or self.s.dark or self.s.flat or self.s.overscan or self.s.trim):
                continue
            self.process(r['alias'], out, zero=zero, dark=self.choose_dark(r, darks),
                         flat=flats.get(r['filter'], ''), geometry=True)
            self.product(out, r['name'], source=r['path'])
            self.state(f"Science {i + 1}/{len(rows)} 완료", .75 + .2 * (i + 1) / max(1, len(rows)))

    def finish_reduction(self):
        # Refresh calibration copies after dependent processing changes headers.
        self.save_products()
        self.call('imstatistics', images=','.join(p['file'] for p in self.products),
                  fields='image,npix,mean,stddev,min,max', lower='INDEF', upper='INDEF',
                  nclip=0, lsigma=3., usigma=3., binwidth=.1, format='yes', cache='no')
        self.state(f'결과 {len(self.products)}개 저장 완료', 1., 'completed')


def main():
    worker = Reduction(sys.argv[1])
    try:
        worker.run()
    except Exception as exc:
        traceback.print_exc()
        worker.state(str(exc), worker.progress, 'failed')
        sys.exit(1)
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        logfile = next((name for name in ('worker.log', 'iraf.log') if (worker.job / name).is_file()), None)
        if logfile:
            worker.products.append(dict(file=logfile, label=worker.operation+'-results.txt', asset='text', role='$log', source=None))
        worker.save_products()


if __name__ == '__main__':
    main()
