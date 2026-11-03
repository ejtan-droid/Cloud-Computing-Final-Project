from app.db import session_factory
from app.models import Product, Sale
from app.seed import seed
from sqlalchemy import func, select
from .conftest import make_client

PW = "Passw0rd!x"


def reg(c, u="alice"):
    return c.post("/api/auth/register", json={"username": u, "password": PW, "store_name": "S"})


def add(c, sku="A1", price="10.50", qty=5, thr=2, name="Item"):
    return c.post("/api/products", json=dict(name=name, sku=sku, category="C", price=price, quantity=qty, low_stock_threshold=thr))


def test_register_login_logout(client):
    assert reg(client).status_code == 201
    assert client.get("/api/auth/me").json()["username"] == "alice"
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"username": "alice", "password": "bad"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "ALICE", "password": PW}).status_code == 200
    assert reg(client).status_code == 409


def test_password_is_hashed(client):
    reg(client)
    with session_factory()() as db:
        from app.models import User
        assert db.scalar(select(User.password_hash)) != PW


def test_protected_routes(client):
    for path in ["/api/products", "/api/sales", "/api/dashboard", "/api/reports", "/api/reports/csv"]:
        assert client.get(path).status_code == 401
    assert client.post("/api/sales", json={"product_id": 1, "quantity": 1}).status_code == 401


def test_product_crud_and_validation(client):
    reg(client)
    pid = add(client).json()["id"]
    assert client.get("/api/products?q=item").json()[0]["sku"] == "A1"
    assert add(client).status_code == 409  # duplicate SKU
    assert add(client, sku="B", price="-1").status_code == 422
    assert add(client, sku="B", qty=-3).status_code == 422
    assert add(client, sku="B", price="1.234").status_code == 422
    assert add(client, sku="B", name="  ").status_code == 422
    r = client.put(f"/api/products/{pid}", json=dict(name="New", sku="A1", category="C", price="12", quantity=9, low_stock_threshold=1))
    assert r.json()["name"] == "New" and r.json()["quantity"] == 9
    assert client.delete(f"/api/products/{pid}").status_code == 200
    assert client.get("/api/products").json() == []


def test_sale_deducts_stock_and_totals(client):
    reg(client)
    pid = add(client, qty=10).json()["id"]
    r = client.post("/api/sales", json={"product_id": pid, "quantity": 3})
    assert r.status_code == 201
    assert r.json()["sale"]["total"] == 31.5 and r.json()["product"]["quantity"] == 7
    assert client.get("/api/products").json()[0]["quantity"] == 7
    assert len(client.get("/api/sales").json()) == 1


def test_insufficient_stock_blocks_sale(client):
    reg(client)
    pid = add(client, qty=2).json()["id"]
    r = client.post("/api/sales", json={"product_id": pid, "quantity": 3})
    assert r.status_code == 400 and "Only 2" in r.json()["detail"]
    assert client.get("/api/products").json()[0]["quantity"] == 2
    assert client.get("/api/sales").json() == []
    assert client.post("/api/sales", json={"product_id": pid, "quantity": 0}).status_code == 422


def test_users_cannot_see_each_others_data(client):
    reg(client)
    pid = add(client).json()["id"]
    sid = client.post("/api/sales", json={"product_id": pid, "quantity": 1}).json()["sale"]["id"]
    bob = make_client()
    reg(bob, "bob")
    assert bob.get("/api/products").json() == [] and bob.get("/api/sales").json() == []
    assert bob.put(f"/api/products/{pid}", json=dict(name="x", sku="A1", category="C", price="1", quantity=1, low_stock_threshold=1)).status_code == 404
    assert bob.delete(f"/api/products/{pid}").status_code == 404
    assert bob.post("/api/sales", json={"product_id": pid, "quantity": 1}).status_code == 404
    assert bob.get("/api/dashboard").json()["total_products"] == 0
    assert bob.get("/api/reports?period=monthly").json()["total_sales"] == 0
    assert client.get("/api/products").json()[0]["quantity"] == 4 and sid


def test_low_stock_uses_threshold_and_updates(client):
    reg(client)
    pid = add(client, qty=5, thr=3).json()["id"]
    assert client.get("/api/dashboard").json()["low_stock_count"] == 0
    client.post("/api/sales", json={"product_id": pid, "quantity": 2})  # 3 left == threshold
    d = client.get("/api/dashboard").json()
    assert d["low_stock_count"] == 1 and d["low_stock"][0]["id"] == pid
    assert d["total_stock"] == 3 and d["sales_today"] == 21.0


def test_reports_totals(client):
    reg(client)
    a = add(client, sku="A", price="10.50", qty=50).json()["id"]
    b = add(client, sku="B", price="2.25", qty=50, name="Other").json()["id"]
    client.post("/api/sales", json={"product_id": a, "quantity": 3})   # 31.50
    client.post("/api/sales", json={"product_id": b, "quantity": 4})   # 9.00
    for period in ("daily", "weekly", "monthly"):
        r = client.get(f"/api/reports?period={period}").json()
        assert r["total_sales"] == 40.5 and r["total_quantity"] == 7 and r["transactions"] == 2
    assert client.get("/api/reports?period=daily&date=2000-01-01").json()["total_sales"] == 0
    csv = client.get("/api/reports/csv?period=daily")
    assert csv.status_code == 200 and "40.50" in csv.text


def test_seed_is_repeatable():
    def counts():
        with session_factory()() as db:
            return db.scalar(select(func.count(Product.id))), db.scalar(select(func.count(Sale.id)))
    seed(); first = counts()
    seed(); assert counts() == first
    seed(reset=True); assert counts() == first
    c = make_client()
    assert c.post("/api/auth/login", json={"username": "demo", "password": "Demo@12345"}).status_code == 200
    assert c.get("/api/dashboard").json()["low_stock_count"] == 1


def test_health(client):
    assert client.get("/health").json()["database"] == "connected"


def add_bc(c, sku, barcode, **kw):
    body = dict(name="P" + sku, sku=sku, category="C", price="5", quantity=5, low_stock_threshold=1, barcode=barcode)
    body.update(kw)
    return c.post("/api/products", json=body)


def test_barcode_add_lookup_search(client):
    reg(client)
    r = add_bc(client, "S1", " 4800016644801 ")
    assert r.status_code == 201 and r.json()["barcode"] == "4800016644801"
    assert client.get("/api/products/barcode/4800016644801").json()["sku"] == "S1"
    assert client.get("/api/products/barcode/000").status_code == 404
    assert client.get("/api/products?q=48000166").json()[0]["sku"] == "S1"


def test_barcode_is_optional_and_blank_means_none(client):
    reg(client)
    assert add_bc(client, "A", None).json()["barcode"] is None
    assert add_bc(client, "B", "   ").json()["barcode"] is None  # two products without barcodes are fine
    assert add_bc(client, "C", "").status_code == 201


def test_barcode_duplicates_and_validation(client):
    reg(client)
    add_bc(client, "A", "111")
    assert add_bc(client, "B", "111").status_code == 409
    pid = add_bc(client, "B", "222").json()["id"]
    body = dict(name="x", sku="B", category="C", price="5", quantity=5, low_stock_threshold=1, barcode="111")
    assert client.put(f"/api/products/{pid}", json=body).status_code == 409
    body["barcode"] = "222"  # keeping its own barcode is fine
    assert client.put(f"/api/products/{pid}", json=body).status_code == 200
    assert add_bc(client, "Z", "bad code!").status_code == 422
    assert add_bc(client, "Y", "1" * 65).status_code == 422


def test_barcode_is_private_per_store(client):
    reg(client)
    add_bc(client, "A", "555")
    bob = make_client()
    reg(bob, "bob")
    assert bob.get("/api/products/barcode/555").status_code == 404
    assert add_bc(bob, "A", "555").status_code == 201  # another store may use the same code

def cart(*pairs):
    return {"items": [{"product_id": p, "quantity": q} for p, q in pairs]}


def test_checkout_many_items(client):
    reg(client)
    a = add(client, sku="A", price="10.50", qty=10, thr=2).json()["id"]
    b = add(client, sku="B", price="2.25", qty=3, thr=3, name="Other").json()["id"]
    r = client.post("/api/checkout", json=cart((a, 3), (b, 2), (a, 1)))  # A appears twice -> merged to 4
    assert r.status_code == 201
    d = r.json()
    assert d["total"] == 46.5 and len(d["items"]) == 2 and d["receipt_no"].startswith("R")
    assert {i["receipt_no"] for i in d["items"]} == {d["receipt_no"]}
    stock = {p["id"]: p["quantity"] for p in client.get("/api/products").json()}
    assert stock == {a: 6, b: 1}
    assert [p["id"] for p in d["low_stock"]] == [b]
    assert client.get("/api/reports?period=daily").json()["total_sales"] == 46.5


def test_checkout_is_all_or_nothing(client):
    reg(client)
    a = add(client, sku="A", qty=10).json()["id"]
    b = add(client, sku="B", qty=1, name="Scarce").json()["id"]
    r = client.post("/api/checkout", json=cart((a, 4), (b, 2)))
    assert r.status_code == 400 and "Scarce (only 1 left)" in r.json()["detail"]
    stock = {p["id"]: p["quantity"] for p in client.get("/api/products").json()}
    assert stock == {a: 10, b: 1}          # nothing was deducted, not even product A
    assert client.get("/api/sales").json() == []


def test_checkout_rejects_bad_requests(client):
    reg(client)
    a = add(client, qty=5).json()["id"]
    assert client.post("/api/checkout", json={"items": []}).status_code == 422
    assert client.post("/api/checkout", json=cart((a, 0))).status_code == 422
    assert client.post("/api/checkout", json=cart((9999, 1))).status_code == 404
    bob = make_client()
    reg(bob, "bob")
    assert bob.post("/api/checkout", json=cart((a, 1))).status_code == 404   # not bob's product
    assert make_client().post("/api/checkout", json=cart((a, 1))).status_code == 401
    assert client.get("/api/products").json()[0]["quantity"] == 5