/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    // Modules read import.meta.env at import time (src/lib/api.ts throws
    // without VITE_API_URL), so the values must exist before setupFiles run —
    // locally .env provides them, but CI has no .env.
    env: {
      VITE_API_URL: "http://localhost:8000/api",
      VITE_SOCKET_URL: "http://localhost:8000",
    },
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 60,
        lines: 70,
      },
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/__tests__/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/components/ui/**", // shadcn auto-generated
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
