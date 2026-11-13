import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { randomUUID } from "node:crypto";

const version = randomUUID();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const backend = new URL(env.VITE_SOCKET_URL || env.VITE_API_URL || "/", "http://localhost:8000").origin;
  return {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    },
    server: {
      host: "::",
      port: 8081,
      proxy: {
        "/api": { target: backend },
        "/socket.io": { target: backend, ws: true },
      },
    },
    plugins: [
      react(),
      {
        name: "app-version",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "version.json",
            source: JSON.stringify({ version }),
          });
        },
      },
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "react-router-dom"],
            ui: ["@radix-ui/react-dialog"],
            socket: ["socket.io-client"],
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
