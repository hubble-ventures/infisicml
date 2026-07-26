import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // Source imports use explicit `.js` specifiers (NodeNext). Let Vitest resolve
    // them back to the `.ts` sources when running tests.
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
});
