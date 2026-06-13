import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/.sloop/**"]
    },
    proxy: {
      "/api": "http://127.0.0.1:4873"
    }
  },
  test: {
    globals: true,
    environment: "node"
  }
});
