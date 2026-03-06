import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from pydantic import BaseModel

from models.ml_sharp_wrapper import generate_environment
from models.triposr_wrapper import generate_asset

router = APIRouter()

# Resolve from project root (never process cwd).
PROJECT_ROOT = Path(__file__).resolve().parents[2]
UPLOADS_DIR = PROJECT_ROOT / "uploads" / "images"
SCENES_DIR = PROJECT_ROOT / "scenes"
ASSETS_DIR = PROJECT_ROOT / "assets"

for directory in [UPLOADS_DIR, SCENES_DIR, ASSETS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# In-memory job queue state.
jobs: Dict[str, Dict[str, Any]] = {}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_uploaded_image_path(image_id: str) -> Path:
    matches = sorted(UPLOADS_DIR.glob(f"{image_id}.*"))
    if not matches:
        raise HTTPException(status_code=400, detail=f"Image {image_id} not found in uploads")
    return matches[0]


def _scene_urls(scene_id: str) -> Dict[str, str]:
    base = f"/storage/scenes/{scene_id}/environment"
    return {
        "splats": f"{base}/splats.ply",
        "cameras": f"{base}/cameras.json",
        "metadata": f"{base}/metadata.json",
    }


def _asset_urls(asset_id: str) -> Dict[str, str]:
    base = f"/storage/assets/{asset_id}"
    return {
        "mesh": f"{base}/mesh.glb",
        "texture": f"{base}/texture.png",
        "preview": f"{base}/preview.png",
    }


class SceneSaveRequest(BaseModel):
    scene_id: str
    scene_graph: Dict[str, Any]


class GenerateRequest(BaseModel):
    image_id: str


@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename in upload")

    image_id = uuid.uuid4().hex
    ext = Path(file.filename).suffix.lower() or ".png"
    filename = f"{image_id}{ext}"
    filepath = UPLOADS_DIR / filename

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    filepath.write_bytes(contents)

    return {
        "image_id": image_id,
        "filename": filename,
        "filepath": str(filepath),
        "url": f"/storage/uploads/images/{filename}",
    }


@router.post("/generate/environment")
async def generate_environment_api(request: GenerateRequest, background_tasks: BackgroundTasks):
    image_path = _resolve_uploaded_image_path(request.image_id)

    scene_id = f"scene_{str(uuid.uuid4())[:8]}"
    output_dir = SCENES_DIR / scene_id / "environment"
    output_dir.mkdir(parents=True, exist_ok=True)

    jobs[scene_id] = {
        "id": scene_id,
        "type": "environment",
        "status": "processing",
        "image_id": request.image_id,
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "error": None,
        "result": None,
    }

    def task() -> None:
        try:
            generated_dir = Path(generate_environment(str(image_path), str(output_dir)))
            jobs[scene_id]["status"] = "completed"
            jobs[scene_id]["result"] = {
                "scene_id": scene_id,
                "environment_dir": str(generated_dir),
                "files": {
                    "splats": str(generated_dir / "splats.ply"),
                    "cameras": str(generated_dir / "cameras.json"),
                    "metadata": str(generated_dir / "metadata.json"),
                },
                "urls": _scene_urls(scene_id),
            }
        except Exception as exc:
            jobs[scene_id]["status"] = "failed"
            jobs[scene_id]["error"] = str(exc)
        finally:
            jobs[scene_id]["updated_at"] = _utc_now()

    background_tasks.add_task(task)
    return {
        "scene_id": scene_id,
        "job_id": scene_id,
        "status": "processing",
        "urls": _scene_urls(scene_id),
    }


@router.post("/generate/asset")
async def generate_asset_api(request: GenerateRequest, background_tasks: BackgroundTasks):
    image_path = _resolve_uploaded_image_path(request.image_id)

    asset_id = f"asset_{str(uuid.uuid4())[:8]}"
    output_dir = ASSETS_DIR / asset_id
    output_dir.mkdir(parents=True, exist_ok=True)

    jobs[asset_id] = {
        "id": asset_id,
        "type": "asset",
        "status": "processing",
        "image_id": request.image_id,
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "error": None,
        "result": None,
    }

    def task() -> None:
        try:
            generated_dir = Path(generate_asset(str(image_path), str(output_dir)));
            jobs[asset_id]["status"] = "completed"
            jobs[asset_id]["result"] = {
                "asset_id": asset_id,
                "asset_dir": str(generated_dir),
                "files": {
                    "mesh": str(generated_dir / "mesh.glb"),
                    "texture": str(generated_dir / "texture.png"),
                    "preview": str(generated_dir / "preview.png"),
                },
                "urls": _asset_urls(asset_id),
            }
        except Exception as exc:
            jobs[asset_id]["status"] = "failed"
            jobs[asset_id]["error"] = str(exc)
        finally:
            jobs[asset_id]["updated_at"] = _utc_now()

    background_tasks.add_task(task)
    return {
        "asset_id": asset_id,
        "job_id": asset_id,
        "status": "processing",
        "urls": _asset_urls(asset_id),
    }


@router.post("/scene/save")
async def scene_save(request: SceneSaveRequest):
    scene_dir = SCENES_DIR / request.scene_id
    scene_dir.mkdir(parents=True, exist_ok=True)

    filepath = scene_dir / "scene.json"
    with filepath.open("w") as file_handle:
        json.dump(request.scene_graph, file_handle, indent=2)

    return {
        "status": "saved",
        "scene_id": request.scene_id,
        "filepath": str(filepath),
        "url": f"/storage/scenes/{request.scene_id}/scene.json",
    }


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]
