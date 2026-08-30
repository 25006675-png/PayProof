import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "sui-vendor",
              test: /node_modules[\\/]@mysten/,
              maxSize: 280_000,
              priority: 30,
            },
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|scheduler|@tanstack)/,
              maxSize: 220_000,
              priority: 20,
            },
            {
              name: "vendor",
              test: /node_modules/,
              maxSize: 240_000,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
