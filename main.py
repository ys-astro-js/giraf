"""Start the local FITS workbench: uv run main.py."""
import os

import uvicorn

if __name__ == '__main__':
    uvicorn.run('giraf.server:app', host='127.0.0.1', port=int(os.environ.get('GIRAF_PORT', 8501)), log_level='warning')
