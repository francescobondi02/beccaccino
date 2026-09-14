import http from "http";
import request from "supertest";
import app from "../../src/app";

let server: http.Server | null = null;
let baseUrl = "";

export function getServer(): http.Server {
  if (!server) {
    server = app.listen(0);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }
  return server;
}

export function getBaseUrl(): string {
  getServer();
  return baseUrl;
}

export function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server = null;
    baseUrl = "";
  });
}

export function api() {
  return request(getServer());
}

export function apiAs(userId: number, username: string) {
  const agent = request(getServer());
  const authenticate = <T extends request.Test>(test: T): T =>
    test
      .set("x-test-user-id", String(userId))
      .set("x-test-username", username) as T;
  return {
    get: (url: string) => authenticate(agent.get(url)),
    post: (url: string) => authenticate(agent.post(url)),
    put: (url: string) => authenticate(agent.put(url)),
    delete: (url: string) => authenticate(agent.delete(url)),
    patch: (url: string) => authenticate(agent.patch(url)),
  };
}
