"""Exercise the interactive transport through real PTYs and a small CL peer."""
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import tempfile
import tracemalloc
import unittest
from unittest.mock import patch

from giraf import task_session


PEER = r'''
import os, signal, sys, time
from pathlib import Path
def emit(text):
    sys.stdout.write(text)
    sys.stdout.flush()
emit('ec')
time.sleep(.02)
emit('l> ')
for line in sys.stdin:
    command = line.strip()
    if command == 'question':
        emit('별 이름: ')
        answer = sys.stdin.readline().strip()
        emit('ANSWER=' + answer + '\nContinue (yes) ')
        emit('CONFIRM=' + sys.stdin.readline().strip() + '\n')
    elif command == 'cursor':
        with open('cursor.fifo') as fifo:
            emit('CURSOR=' + fifo.readline())
            emit('CURSOR=' + fifo.readline())
    elif command == 'bulk':
        emit('x' * (8 * 1024 * 1024) + '\n별 끝\n')
    elif command == 'wait':
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        Path('cancel').touch()
        time.sleep(30)
    elif command == 'hang':
        time.sleep(30)
    elif command == 'signal':
        os.kill(os.getpid(), signal.SIGTERM)
    elif command == 'logout':
        emit('FINAL OUTPUT\n')
        sys.exit(int(os.environ.get('PEER_EXIT', '0')))
    else:
        emit('COMMAND=' + command + '\n')
    emit('ccdred> ')
'''


class CLTerminalTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.job = Path(temp.name)
        (self.job / 'uparm').mkdir()
        self.peer = self.job / 'peer'
        self.peer.write_text(f'#!{sys.executable}\n' + PEER)
        self.peer.chmod(0o700)

    def run_peer(self, commands, **env):
        script = self.job / 'commands.cl'
        script.write_text('\n'.join(commands) + '\n')
        with (self.job / 'task.log').open('wb') as log:
            return task_session.run_cl_terminal(
                [str(self.peer), '-f', str(script)], self.job, log,
                dict(os.environ, **env))

    def assert_reaped(self):
        pid = json.loads((self.job / 'engine-process.json').read_text())['pid']
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_commands_questions_unicode_and_final_output(self):
        questions = []
        def answer(job, kind, prompt):
            questions.append((kind, prompt))
            return '시리우스' if len(questions) == 1 else 'yes'
        with patch.object(task_session, 'ask', side_effect=answer):
            self.assertEqual(self.run_peer(['question', 'next', 'logout'], PEER_EXIT='7'), 7)
        log = (self.job / 'task.log').read_text()
        self.assertEqual([kind for kind, _ in questions], ['text', 'text'])
        self.assertIn('별 이름:', questions[0][1])
        for expected in ('ANSWER=시리우스', 'CONFIRM=yes', 'COMMAND=next', 'FINAL OUTPUT'):
            self.assertIn(expected, log)
        self.assert_reaped()

    def test_cursor_fifo_then_next_command(self):
        with patch.object(task_session, 'ask', side_effect=['12 34 1 a', '12 34 1 q']) as ask:
            self.assertEqual(self.run_peer(['cursor', 'next', 'logout']), 0)
        self.assertEqual(ask.call_count, 2)
        self.assertEqual(ask.call_args.args[1], 'cursor')
        self.assertIn('CURSOR=12 34 1 a', (self.job / 'task.log').read_text())
        self.assertIn('CURSOR=12 34 1 q', (self.job / 'task.log').read_text())
        self.assertIn('COMMAND=next', (self.job / 'task.log').read_text())
        self.assert_reaped()

    def test_large_output_is_logged_with_bounded_memory(self):
        tracemalloc.start()
        try:
            self.assertEqual(self.run_peer(['bulk', 'logout']), 0)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 4 * 1024 * 1024)
        log = (self.job / 'task.log').read_bytes()
        self.assertEqual(log.count(b'x'), 8 * 1024 * 1024)
        self.assertIn('별 끝'.encode(), log)
        self.assertIn(b'FINAL OUTPUT', log)

    def test_cancel_terminates_and_reaps_child(self):
        with self.assertRaises(task_session.Cancelled):
            self.run_peer(['wait'])
        self.assert_reaped()

    def test_cancel_while_waiting_for_user_reaps_child(self):
        with patch.object(task_session, 'ask', side_effect=task_session.Cancelled('중단')):
            with self.assertRaises(task_session.Cancelled):
                self.run_peer(['question'])
        self.assert_reaped()

    def test_timeout_terminates_and_reaps_child(self):
        with patch.object(task_session, 'CL_TIMEOUT_SECONDS', .2, create=True):
            with self.assertRaises(TimeoutError):
                self.run_peer(['hang'])
        self.assert_reaped()

    def test_signal_exit_is_preserved(self):
        self.assertEqual(self.run_peer(['signal']), -signal.SIGTERM)
        self.assert_reaped()

    @unittest.skipUnless(shutil.which('irafcl'), 'IRAF CL is not installed')
    def test_installed_iraf_prompt_and_logout(self):
        self.peer = Path(shutil.which('irafcl'))
        with patch.object(task_session, 'CL_TIMEOUT_SECONDS', 15, create=True):
            self.assertEqual(self.run_peer(['print ("GIRAF_PEXPECT_OK")', 'logout']), 0)
        self.assertIn('GIRAF_PEXPECT_OK', (self.job / 'task.log').read_text())
        self.assert_reaped()
