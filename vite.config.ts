import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import {
  BuildEnvironment,
  resolveSentryUpload,
} from "./sentryBuildConfig";

function createViteConfig(env: BuildEnvironment) {
  const sentryUpload = resolveSentryUpload(env);

  return {
    server: {
      host: "::",
      port: 8081,
    },
    plugins: [
      react(),
      ...(sentryUpload
        ? [
            sentryVitePlugin({
              authToken: sentryUpload.authToken,
              org: sentryUpload.org,
              project: sentryUpload.project,
              release: { name: sentryUpload.release },
              sourcemaps: {
                filesToDeleteAfterUpload:
                  sentryUpload.filesToDeleteAfterUpload,
              },
              telemetry: false,
            }),
          ]
        : []),
    ],
    build: {
      sourcemap: sentryUpload?.sourceMap ?? false,
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
}

export default defineConfig(() => createViteConfig(process.env));
