from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.routes import router

PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOADS_DIR = PROJECT_ROOT / "uploads"
ASSETS_DIR = PROJECT_ROOT / "assets"
SCENES_DIR = PROJECT_ROOT / "scenes"

for directory in [UPLOADS_DIR, UPLOADS_DIR / "images", ASSETS_DIR, SCENES_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Gauset Local Backend", version="1.1.0")

# Allow Next.js frontend to talk to FastAPI.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Serve local generated artifacts so the frontend can render them.
app.mount("/storage/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="storage_uploads")
app.mount("/storage/assets", StaticFiles(directory=str(ASSETS_DIR)), name="storage_assets")
app.mount("/storage/scenes", StaticFiles(directory=str(SCENES_DIR)), name="storage_scenes")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


if __name__ == "__main__":
    print("Starting FastAPI Local Server for Gauset...")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
