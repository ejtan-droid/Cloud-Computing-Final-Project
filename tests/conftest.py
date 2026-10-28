import os
import tempfile
from pathlib import Path

_f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_f.close()
os.environ["DATABASE_URL"] = "sqlite:///" + Path(_f.name).as_posix()  # tests never touch Supabase
os.environ["SECRET_KEY"] = "test-secret-key-0123456789-abcdefghij"
os.environ["APP_ENV"] = "development"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app import models  # noqa: E402,F401
from app.db import Base, get_engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(get_engine())
    Base.metadata.create_all(get_engine())


@pytest.fixture
def client():
    return TestClient(app)


def make_client():
    return TestClient(app)
