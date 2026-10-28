"""FastAPI backend: auth, products, sales, dashboard, reports."""
import csv
import io
import logging
from contextlib import asynccontextmanager
from datetime import date as Date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db, init_db
from .models import Product, Sale, User, utcnow
from .security import create_token, decode_token, hash_password, verify_password

log = logging.getLogger("stock")
BASE = Path(__file__).parent


@asynccontextmanager
async def lifespan(app):
    get_settings()  # fail early with a clear message
    init_db()
    yield


app = FastAPI(title="Stock Management System", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


# ---------- helpers ----------
def tz():
    return ZoneInfo(get_settings().timezone)


def to_local(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz())


def local_range(period: str, day: Date):
    if period == "daily":
        s, e = day, day + timedelta(days=1)
    elif period == "weekly":  # Monday to Sunday
        s = day - timedelta(days=day.weekday())
        e = s + timedelta(days=7)
    else:
        s = day.replace(day=1)
        e = s.replace(year=s.year + 1, month=1) if s.month == 12 else s.replace(month=s.month + 1)
    conv = lambda d: datetime.combine(d, time.min, tz()).astimezone(timezone.utc)
    return conv(s), conv(e), s, e


def money(x) -> Decimal:
    return Decimal(x).quantize(Decimal("0.01"))


def pjson(p: Product):
    return dict(id=p.id, name=p.name, sku=p.sku, category=p.category, price=float(p.price),
                quantity=p.quantity, low_stock_threshold=p.low_stock_threshold,
                low_stock=p.quantity <= p.low_stock_threshold, updated_at=to_local(p.updated_at).isoformat())


def sjson(s: Sale):
    return dict(id=s.id, product_name=s.product_name, quantity=s.quantity, unit_price=float(s.unit_price),
                total=float(s.total), created_at=to_local(s.created_at).isoformat())


def sales_between(db: Session, uid: int, start, end):
    q = select(Sale).where(Sale.owner_id == uid, Sale.created_at >= start, Sale.created_at < end)
    return db.scalars(q.order_by(Sale.created_at.desc(), Sale.id.desc())).all()


# ---------- schemas ----------
class Base_(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class RegisterIn(Base_):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=72)
    store_name: str = Field(default="My Store", min_length=1, max_length=80)

    @field_validator("password")
    @classmethod
    def _bytes(cls, v):
        if len(v.encode()) > 72:
            raise ValueError("password is too long")
        return v


class LoginIn(Base_):
    username: str = Field(max_length=30)
    password: str = Field(max_length=72)


class ProductIn(Base_):
    name: str = Field(min_length=1, max_length=100)
    sku: str = Field(min_length=1, max_length=40)
    category: str = Field(default="General", min_length=1, max_length=50)
    price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    quantity: int = Field(ge=0, le=1_000_000)
    low_stock_threshold: int = Field(ge=0, le=1_000_000)


class SaleIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=100_000)


# ---------- auth ----------
def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get("access_token")
    uid = decode_token(token) if token else None
    user = db.get(User, uid) if uid else None
    if not user:
        raise HTTPException(401, "Please sign in.")
    return user


def user_json(u: User):
    return {"id": u.id, "username": u.username, "store_name": u.store_name}


def set_cookie(resp: Response, user_id: int):
    resp.set_cookie("access_token", create_token(user_id), httponly=True, samesite="lax",
                    secure=get_settings().production, max_age=8 * 3600)


@app.post("/api/auth/register", status_code=201)
def register(data: RegisterIn, response: Response, db: Session = Depends(get_db)):
    name = data.username.lower()
    if db.scalar(select(User).where(User.username == name)):
        raise HTTPException(409, "That username is already taken.")
    user = User(username=name, password_hash=hash_password(data.password), store_name=data.store_name)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That username is already taken.")
    set_cookie(response, user.id)
    return user_json(user)


@app.post("/api/auth/login")
def login(data: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == data.username.strip().lower()))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Wrong username or password.")
    set_cookie(response, user.id)
    return user_json(user)


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("access_token")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return user_json(user)


# ---------- products ----------
def sku_taken(db, uid, sku, exclude=None):
    q = select(Product.id).where(Product.owner_id == uid, func.lower(Product.sku) == sku.lower())
    if exclude:
        q = q.where(Product.id != exclude)
    return db.scalar(q) is not None


def own_product(db, uid, pid) -> Product:
    p = db.get(Product, pid)
    if not p or p.owner_id != uid:  # same answer for "missing" and "someone else's"
        raise HTTPException(404, "Product not found.")
    return p


@app.get("/api/products")
def list_products(q: str = Query("", max_length=60), user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Product).where(Product.owner_id == user.id)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Product.name.ilike(like), Product.sku.ilike(like), Product.category.ilike(like)))
    return [pjson(p) for p in db.scalars(stmt.order_by(Product.name))]


@app.post("/api/products", status_code=201)
def add_product(data: ProductIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if sku_taken(db, user.id, data.sku):
        raise HTTPException(409, "You already have a product with that SKU.")
    p = Product(owner_id=user.id, **data.model_dump())
    db.add(p)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "You already have a product with that SKU.")
    return pjson(p)


@app.put("/api/products/{pid}")
def edit_product(pid: int, data: ProductIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own_product(db, user.id, pid)
    if sku_taken(db, user.id, data.sku, exclude=pid):
        raise HTTPException(409, "You already have a product with that SKU.")
    for k, v in data.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return pjson(p)


@app.delete("/api/products/{pid}")
def delete_product(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own_product(db, user.id, pid)
    db.execute(update(Sale).where(Sale.product_id == pid).values(product_id=None))  # keep history
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------- sales ----------
@app.post("/api/sales", status_code=201)
def record_sale(data: SaleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own_product(db, user.id, data.product_id)
    try:
        # One atomic UPDATE: only deducts if enough stock remains (safe even with two phones at once).
        res = db.execute(update(Product).where(Product.id == p.id, Product.owner_id == user.id,
                                               Product.quantity >= data.quantity)
                         .values(quantity=Product.quantity - data.quantity, updated_at=utcnow()))
        if res.rowcount != 1:
            db.rollback()
            db.refresh(p)
            raise HTTPException(400, f"Not enough stock. Only {p.quantity} left.")
        db.refresh(p)
        sale = Sale(owner_id=user.id, product_id=p.id, product_name=p.name, quantity=data.quantity,
                    unit_price=p.price, total=money(p.price * data.quantity))
        db.add(sale)
        db.commit()  # sale + stock deduction are saved together, or not at all
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise
    return {"sale": sjson(sale), "product": pjson(p)}


@app.get("/api/sales")
def list_sales(limit: int = Query(50, ge=1, le=200), user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Sale).where(Sale.owner_id == user.id).order_by(Sale.created_at.desc(), Sale.id.desc()).limit(limit)
    return [sjson(s) for s in db.scalars(q)]


# ---------- dashboard & reports ----------
@app.get("/api/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    count, units = db.execute(select(func.count(Product.id), func.coalesce(func.sum(Product.quantity), 0))
                              .where(Product.owner_id == user.id)).one()
    low = db.scalars(select(Product).where(Product.owner_id == user.id, Product.quantity <= Product.low_stock_threshold)
                     .order_by(Product.quantity)).all()
    today = datetime.now(tz()).date()
    start, end, *_ = local_range("daily", today)
    todays = sales_between(db, user.id, start, end)
    week_start = today - timedelta(days=6)
    rows = sales_between(db, user.id, local_range("daily", week_start)[0], end)
    per_day = {(today - timedelta(days=i)): Decimal(0) for i in range(6, -1, -1)}
    for s in rows:
        per_day[to_local(s.created_at).date()] += s.total
    return dict(total_products=count, total_stock=int(units), low_stock_count=len(low),
                low_stock=[pjson(p) for p in low], sales_today=float(sum((s.total for s in todays), Decimal(0))),
                transactions_today=len(todays), units_today=sum(s.quantity for s in todays),
                week_total=float(sum(per_day.values())),
                chart=[{"date": d.isoformat(), "total": float(v)} for d, v in per_day.items()])


def build_report(db, uid, period, day):
    start, end, s_local, e_local = local_range(period, day or datetime.now(tz()).date())
    sales = sales_between(db, uid, start, end)
    by_product: dict[str, dict] = {}
    for s in sales:
        r = by_product.setdefault(s.product_name, {"product": s.product_name, "quantity": 0, "total": Decimal(0)})
        r["quantity"] += s.quantity
        r["total"] += s.total
    return dict(period=period, start=s_local.isoformat(), end=(e_local - timedelta(days=1)).isoformat(),
                total_sales=float(sum((s.total for s in sales), Decimal(0))),
                total_quantity=sum(s.quantity for s in sales), transactions=len(sales),
                by_product=[{**r, "total": float(r["total"])} for r in sorted(by_product.values(), key=lambda r: -r["total"])],
                sales=[sjson(s) for s in sales])


@app.get("/api/reports")
def report(period: Literal["daily", "weekly", "monthly"] = "daily", day: Date | None = Query(None, alias="date"),
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    return build_report(db, user.id, period, day)


@app.get("/api/reports/csv")
def report_csv(period: Literal["daily", "weekly", "monthly"] = "daily", day: Date | None = Query(None, alias="date"),
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = build_report(db, user.id, period, day)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date/Time", "Product", "Quantity", "Unit price", "Total"])
    for s in r["sales"]:
        name = ("'" + s["product_name"]) if s["product_name"][:1] in "=+-@" else s["product_name"]  # CSV-injection guard
        w.writerow([s["created_at"], name, s["quantity"], f'{s["unit_price"]:.2f}', f'{s["total"]:.2f}'])
    w.writerow([]); w.writerow(["TOTAL", "", r["total_quantity"], "", f'{r["total_sales"]:.2f}'])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="sales_{period}_{r["start"]}.csv"'})


# ---------- health, pages, errors ----------
@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception:
        return JSONResponse({"status": "error", "database": "unreachable"}, status_code=503)


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(BASE / "static" / "index.html")


@app.exception_handler(OperationalError)
async def db_down(request, exc):
    log.error("Database error: %s", exc)
    return JSONResponse({"detail": "The database is unreachable right now. Check your internet and try again."}, status_code=503)


@app.exception_handler(Exception)
async def unexpected(request, exc):
    log.exception("Unhandled error")
    return JSONResponse({"detail": "Something went wrong on the server. Please try again."}, status_code=500)
