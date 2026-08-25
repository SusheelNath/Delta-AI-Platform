from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
HOSPITAL_DATA_DIR = Path(r"C:\Users\sushe\Downloads\Hospital AI platform")
IFC_SOURCE = HOSPITAL_DATA_DIR / "A10004_Chirec_Light_IFC (1).ifc"
DATABASE_URL = f"sqlite:///{DATA_DIR / 'delta.db'}"
XKT_OUTPUT = PROJECT_ROOT / "frontend" / "public" / "models" / "hospital.xkt"
