import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const backend = new URL(env.VITE_SOCKET_URL || env.VITE_API_URL || "/", "http://localhost:8000").origin;
  return {
    server: {
      host: "::",
      port: 8081,
      proxy: {
        "/api": { target: backend },
        "/socket.io": { target: backend, ws: true },
      },
    },
    plugins: [react()],
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
