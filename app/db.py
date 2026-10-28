"""Database engine, sessions, and table creation."""
from functools import lru_cache
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache
def get_engine():
    url = get_settings().db_url
    if url.startswith("sqlite"):  # local quick-start / tests only
        return create_engine(url, connect_args={"check_same_thread": False})
    # Small pool: Supabase free tier allows few connections.
    return create_engine(url, pool_size=5, max_overflow=5, pool_pre_ping=True, pool_recycle=300)


@lru_cache
def session_factory():
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_db():
    db = session_factory()()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create tables if they do not exist (safe to run many times)."""
    from . import models  # noqa: F401  (registers tables)
    try:
        Base.metadata.create_all(get_engine())
    except SQLAlchemyError as e:
        raise RuntimeError(
            "Could not connect to the database. Check DATABASE_URL, your internet connection, "
            "and the Supabase password. Details: " + str(e.__cause__ or e)[:200]) from e
