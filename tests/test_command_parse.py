"""giraf/command_parse.py on the course's own commands (tests/fixtures/course-commands)."""
import json
import unittest
from pathlib import Path

from giraf.command_parse import parse_commands, statements, tokens

FIXTURES = Path(__file__).parent / 'fixtures' / 'course-commands'
FRONTEND = Path(__file__).parents[1] / 'web' / 'tests' / 'fixtures' / 'commands'
# The M67 folder: the files the course's commands name.
M67 = [f'AutosaveImage-{n:04d}{kind}.fits' for n in range(1, 11) for kind in ('bias', 'dark15', 'dark30', 'dark60', 'dark90')] + \
      [f'M67_{band}_{n}.fits' for band in ('B30', 'V15') for n in range(1, 6)] + \
      [f'flat_B_{n}.fits' for n in (18, 19, 20)] + [f'flat_V_{n}.fits' for n in (15, 16, 17)]


def parse(text, files=M67, **options):
    return parse_commands(text, files=files, **options)['lines']


def fixture(name, files=M67):
    return parse((FIXTURES / name).read_text(), files)


def tasks(lines):
    return [line for line in lines if line['kind'] == 'task']


def sources(line, role):
    return [i.get('file') or ('<' + str(i['from']['line'])) if 'file' in i or 'from' in i else '?' + i['name']
            for i in line['inputs'][role]['items']]


class TextTests(unittest.TestCase):
    def test_continuation_joins_lines_and_comments_drop(self):
        self.assertEqual(statements('# a comment\nflatcomb a \\\n  reject=none # note\nphot b'),
                         [(2, 'flatcomb a    reject=none'), (4, 'phot b')])

    def test_quotes_and_spaced_keywords(self):
        self.assertEqual(tokens('zerocomb a out = Zero ccdtype="" x="a b" \'c d\''),
                         ['zerocomb', 'a', 'out=Zero', 'ccdtype=""', 'x="a b"', "'c d'"])


class CourseReductionTests(unittest.TestCase):
    lines = fixture('ngc2420-reduction.cl')

    def line(self, text):
        return next(line for line in self.lines if line['text'].startswith(text))

    def test_packages_load_silently(self):
        self.assertEqual([(l['text'], l['package']) for l in self.lines if l['kind'] == 'package'],
                         [('noao.imred', 'noao.imred'), ('ccdred', 'noao.imred.ccdred')])

    def test_ls_patterns_with_ranges_define_lists(self):
        bias2 = self.line('ls AutosaveImage-000[6-9]bias')
        self.assertEqual((bias2['kind'], bias2['list'], bias2['issues']), ('list', 'Bias2.list', []))
        self.assertEqual(bias2['files'], [f'AutosaveImage-{n:04d}bias.fits' for n in range(6, 11)])

    def test_abbreviated_tasks_and_positional_list(self):
        zero1 = self.line('zerocomb @Bias1.list')
        self.assertEqual((zero1['task'], zero1['issues']), ('zerocombine', []))
        self.assertEqual(sources(zero1, 'input'), [f'AutosaveImage-{n:04d}bias.fits' for n in range(1, 6)])
        self.assertEqual(zero1['outputs']['output']['labels'], ['Zero1.fits'])
        self.assertEqual(zero1['parameters'], dict(combine='median', reject='none', ccdtype='', scale='none', rdnoise='15', gain='1.4'))
        self.assertEqual(self.line('darkc @Dark15-1')['task'], 'darkcombine')

    def test_a_comma_list_names_earlier_outputs(self):
        zero = self.line('zerocomb Zero1,Zero2')
        self.assertEqual(sources(zero, 'input'), ['<' + str(self.line('zerocomb @Bias1')['index']),
                                                  '<' + str(self.line('zerocomb @Bias2')['index'])])

    def test_assignment_lines_set_the_ccdproc_a_ccd_task_runs_first(self):
        oversca = self.line('ccdproc.oversca')
        self.assertEqual((oversca['kind'], oversca['parameter'], oversca['value']), ('assign', 'overscan', 'no'))
        dark = self.line('darkc @Dark15-1')
        self.assertEqual(dark['preprocess'], dict(zerocor='yes', darkcor='no', flatcor='no', trim='no', fixpix='no', overscan='no'))
        # ccdproc.zero="Zero.fits" is a file: the darks read the master bias the third zerocomb makes.
        self.assertEqual(sources(dark, 'zero'), ['<' + str(self.line('zerocomb Zero1,Zero2')['index'])])

    def test_switches_continuation_and_sections(self):
        flat = self.line('flatcomb')
        self.assertEqual((flat['issues'], flat['parameters']['process'], flat['parameters']['subsets'], flat['parameters']['statsec']),
                         ([], 'yes', 'yes', '[500:1500,500:1500]'))
        ccdproc = self.line('ccdproc @objB90')
        self.assertEqual({k: ccdproc['parameters'][k] for k in ('fixpix', 'overscan', 'trim', 'zerocor')},
                         dict(fixpix='no', overscan='no', trim='no', zerocor='yes'))
        self.assertEqual(ccdproc['outputs']['output']['value'], 'p')

    def test_names_no_line_makes_are_issues(self):
        ccdproc = self.line('ccdproc @objB90')
        self.assertIn('FlatB.fits: 폴더의 파일이나 앞 줄의 출력이 아닙니다.', ccdproc['issues'])
        self.assertEqual(sources(ccdproc, 'dark'), ['<' + str(self.line('darkc Dark90-1')['index'])])

    def test_lines_that_are_not_task_invocations_skip_with_a_reason(self):
        self.assertEqual(self.line('!ds9')['reason'], '셸 명령')
        self.assertEqual(self.line('vi alNGC2420')['reason'], '셸 명령')

    def test_assignments_to_a_task_apply_to_its_later_runs(self):
        first, second = [l for l in self.lines if l['text'] == 'imexam']
        self.assertEqual(first['parameters'], dict(logfile='NGC2420.cod', keeplog='yes'))
        self.assertEqual(second['parameters'], dict(logfile='NGC2420.cod', keeplog='no'))


class CoursePhotometryTests(unittest.TestCase):
    def test_pset_assignments_minimum_match_and_reach_the_tasks_using_them(self):
        lines = fixture('aperture-photometry.cl', M67 + ['NGC2420b.fits', 'NGC2420v.fits'])
        assigned = [(l['target'], l['parameter']) for l in lines if l['kind'] == 'assign']
        self.assertIn(('fitskypars', 'dannulus'), assigned)
        self.assertIn(('datapars', 'readnoise'), assigned)
        phot_b, phot_v = [l for l in lines if l.get('taskName') == 'phot']
        self.assertEqual(phot_b['task'], 'noao.digiphot.daophot.phot')
        self.assertEqual(phot_b['parameterSets']['fitskypars'], dict(annulus='31', dannulus='27', skyvalue='3680.'))
        self.assertEqual(phot_v['parameterSets']['datapars']['fwhmpsf'], '8.6')
        self.assertEqual(phot_v['parameterSets']['datapars']['readnoise'], '21.')
        # Positional arguments: image, coords, output in .par order.
        self.assertEqual(sources(phot_v, 'coords'), ['<' + str(next(l['index'] for l in lines if l.get('taskName') == 'daofind'))])
        self.assertEqual(phot_v['outputs']['output']['value'], '{name}.mag.1')
        display = next(l for l in lines if l.get('taskName') == 'display')
        self.assertEqual(display['parameters'], dict(frame='1', fill='yes'))
        txdump = next(l for l in lines if l.get('taskName') == 'txdump')
        self.assertEqual((txdump['parameters'], txdump['outputs']['$stdout']['labels']), (dict(fields='ID,MAG,MERR'), ['NGC2420b.dat']))
        self.assertTrue(all(not l['issues'] for l in lines), [l for l in lines if l['issues']])

    def test_file_utilities_and_cl_builtins_skip(self):
        lines = fixture('psf-photometry.cl', M67 + ['NGC2420b.fits', 'NGC2420b.mag.1'])
        reasons = {l['text'].split()[0]: l.get('reason') for l in lines if l['kind'] == 'skip'}
        self.assertEqual(reasons, {'del': '파일 관리 명령', 'unlearn': 'CL 명령'})
        allstar = next(l for l in lines if l.get('taskName') == 'allstar')
        self.assertEqual(sources(allstar, 'psfimage'), ['<' + str(next(l['index'] for l in lines if l.get('taskName') == 'psf'))])
        self.assertEqual(allstar['parameterSets']['daopars'], dict(psfrad='50.', fitrad='10.'))


class RuleTests(unittest.TestCase):
    def test_too_many_positional_arguments(self):
        line, = parse('daophot\ndaofind a.fits b c')[1:]
        self.assertIn('인자가 너무 많습니다', line['issues'][0])

    def test_hidden_parameters_take_values_only_by_keyword(self):
        line, = parse('ccdred\ndarkc a b')[1:]
        self.assertIn('위치 인자는 1개', line['issues'][0])

    def test_ambiguous_abbreviations_are_issues(self):
        task, = parse('imc a')
        self.assertIn('중 어느 작업인지 알 수 없습니다', task['issues'][0])
        param, = parse('ccdred\nzerocomb a n=1')[1:]
        self.assertIn('중 어느 파라미터인지 알 수 없습니다', param['issues'][0])

    def test_unknown_tasks_and_parameters_are_issues(self):
        unknown, param = parse('nosuchtask a\nimcopy a b nosuch=1')
        self.assertEqual(unknown['issues'], ['nosuchtask: 설치된 작업이 아닙니다.'])
        self.assertEqual(param['issues'], ['nosuch: 없는 파라미터입니다.'])

    def test_a_name_in_two_packages_needs_its_package_loaded(self):
        bare, = parse('phot a')
        self.assertIn('패키지를 먼저 불러오세요', bare['issues'][0])
        loaded = parse('apphot\nphot a')[1]
        self.assertEqual(loaded['task'], 'noao.digiphot.apphot.phot')

    def test_switch_on_a_non_boolean_and_enum_values(self):
        switch, = parse('ccdred\nzerocomb a combine+')[1:]
        self.assertIn('yes/no 파라미터가 아닙니다', switch['issues'][0])
        enum, = parse('ccdred\nzerocomb a combine=med')[1:]
        self.assertEqual(enum['parameters']['combine'], 'median')

    def test_ls_without_matches_is_an_issue(self):
        ls, use = parse('ls none-[1-3].fits > X.list\nimcopy @X.list y')
        self.assertEqual(ls['issues'], ['none-[1-3].fits: 맞는 파일이 없습니다.'])
        self.assertEqual(use['issues'], ['@X.list: 목록에 파일이 없습니다.'])

    def test_an_edited_command_line_reads_with_its_task(self):
        """The 정보 tab's line: the node's task, pset parameters by their own names, no file lookup."""
        line, = parse('phot @image.list coords=@coords.list output={name}.mag.1 fwhmpsf=7.5 apertures=4',
                      task='noao.digiphot.daophot.phot', resolve=False)
        self.assertEqual((line['issues'], line['parameterSets']), ([], dict(datapars=dict(fwhmpsf='7.5'), photpars=dict(apertures='4'))))
        self.assertEqual(line['inputs']['image']['text'], '@image.list')


class FrontendFixtureTests(unittest.TestCase):
    def test_the_editor_fixture_is_what_the_parser_reads(self):
        """web/tests/fixtures/commands/m67-bias-dark.json is this parser's output (`python -m tests.test_command_parse --write-fixture`)."""
        lines = fixture('m67-bias-dark.cl')
        self.assertEqual(json.loads((FRONTEND / 'm67-bias-dark.json').read_text()), dict(lines=lines))
        self.assertTrue(all(not l['issues'] for l in lines), [l for l in lines if l['issues']])


if __name__ == '__main__':
    import sys
    if '--write-fixture' in sys.argv:
        FRONTEND.mkdir(parents=True, exist_ok=True)
        (FRONTEND / 'm67-bias-dark.json').write_text(json.dumps(dict(lines=fixture('m67-bias-dark.cl')), ensure_ascii=False, indent=1) + '\n')
    else:
        unittest.main()
