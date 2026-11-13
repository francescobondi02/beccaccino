import { api } from "../helpers/serverHarness";
import { setRuntimeRecoveryReady } from "../../src/runtime/recovery";

describe("Service probes", () => {
  const originalRenderCommit = process.env.RENDER_GIT_COMMIT;
  const originalExplicitCommit = process.env.GIT_COMMIT_SHA;

  afterEach(() => {
    setRuntimeRecoveryReady(true);
    if (originalRenderCommit === undefined) {
      delete process.env.RENDER_GIT_COMMIT;
    } else {
      process.env.RENDER_GIT_COMMIT = originalRenderCommit;
    }
    if (originalExplicitCommit === undefined) {
      delete process.env.GIT_COMMIT_SHA;
    } else {
      process.env.GIT_COMMIT_SHA = originalExplicitCommit;
    }
  });

  it("reports liveness", async () => {
    const response = await api().get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("reports not ready until runtime recovery completes", async () => {
    setRuntimeRecoveryReady(false);

    const response = await api().get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "not_ready",
      reason: "runtime recovery incomplete",
    });
  });

  it("reports ready after runtime recovery and a database probe", async () => {
    setRuntimeRecoveryReady(true);

    const response = await api().get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });

  it("reports the Render commit used by deployment verification", async () => {
    process.env.RENDER_GIT_COMMIT = "render-commit";
    process.env.GIT_COMMIT_SHA = "explicit-commit";

    const response = await api().get("/version");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      service: "backend",
      commit: "render-commit",
    });
  });

  it("supports an explicit commit outside Render", async () => {
    delete process.env.RENDER_GIT_COMMIT;
    process.env.GIT_COMMIT_SHA = "explicit-commit";

    const response = await api().get("/version");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      service: "backend",
      commit: "explicit-commit",
    });
  });
});
