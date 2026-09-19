"""Start the local FITS workbench: uv run main.py."""
import uvicorn

if __name__ == '__main__':
    uvicorn.run('giraf.server:app', host='127.0.0.1', port=8501, log_level='warning')
