import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

// Sentry source map upload runs only when all required env vars are present.
// On local dev (or PRs without Sentry secrets) it's a no-op, so the build
// still succeeds.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const release =
  process.env.VITE_SENTRY_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.RENDER_GIT_COMMIT;

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8081,
  },
  plugins: [
    react(),
    sentryAuthToken && sentryOrg && sentryProject
      ? sentryVitePlugin({
          authToken: sentryAuthToken,
          org: sentryOrg,
          project: sentryProject,
          release: release ? { name: release } : undefined,
          telemetry: false,
        })
      : null,
  ].filter(Boolean),
  // Required for the plugin to upload meaningful sources.
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-toast", "@radix-ui/react-tooltip"],
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
}));
