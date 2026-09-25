import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(PROJECT_ROOT / "data")))
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'delta.db'}")
HOSPITAL_DATA_DIR = PROJECT_ROOT / "Hospital AI platform"
XKT_OUTPUT = PROJECT_ROOT / "frontend" / "public" / "models" / "hospital.xkt"
