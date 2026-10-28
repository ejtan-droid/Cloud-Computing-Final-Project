"""Create tables and demo data.  Usage:  python -m app.seed   |   python -m app.seed --reset
Running without --reset never duplicates data. --reset wipes ONLY the demo account's products/sales."""
import sys
from datetime import timedelta
from decimal import Decimal
from sqlalchemy import delete, select
from .db import init_db, session_factory
from .models import Product, Sale, User, utcnow
from .security import hash_password

DEMO_USER, DEMO_PASS, DEMO_STORE = "demo", "Demo@12345", "Aling Nena's Sari-Sari Store"
PRODUCTS = [  # name, sku, category, price, qty, low-stock threshold
    ("Lucky Me Pancit Canton 60g", "NOO-001", "Noodles", "15.00", 120, 24),
    ("Coca-Cola 1.5L", "BEV-001", "Beverages", "75.00", 36, 12),
    ("Safeguard Soap 85g", "TOI-001", "Toiletries", "38.00", 8, 10),  # LOW STOCK on purpose
    ("Egg (per piece)", "FRS-001", "Fresh", "9.00", 90, 30),
    ("Nescafe 3-in-1 Stick", "BEV-002", "Beverages", "8.00", 200, 50),
    ("Rebisco Crackers", "SNK-001", "Snacks", "7.50", 60, 20),
    ("Century Tuna 155g", "CAN-001", "Canned Goods", "42.00", 25, 10),
    ("Datu Puti Vinegar 385ml", "CON-001", "Condiments", "22.00", 40, 12),
]
HISTORY = [  # sku, qty, days ago, hours ago
    ("NOO-001", 10, 6, 5), ("BEV-001", 3, 6, 3), ("BEV-002", 20, 5, 4), ("SNK-001", 8, 4, 6),
    ("TOI-001", 4, 3, 2), ("CAN-001", 5, 3, 1), ("FRS-001", 24, 2, 5), ("CON-001", 6, 2, 2),
    ("NOO-001", 15, 1, 4), ("BEV-001", 5, 1, 2), ("BEV-002", 30, 0, 6), ("FRS-001", 12, 0, 4), ("CAN-001", 3, 0, 2),
]


def seed(reset: bool = False):
    init_db()
    with session_factory()() as db:
        user = db.scalar(select(User).where(User.username == DEMO_USER))
        if user and not reset:
            print("Demo data already exists - nothing changed. Use --reset to restore it.")
            return
        if user:
            db.execute(delete(Sale).where(Sale.owner_id == user.id))
            db.execute(delete(Product).where(Product.owner_id == user.id))
            user.password_hash = hash_password(DEMO_PASS)
        else:
            user = User(username=DEMO_USER, password_hash=hash_password(DEMO_PASS), store_name=DEMO_STORE)
            db.add(user)
        db.flush()
        items = {}
        for name, sku, cat, price, qty, thr in PRODUCTS:
            p = Product(owner_id=user.id, name=name, sku=sku, category=cat, price=Decimal(price),
                        quantity=qty, low_stock_threshold=thr)
            db.add(p)
            items[sku] = p
        db.flush()
        now = utcnow()
        for sku, qty, days, hours in HISTORY:
            if sku not in items:
                continue
            p = items[sku]
            db.add(Sale(owner_id=user.id, product_id=p.id, product_name=p.name, quantity=qty, unit_price=p.price,
                        total=p.price * qty, created_at=now - timedelta(days=days, hours=hours)))
        db.commit()
        print(f"Demo data ready. Username: {DEMO_USER}  Password: {DEMO_PASS}")


if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)
