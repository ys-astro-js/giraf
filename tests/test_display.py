"""GIRAF is the IRAF image display: IIS frames persist across jobs, never reach ds9."""
import io
import json
import os
from pathlib import Path
import socket
import struct
import tempfile
import unittest

import numpy as np
from astropy.io import fits
from PIL import Image

from giraf.display import DisplayServer, IIS_READ, PACKED, MEMORY, WCS, FEEDBACK, describe
from giraf.task_capabilities import installed_root


def header(tid, count, subunit, x=0, y=0, z=1, t=0):
    return struct.pack('<8H', tid, (-count) & 0xffff, subunit, 0, x | 0o100000, y | 0o100000, z, t)


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.server = DisplayServer(Path(self.tmp.name) / 'imt').start()
        self.addCleanup(self.server.stop)

    def client(self):
        connection = socket.socket(socket.AF_UNIX)
        connection.connect(self.server.path)
        self.addCleanup(connection.close)
        return connection

    def test_wcs_memory_and_readback_follow_the_imtool_protocol(self):
        c = self.client()
        wcs = b'm51 - galaxy\n1. 0. 0. -1. 1. 512. 35. 346. 1\n'
        c.sendall(header(PACKED, len(wcs), WCS) + wcs)
        row = bytes(range(1, 201)) + bytes(312)
        c.sendall(header(PACKED | 0o30000, len(row), MEMORY, y=10) + row)
        c.sendall(header(IIS_READ | PACKED, 320, WCS))
        self.assertEqual(receive(c, 320).rstrip(b'\0'), wcs)
        c.sendall(header(IIS_READ | PACKED, 512, MEMORY, y=10))
        self.assertEqual(receive(c, 512), row)
        state = self.server.state()
        self.assertEqual(state['current'], 1)
        frame = state['frames'][0]
        self.assertEqual((frame['frame'], frame['width'], frame['height'], frame['title']), (1, 512, 512, 'm51 - galaxy'))
        self.assertEqual(frame['transform'], [1.0, 0.0, 0.0, -1.0, 1.0, 512.0])
        info = self.server.info(1)
        self.assertEqual((info['width'], info['height'], info['header']), (512, 512, wcs.decode()))
        # Viewer positions are 1-based with y up; row 10 from the top is y = 502 = image y.
        self.assertEqual(self.server.pixel(1, 200, 502)['image'], {'x': 200.0, 'y': 502.0})
        with self.assertRaises(ValueError):
            self.server.pixel(1, 0, 1)
        image = Image.open(io.BytesIO(self.server.png(1))).convert('RGB')
        self.assertEqual(image.getpixel((0, 10)), (0, 0, 0))
        self.assertEqual(image.getpixel((199, 10)), (255, 255, 255))

    def test_frames_are_independent_and_erase_clears_one_frame(self):
        c = self.client()
        c.sendall(header(PACKED, 4, MEMORY, z=1) + b'\x10' * 4)
        c.sendall(header(PACKED, 4, MEMORY, z=2) + b'\x20' * 4)
        c.sendall(header(0, 1, FEEDBACK, z=1) + b'\0\0')
        c.sendall(header(IIS_READ | PACKED, 4, MEMORY, z=2))
        self.assertEqual(receive(c, 4), b'\x20' * 4)
        self.assertEqual([f['frame'] for f in self.server.state()['frames']], [2])

    def test_staged_input_names_map_back_to_the_original_file(self):
        self.server.source_name = lambda alias, directory: {'input/s00000.fits': 'NGC2420b.fits'}.get(alias)
        c = self.client()
        wcs = b'input/s00000.fits[1] - cluster\n1. 0. 0. -1. 1. 512. 0. 1. 1\n'
        c.sendall(header(PACKED, len(wcs), WCS) + wcs + header(IIS_READ | PACKED, 320, WCS))
        self.assertEqual(receive(c, 320).rstrip(b'\0'), wcs)
        self.assertEqual(self.server.frames[1].title, 'NGC2420b.fits[1] - cluster')
        untitled = b'input/s00000.fits -\n1. 0. 0. -1. 1. 512. 0. 1. 1\n'
        c.sendall(header(PACKED, len(untitled), WCS, z=2) + untitled + header(IIS_READ | PACKED, 320, WCS, z=2))
        receive(c, 320)
        self.assertEqual(self.server.frames[2].title, 'NGC2420b.fits')

    def test_stale_sockets_of_exited_servers_are_removed(self):
        from giraf.display import remove_stale_sockets
        folder = Path(self.tmp.name)
        dead, alive = folder / 'giraf-999999.imt', folder / f'giraf-{os.getpid()}.imt'
        dead.touch(); alive.touch()
        remove_stale_sockets(folder)
        self.assertFalse(dead.exists())
        self.assertTrue(alive.exists())

    def test_writer_job_folder_names_the_staged_input_exactly(self):
        from giraf.display import peer_directory, source_name
        job = Path(self.tmp.name) / 'job'
        (job / 'input').mkdir(parents=True)
        (job / 'sources.json').write_text(json.dumps([{'alias': 'input/s00000.fits', 'original': '/data/m51.fits'}]))
        self.assertEqual(source_name('input/s00000.fits', job), 'm51.fits')
        # The server's peer here is this test process, so its cwd is ours.
        self.assertEqual(peer_directory(self.client()), Path.cwd())

    def test_closing_the_display_clears_every_frame(self):
        c = self.client()
        c.sendall(header(PACKED, 4, MEMORY, z=1) + b'\x10' * 4 + header(PACKED, 4, MEMORY, z=2) + b'\x20' * 4)
        c.sendall(header(IIS_READ | PACKED, 4, MEMORY, z=2))
        receive(c, 4)
        self.server.close()
        self.assertEqual(self.server.state(), {'current': 1, 'frames': []})

    def test_describe_tolerates_missing_transform(self):
        self.assertEqual(describe(''), {'title': '', 'transform': None})


def receive(connection, size):
    data = b''
    while len(data) < size:
        data += connection.recv(size - len(data))
    return data


@unittest.skipUnless(installed_root(), 'IRAF required')
class IRAFDisplayTests(unittest.TestCase):
    def test_display_then_tvmark_draw_into_giraf_frames(self):
        from giraf.display import start_display, stop_display
        from giraf.generic_tasks import GenericTaskRun, validate_generic
        from giraf.task_discovery import discover
        tasks = discover()['tasks']
        previous = os.environ.get('IMTDEV')
        display = start_display()
        self.addCleanup(stop_display)
        self.addCleanup(lambda: os.environ.__setitem__('IMTDEV', previous) if previous else None)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            y, x = np.mgrid[:200, :300]
            image = root / 'star.fits'
            fits.writeto(image, (10 + 1000 * np.exp(-((x + 1 - 100) ** 2 + (y + 1 - 50) ** 2) / 8)).astype('float32'))
            coords = root / 'star.coo'
            coords.write_text('100 50\n')
            rows = {'image': dict(id='image', name=image.name, label=image.name, path=str(image), asset='image'),
                    'coords': dict(id='coords', name=coords.name, label=coords.name, path=str(coords), asset='text')}
            for step, (task, payload) in enumerate([
                    ('images.tv.display', dict(inputs={'image': ['image']}, parameters={'frame': 1, 'z1': '', 'z2': ''})),
                    ('images.tv.tvmark', dict(inputs={'coords': ['coords']}, parameters={'frame': 1, 'mark': 'point', 'pointsize': 5, 'color': 204}))]):
                manifest = validate_generic(tasks[task], dict(task=task, **payload), rows.get)
                job = root / f'job{step}'
                job.mkdir()
                (job / 'manifest.json').write_text(json.dumps(manifest))
                GenericTaskRun(job).execute()
                status = json.loads((job / 'status.json').read_text())
                self.assertEqual(status['state'], 'completed', (job / 'task.log').read_text() if (job / 'task.log').exists() else status)
            frame = display.frames[1]
            self.assertIn('s00000', frame.wcs.splitlines()[0])
            self.assertGreater(int((frame.pixels > 150).sum()), 0)
            self.assertGreater(int((frame.pixels == 204).sum()), 4)


if __name__ == '__main__':
    unittest.main()
