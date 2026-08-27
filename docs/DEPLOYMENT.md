# Inference Deployment

## Decision

As of 2026-08-25, the supported zero-cost deployment target is a Render Free
web service built from this repository's `Dockerfile`.

| Platform | Decision | Reason |
|---|---|---|
| Render Free | Selected | Public HTTPS Docker service, private source support, and no payment method required |
| Hugging Face Spaces | Rejected for now | New Docker/Gradio Spaces require a paid account; free ZeroGPU is Gradio-only and queued |
| Kaggle Notebooks | Rejected | Session compute has no supported persistent inbound HTTP service |
| Google Cloud Run | Fallback | Generous request-based free allowance, but requires billing and permits overage charges |

Primary platform references:

- [Render Free services](https://render.com/docs/free)
- [Render Docker services](https://render.com/docs/docker)
- [Hugging Face Spaces overview](https://huggingface.co/docs/hub/spaces-overview)
- [Hugging Face ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu)
- [Kaggle Notebooks](https://www.kaggle.com/docs/notebooks)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)

Render Free is suitable for personal play, not an availability commitment. It
provides 512 MB RAM, 0.1 CPU, and 750 instance-hours per month. A service spins
down after 15 minutes without inbound traffic and can take about one minute to
wake. The backend therefore checks readiness before creating a practice room;
individual moves retain a short timeout after the model is warm.

## Artifact

`serving/models/run_d2_champion.pt` is the deployed policy. It is a model-only
export of the selected Run D2 update-1,200 checkpoint:

- source SHA-256:
  `2d281bf0d1150c7629c33360c840b5c3e051599c2a977801a29d8eac79407775`
- selection protocol: `runD2-winner-vs-runC-20260825`
- held-out result: 62.90% against Run C over 2,000 mirrored games

The artifact contains architecture metadata, weights, and selection provenance.
It excludes optimizer, critic, RNG, rollout, and opponent-pool state. Runtime
loading requires its SHA-256 sidecar and uses PyTorch's restricted
`weights_only=True` loader.

Run D2 is the current champion. It has not passed NearPerfect-v1.

Regenerate the artifact only from the selected full checkpoint:

```bash
python -m scripts.export_inference_artifact \
  checkpoints/kaggle-rund2-session2/checkpoints/best.pt
```

Review and commit both the artifact and its `.sha256` sidecar together.

## Deploy

1. Push the AI repository commit before creating or updating the Render service.
2. In Render, create a Blueprint from this private repository and apply
   `render.yaml`.
3. Set `BOT_SERVICE_TOKEN` to a generated secret when the Blueprint prompts.
4. Deploy and wait for `GET /health` to return:

   ```json
   {"status":"ok","model":"ready","tier":"forte"}
   ```

5. Configure the backend with the same token and the Render service URL:

   ```dotenv
   BOT_SERVICE_URL=https://becca-ai.onrender.com
   BOT_SERVICE_TOKEN=<same secret as the AI service>
   ```

6. Create a practice room. The backend's authenticated `GET /ready` request
   wakes a sleeping service and verifies the requested tier plus shared secret
   before any room or bot rows are created.

### CI-gated deployment

GitHub Actions tests on Python 3.12, builds the production Dockerfile, starts
the image, and verifies its model and tier endpoints. A second workflow runs
only after the complete `CI` workflow succeeds on `main`.

Create a Render deploy hook for the AI service and store it in the repository
secret `RENDER_DEPLOY_HOOK_URL`, then disable Render's direct auto-deploy for
the service. `render.yaml` declares `autoDeployTrigger: off`; verify that the
existing service has synchronized that setting before merging this change. A
missing secret fails the deployment workflow.

The deployment workflow passes the tested GitHub commit as the deploy hook's
`ref`, waits for the public `/version` endpoint to report that exact commit,
and then checks `/health` and the deployed tier catalog. Render supplies
`RENDER_GIT_COMMIT`; deployments outside Render can set `GIT_COMMIT_SHA`.

The container uses the PyTorch CPU wheel, one Uvicorn worker, and one BLAS
thread. Startup fails if the promoted artifact is missing, corrupt, or
incompatible. `/health` remains public for Render's probe; `/act` requires the
bearer token, and startup fails when `BOT_SERVICE_TOKEN` is absent or empty.
The backend uses authenticated, tier-specific `/ready`, not the public platform
probe.

The 2026-08-25 local Linux ARM64 container gate measured a 230.8 MB compressed
image and 164.8 MiB resident memory after model preload. Render runs Linux
x86-64, so its post-deploy metrics remain the authoritative capacity check.

## Verify

Before deployment:

```bash
pytest
ruff check .
ruff format --check .
docker build -t becca-ai .
```

After deployment:

1. Confirm `/health` reports the model ready.
2. Confirm `/version` reports the intended source commit.
3. Confirm an unauthenticated `/act` request returns `401`.
4. Run a traced practice game through the backend.
5. Confirm there are no `bot_fallback_to_autoplay` events.

Do not use periodic synthetic traffic to bypass the free-tier sleep policy.
