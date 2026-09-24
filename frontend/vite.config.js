import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        secure: false,
        timeout: 60000,
        proxyTimeout: 60000,
        // Retry briefly when backend is still starting (avoids ECONNREFUSED noise)
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            console.warn("[vite proxy]", err.code || err.message);
            if (res && !res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: "Backend unavailable. Wait a few seconds for the API on :4000, then retry.",
                  code: err.code || "ECONNREFUSED",
                })
              );
            }
          });
        },
      },
    },
  },
});
