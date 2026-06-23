#!/usr/bin/env python3
import os
import threading
import webbrowser
from http.server import ThreadingHTTPServer

from papercraft.http_handler import Handler
from papercraft.utils import APP_VERSION


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    url = f"http://localhost:{port}"
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"AI LaTeX Paper Editor: {url}")
    print(f"PaperCraft backend version: {APP_VERSION}")
    if os.getenv("AUTO_OPEN") == "1":
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    server.serve_forever()
