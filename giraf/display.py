"""GIRAF as the IRAF image display: an IIS (imtool) server on a private socket.

IRAF tasks started by GIRAF inherit IMTDEV pointing here, so `display`, `tvmark`
and other image-display output appears in GIRAF and never in a user's own ds9.
Frames persist across jobs, as in ds9: tvmark draws onto what display loaded.
"""
import io
import os
from pathlib import Path
import re
import socket
import struct
import subprocess
import sys
import tempfile
import threading

import numpy as np
from PIL import Image

IIS_READ, PACKED = 0o100000, 0o40000
MEMORY, FEEDBACK, IMCURSOR, WCS = 0o1, 0o5, 0o20, 0o21
XY_MASK = 0o77777
WCS_BYTES = 320
FRAMES = 16
# imtoolrc defaults when the installed file is unavailable.
CONFIGS = {1: (512, 512), 2: (800, 800), 3: (1024, 1024), 4: (1600, 1600), 5: (2048, 2048),
           6: (4096, 4096), 7: (8192, 8192), 8: (1024, 4096), 11: (128, 128), 12: (256, 256)}
# IRAF display LUT: 1-200 grey levels, 201 cursor, 202-217 graphics colours.
GRAPHICS = ['ffffff', '000000', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00', '00ffff', 'ff00ff',
            'ff7f50', 'b03060', 'ffa500', 'f0e68c', 'da70d6', '40e0d0', 'ee82ee', 'f5deb3']


def read_configs(root):
    configs = dict(CONFIGS)
    path = Path(root or '') / 'dev' / 'imtoolrc'
    if path.is_file():
        for line in path.read_text(errors='replace').splitlines():
            fields = line.split('#', 1)[0].split()
            if len(fields) >= 4 and all(f.isdigit() for f in fields[:4]):
                configs[int(fields[0])] = (int(fields[2]), int(fields[3]))
    return configs


def palette():
    colours = [0, 0, 0]
    colours += [round((i - 1) * 255 / 199) for i in range(1, 201) for _ in range(3)]
    colours += [int(c[j:j + 2], 16) for c in GRAPHICS for j in (0, 2, 4)]
    colours += [255] * (768 - len(colours))
    return colours[:768]


class Frame:
    def __init__(self, width, height):
        self.pixels = np.zeros((height, width), np.uint8)
        self.wcs = ''
        self.title = ''
        self.version = 0


class DisplayServer:
    def __init__(self, path=None, configs=None, source_name=None):
        self.path = str(path or Path(tempfile.gettempdir()) / f'giraf-{os.getpid()}.imt')
        self.configs = configs or dict(CONFIGS)
        self.frames = {}
        self.config = 1
        self.current = 1
        self.lock = threading.Lock()
        self.socket = None
        self.palette = palette()
        # Jobs display staged copies (input/s00000.fits); map back to the original name.
        self.source_name = source_name or (lambda alias, directory: None)

    @property
    def device(self):
        return 'unix:' + self.path

    def start(self):
        if os.path.exists(self.path):
            os.unlink(self.path)
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.bind(self.path)
        os.chmod(self.path, 0o600)
        self.socket.listen(8)
        threading.Thread(target=self.accept, name='giraf-display', daemon=True).start()
        return self

    def stop(self):
        if self.socket:
            self.socket.close()
            self.socket = None
        if os.path.exists(self.path):
            os.unlink(self.path)

    def accept(self):
        while self.socket:
            try:
                connection, _ = self.socket.accept()
            except OSError:
                return
            threading.Thread(target=self.serve, args=(connection,), daemon=True).start()

    def serve(self, connection):
        with connection:
            try:
                while True:
                    self.packet(connection, *struct.unpack('<8H', receive(connection, 16)))
            except (EOFError, OSError):
                pass

    def packet(self, connection, tid, count, subunit, _checksum, x, y, z, t):
        count = struct.unpack('<h', struct.pack('<H', count))[0]
        size = abs(count) if tid & PACKED else abs(count) * 2
        read, kind = bool(tid & IIS_READ), subunit & 0o77
        if kind == WCS:
            if read:
                connection.sendall(self.read_wcs(z).encode().ljust(WCS_BYTES, b'\0')[:WCS_BYTES])
            else:
                self.write_wcs(z, t, receive(connection, size), lambda: peer_directory(connection))
        elif kind == MEMORY:
            if read:
                connection.sendall(self.read_memory(z, x & XY_MASK, y & XY_MASK, size))
            else:
                self.write_memory(z, x & XY_MASK, y & XY_MASK, receive(connection, size))
        elif kind == IMCURSOR and read:
            # Interactive cursors are not wired to the GIRAF display yet; quit.
            connection.sendall(b'1.0 1.0 101 q\n'.ljust(WCS_BYTES, b'\0'))
        else:
            if read:
                connection.sendall(b'\0' * size)
            elif size:
                receive(connection, size)
            if kind == FEEDBACK and not read:
                self.erase(z)

    def numbers(self, mask):
        return [n + 1 for n in range(FRAMES) if mask & (1 << n)] or [self.current]

    def frame(self, number):
        width, height = self.configs.get(self.config, CONFIGS[1])
        frame = self.frames.get(number)
        if frame is None or frame.pixels.shape != (height, width):
            frame = self.frames[number] = Frame(width, height)
        return frame

    def read_wcs(self, mask):
        with self.lock:
            frame = self.frames.get(self.numbers(mask)[0])
            return frame.wcs if frame and frame.wcs else '[NOSUCHFRAME]\n1.0 0.0 0.0 -1.0 1.0 1.0 0.0 0.0 1\n'

    def write_wcs(self, mask, t, data, directory=lambda: None):
        wcs = data.split(b'\0', 1)[0].decode(errors='replace')
        title = self.title(wcs, directory)
        with self.lock:
            self.config = (t & 0o777) + 1
            for number in self.numbers(mask):
                self.current = number
                frame = self.frame(number)
                frame.wcs, frame.title = wcs, title
                frame.version += 1

    def title(self, wcs, directory=lambda: None):
        """IRAF writes `name[section] - image title`; untitled images end in ' -'."""
        title = re.sub(r'\s+-\s*$', '', describe(wcs)['title'])
        match = re.match(r'(input/s\d{5}\.\w+)(.*)', title)
        original = self.source_name(match[1], directory()) if match else None
        return original + match[2] if original else title

    def read_memory(self, mask, x, y, size):
        with self.lock:
            pixels = self.frame(self.numbers(mask)[0]).pixels
            start = y * pixels.shape[1] + x
            return pixels.reshape(-1)[start:start + size].tobytes().ljust(size, b'\0')

    def write_memory(self, mask, x, y, data):
        values = np.frombuffer(data, np.uint8)
        with self.lock:
            for number in self.numbers(mask):
                frame = self.frame(number)
                flat = frame.pixels.reshape(-1)
                start = y * frame.pixels.shape[1] + x
                end = min(start + len(values), flat.size)
                flat[start:end] = values[:end - start]
                frame.version += 1

    def erase(self, mask):
        with self.lock:
            for number in self.numbers(mask):
                frame = self.frame(number)
                frame.pixels[:] = 0
                frame.version += 1

    def state(self):
        with self.lock:
            return dict(current=self.current, frames=[
                dict(frame=n, version=f.version, width=f.pixels.shape[1], height=f.pixels.shape[0],
                     title=f.title, transform=describe(f.wcs)['transform'])
                for n, f in sorted(self.frames.items()) if f.pixels.any()])

    def info(self, number):
        """Viewer metadata for a rendered 8-bit frame (frame-buffer levels, not data)."""
        with self.lock:
            frame = self.existing(number)
            height, width = frame.pixels.shape
            levels = frame.pixels
            return dict(width=width, height=height, low=0, high=255, mean=float(levels.mean()),
                        median=float(np.median(levels)), std=float(levels.std()),
                        min=int(levels.min()), max=int(levels.max()), header=frame.wcs)

    def pixel(self, number, x, y):
        """A viewer position (1-based, y up) and the IRAF image pixel shown there."""
        with self.lock:
            frame = self.existing(number)
            height, width = frame.pixels.shape
            if not (1 <= x <= width and 1 <= y <= height):
                raise ValueError('영상 밖의 좌표입니다.')
            column, row = x - 1, height - y
            transform = describe(frame.wcs)['transform']
            image = None
            if transform:
                a, b, c, d, tx, ty = transform
                image = dict(x=round(a * column + c * row + tx, 2), y=round(b * column + d * row + ty, 2))
            return dict(x=x, y=y, value=None, row=[], column=[], image=image)

    def existing(self, number):
        frame = self.frames.get(number)
        if frame is None:
            raise KeyError(f'디스플레이 프레임 {number}이 없습니다.')
        return frame

    def png(self, number):
        with self.lock:
            image = Image.fromarray(self.existing(number).pixels.copy(), 'P')
        image.putpalette(self.palette)
        out = io.BytesIO()
        image.save(out, format='PNG')
        return out.getvalue()


def describe(wcs):
    """Title and frame-to-image transform from an IIS WCS string."""
    lines = wcs.splitlines()
    numbers = re.findall(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?', lines[1]) if len(lines) > 1 else []
    return dict(title=lines[0].strip() if lines else '',
                transform=[float(v) for v in numbers[:6]] if len(numbers) >= 6 else None)


def receive(connection, size):
    data = bytearray()
    while len(data) < size:
        chunk = connection.recv(size - len(data))
        if not chunk:
            raise EOFError
        data += chunk
    return bytes(data)


SERVER = None


def display_number(id):
    """Viewer asset ids for display frames: `display:N`."""
    if isinstance(id, str) and id.startswith('display:'):
        return int(id.split(':', 1)[1])
    return None


def peer_directory(connection):
    """Working directory of the IRAF process writing to the display: its job folder."""
    try:
        if sys.platform == 'darwin':
            pid = struct.unpack('i', connection.getsockopt(0, 0x002, 4))[0]  # SOL_LOCAL, LOCAL_PEERPID
            listing = subprocess.run(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'],
                                     capture_output=True, text=True, timeout=2).stdout
            return next(Path(line[1:]) for line in listing.splitlines() if line.startswith('n'))
        pid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[0]
        return Path(os.readlink(f'/proc/{pid}/cwd'))
    except (OSError, ValueError, AttributeError, StopIteration, struct.error, subprocess.SubprocessError):
        return None


def source_name(alias, directory):
    """Original name of a staged input, from the writing job's own sources.json."""
    import json
    for folder in [directory, *directory.parents[:2]] if directory else []:
        try:
            sources = json.loads((folder / 'sources.json').read_text())
        except (OSError, ValueError):
            continue
        return next((Path(s['original']).name for s in sources if s.get('alias') == alias), None)
    return running_source_name(alias)


def running_source_name(alias):
    """Fallback without a known writer: the one active job using the alias."""
    import json
    from .jobs import RUNS
    names = set()
    for job in sorted(RUNS.glob('*'), reverse=True)[:50]:
        try:
            if json.loads((job / 'status.json').read_text()).get('state') not in ('queued', 'running'):
                continue
            names |= {Path(s['original']).name for s in json.loads((job / 'sources.json').read_text()) if s['alias'] == alias}
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return names.pop() if len(names) == 1 else None


def remove_stale_sockets(folder=None):
    """Sockets of GIRAF servers that exited without shutdown (e.g. SIGKILL)."""
    for path in Path(folder or tempfile.gettempdir()).glob('giraf-*.imt'):
        try:
            os.kill(int(path.stem.split('-', 1)[1]), 0)
        except ProcessLookupError:
            path.unlink(missing_ok=True)
        except (ValueError, PermissionError):
            continue


def start_display():
    """Start the app-wide display and route child IRAF processes to it."""
    global SERVER
    if SERVER is None:
        remove_stale_sockets()
        from .task_capabilities import installed_root
        SERVER = DisplayServer(configs=read_configs(installed_root()), source_name=source_name).start()
        os.environ['IMTDEV'] = SERVER.device
    return SERVER


def stop_display():
    global SERVER
    if SERVER is not None:
        SERVER.stop()
        if os.environ.get('IMTDEV') == SERVER.device:
            del os.environ['IMTDEV']
        SERVER = None


def display_number(id):
    """Viewer asset ids for display frames: `display:N`."""
    if isinstance(id, str) and id.startswith('display:'):
        return int(id.split(':', 1)[1])
    return None
