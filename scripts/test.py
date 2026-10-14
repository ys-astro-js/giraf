"""Run the Python tests in parallel worker processes.

Usage: python scripts/test.py [--iraf] [-j N] [NAME ...]
Without --iraf, tests that start the installed IRAF are skipped (GIRAF_SKIP_IRAF=1).
NAME narrows the run to test ids that contain it, such as test_task_map.
"""
import argparse
import io
import multiprocessing
import os
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def setup_worker(env):
    os.environ.update(env)
    sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
    os.chdir(ROOT)
    # Task logs and IRAF banners go straight to the descriptors; keep them off the report.
    null = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, 1)
    os.dup2(null, 2)


def run_tests(ids):
    return run_suite(unittest.defaultTestLoader.loadTestsFromNames(ids))


def run_suite(suite):
    result = unittest.TextTestResult(io.StringIO(), descriptions=False, verbosity=0)
    suite.run(result)
    return (result.testsRun, len(result.skipped),
            [('FAIL', str(t), text) for t, text in result.failures]
            + [('ERROR', str(t), text) for t, text in result.errors])


def flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item


def collect(names):
    """Groups test ids into work items; modules that fail to import come back as tests."""
    sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
    os.chdir(ROOT)
    groups, broken = {}, unittest.TestSuite()
    for test in flatten(unittest.defaultTestLoader.discover('tests')):
        if isinstance(test, unittest.loader._FailedTest):
            broken.addTest(test)
            continue
        if names and not any(name in test.id() for name in names):
            continue
        cls = type(test)
        # A class with a shared fixture runs in one process so setUpClass happens once.
        key = f'{cls.__module__}.{cls.__qualname__}' if 'setUpClass' in vars(cls) else test.id()
        groups.setdefault(key, []).append(test.id())
    return list(groups.values()), broken


def main():
    parser = argparse.ArgumentParser(description='Run the GIRAF Python tests in parallel.')
    parser.add_argument('--iraf', action='store_true', help='also run tests that start the installed IRAF')
    parser.add_argument('-j', '--jobs', type=int, default=os.cpu_count() or 4)
    parser.add_argument('names', nargs='*')
    args = parser.parse_args()

    env = {'GIRAF_SKIP_IRAF': '0' if args.iraf else '1'}
    if args.iraf and not os.environ.get('iraf'):
        # Non-interactive shells often miss the user's profile; PyRAF needs $iraf.
        sys.path.insert(0, str(ROOT))
        from giraf.task_capabilities import installed_root
        if installed_root():
            env['iraf'] = str(installed_root()) + '/'
    os.environ.update(env)

    started = time.perf_counter()
    items, broken = collect(args.names)
    ran, skipped, problems = run_suite(broken)
    context = multiprocessing.get_context('spawn')
    with context.Pool(min(args.jobs, len(items)) or 1, setup_worker, (env,)) as pool:
        for count, skips, found in pool.imap_unordered(run_tests, items):
            ran += count
            skipped += skips
            problems += found
    elapsed = time.perf_counter() - started

    for kind, test, text in sorted(problems, key=lambda p: p[1]):
        print('=' * 70, f'{kind}: {test}', '-' * 70, text, sep='\n')
    print('-' * 70)
    print(f'Ran {ran} tests in {elapsed:.1f}s')
    failures = sum(kind == 'FAIL' for kind, _, _ in problems)
    errors = len(problems) - failures
    detail = ', '.join(f'{k}={v}' for k, v in [('failures', failures), ('errors', errors), ('skipped', skipped)] if v)
    print(('FAILED' if problems else 'OK') + (f' ({detail})' if detail else ''))
    if not args.iraf and skipped:
        print('IRAF tests were skipped; run with --iraf to include them.')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
