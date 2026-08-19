import os
from waitress import serve
from app import create_app

app = create_app()

if __name__ == "__main__":
    # Set WEB_HOST=0.0.0.0 only on the designated factory server after its
    # Windows Firewall rule has been restricted to the private factory network.
    serve(app, host=app.config["WEB_HOST"], port=app.config["WEB_PORT"], threads=8)
