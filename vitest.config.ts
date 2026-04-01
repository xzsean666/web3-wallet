import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
    globals: true,
    include: ["src/**/*.spec.ts"],
  },
});
