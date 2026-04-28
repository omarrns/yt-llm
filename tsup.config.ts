import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    target: "node20",
    splitting: false,
    shims: false,
  },
  {
    entry: { cli: "src/cli.ts", mcp: "src/mcp/server.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    target: "node20",
    splitting: false,
    shims: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
