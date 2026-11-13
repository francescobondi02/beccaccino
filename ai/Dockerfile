FROM python:3.12.12-slim-bookworm

ARG TORCH_VERSION=2.8.0
ARG PIP_INDEX_URL=https://pypi.org/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    PORT=10000

WORKDIR /app

# Dependencies first, so code edits reuse these cached layers.
RUN python -m pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        --extra-index-url "${PIP_INDEX_URL}" \
        "torch==${TORCH_VERSION}+cpu"

COPY pyproject.toml README.md ./
RUN python -m pip install --no-cache-dir ".[serve]"

COPY becca_env ./becca_env
COPY evaluation ./evaluation
COPY inference ./inference
COPY serving ./serving
COPY training ./training

RUN python -c "from pathlib import Path; import torch; from serving.artifact import load_inference_artifact; from training.checkpoint import build_net; artifact = load_inference_artifact(Path('serving/models/run_d2_champion.pt')); build_net(artifact, torch.device('cpu'))" \
    && python -c "from serving.tiers import get_agent; get_agent('forte')" \
    && useradd --create-home --uid 10001 app

USER app

EXPOSE 10000

CMD ["sh", "-c", "exec uvicorn serving.app:app --host 0.0.0.0 --port \"${PORT}\" --workers 1"]
