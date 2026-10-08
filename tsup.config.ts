import { defineConfig } from 'tsup'

export default defineConfig({
  // `agent.js` is a separate entry because the office spawns it directly as a
  // worker executable, not as an OpenFox plugin entry point.
  entry: ['src/index.ts', 'src/agent.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['openfox'],
})