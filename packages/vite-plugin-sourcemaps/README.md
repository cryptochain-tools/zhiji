# @zhiji-labs/vite-plugin-sourcemaps

Vite build plugin for uploading private Source Maps to Zhiji. It removes
`sourcesContent`, uploads maps with a dedicated `sourcemap_upload` key, and
removes every `.map` file from the public output bundle after successful upload.

```bash
npm install --save-dev @zhiji-labs/vite-plugin-sourcemaps
```

```ts
import { defineConfig } from "vite";
import { zhijiSourceMaps } from "@zhiji-labs/vite-plugin-sourcemaps";

export default defineConfig({
  build: { sourcemap: "hidden" },
  plugins: [
    zhijiSourceMaps({
      enabled: true,
      endpoint: "https://zhiji.example.com/api/sourcemaps/upload",
      key: process.env.ZHIJI_SOURCEMAP_KEY,
      release: process.env.RELEASE_SHA,
      publicBasePath: "/",
    }),
  ],
});
```

The upload key is a build secret. Never use a `VITE_*` variable or expose it in
the browser bundle. Enabled uploads fail the build if validation or upload fails.
