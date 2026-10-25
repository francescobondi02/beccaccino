import "@testing-library/jest-dom";

// Mock import.meta.env for tests
Object.defineProperty(import.meta, "env", {
  value: {
    VITE_API_URL: "http://localhost:8000/api",
    VITE_SOCKET_URL: "http://localhost:8000",
  },
});

// jsdom doesn't implement scrollIntoView
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = () => {};
}
