import { api } from "../helpers/serverHarness";
import { setRuntimeRecoveryReady } from "../../src/runtime/recovery";

describe("Service probes", () => {
  afterEach(() => {
    setRuntimeRecoveryReady(true);
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
});
