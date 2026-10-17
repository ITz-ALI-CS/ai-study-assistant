import mimetypes
from pathlib import Path

from fastapi.staticfiles import StaticFiles

from main import app

# Makes sure Windows serves the JavaScript files with the right type
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")

dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")