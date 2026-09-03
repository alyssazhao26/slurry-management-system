from waitress import serve

from app import create_app


app = create_app(display_only=True)


if __name__ == "__main__":
    serve(
        app,
        host=app.config["DISPLAY_HTTP_HOST"],
        port=app.config["DISPLAY_HTTP_PORT"],
        threads=4,
    )
