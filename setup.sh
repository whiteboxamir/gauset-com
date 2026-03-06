#!/bin/bash
set -euo pipefail

echo "Starting backend environment setup..."

choose_python() {
  if command -v python3.11 >/dev/null 2>&1; then
    echo "python3.11"
    return
  fi
  if command -v python3.10 >/dev/null 2>&1; then
    echo "python3.10"
    return
  fi
  echo ""
}

PYTHON_BIN="$(choose_python)"
if [ -z "$PYTHON_BIN" ]; then
  echo "ERROR: Python 3.10+ is required. Install python@3.11 with Homebrew:"
  echo "  brew install python@3.11"
  exit 1
fi

echo "Using $PYTHON_BIN"

# 1. Recreate venv if it exists but is on unsupported Python.
if [ -d "backend_venv" ]; then
  if ! backend_venv/bin/python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >/dev/null 2>&1; then
    backup_name="backend_venv_broken_$(date +%Y%m%d_%H%M%S)"
    echo "Existing backend_venv uses unsupported Python; moving to ${backup_name}"
    mv backend_venv "$backup_name"
  fi
fi

if [ ! -d "backend_venv" ]; then
  "$PYTHON_BIN" -m venv backend_venv
fi

source backend_venv/bin/activate

# 2. Install baseline dependencies
echo "Installing Python dependencies (PyTorch, FastAPI, etc)..."
python -m pip install --upgrade pip setuptools wheel --no-cache-dir
python -m pip install --no-cache-dir torch torchvision numpy pillow trimesh fastapi uvicorn python-multipart

# 3. Create folder structure defined in project layout
echo "Creating directory structure..."
mkdir -p backend/models
mkdir -p uploads/images
mkdir -p assets
mkdir -p scenes

# 4. Clone ML-Sharp
echo "Cloning ML-Sharp..."
if [ ! -d "backend/ml-sharp" ]; then
  git clone https://github.com/apple/ml-sharp.git backend/ml-sharp || echo "Warning: Could not clone apple/ml-sharp. It might be private or unavailable."
else
  echo "ML-Sharp already cloned."
fi

if [ -f "backend/ml-sharp/requirements.txt" ]; then
  (
    cd backend/ml-sharp
    python -m pip install --no-cache-dir -r requirements.txt
  ) || echo "Warning: Failed to install ML-Sharp requirements."
fi

if [ -f "backend/ml-sharp/pyproject.toml" ] || [ -f "backend/ml-sharp/setup.py" ]; then
  python -m pip install --no-cache-dir -e backend/ml-sharp || echo "Warning: Failed to install ML-Sharp package."
fi

# 5. Clone TripoSR
echo "Cloning TripoSR..."
if [ ! -d "backend/TripoSR" ]; then
  git clone https://github.com/VAST-AI-Research/TripoSR.git backend/TripoSR || echo "Warning: Could not clone TripoSR."
else
  echo "TripoSR already cloned."
fi

if [ -f "backend/TripoSR/requirements.txt" ]; then
  # xatlas can fail with CMake 4.x unless this compatibility flag is set.
  CMAKE_POLICY_VERSION_MINIMUM=3.5 python -m pip install --no-cache-dir -r backend/TripoSR/requirements.txt || echo "Warning: Failed to install TripoSR requirements."
fi

echo "Python in use: $(python --version)"
echo "✅ Environment setup complete."
