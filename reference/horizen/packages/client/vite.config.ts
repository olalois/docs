import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Create an empty module to stub out React Native deps that MetaMask SDK imports
const emptyModule = path.resolve(__dirname, "src", "empty.ts");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@react-native-async-storage/async-storage": emptyModule,
    },
  },
});
