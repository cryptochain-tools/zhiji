# @zhiji-labs/browser-sdk

Browser SDK for Zhiji error monitoring and product analytics.

## Install

```bash
npm install @zhiji-labs/browser-sdk
```

## Quick start

```ts
import { initFromConfig } from "@zhiji-labs/browser-sdk";

const zhiji = await initFromConfig({
  key: "zj_pk_your_project_key",
  // Required when Zhiji is hosted on another origin. It is used for both the
  // public policy request and the default ingest endpoints.
  origin: "https://zhiji.example.com",
  release: "2026.09.12",
  performance: true,
});

zhiji.track("pricing_viewed", { plan: "pro" });
```

`initFromConfig` requests the public `{ data, meta }` policy from `/api/sdk/config` using the browser key. It derives page privacy rules and behavior policy from that response, and rejects failed or malformed responses. When `origin` is set, all default `/api/ingest/*` endpoints use that same HTTPS origin; explicit endpoint overrides are still supported. Cross-origin browsers supply the calling application's `Origin`; same-origin requests are checked against their request target. That exact origin must be allowed in the Zhiji console.

`init(options)` remains available when an application already manages its policy loading itself.

## Behavior capture and privacy

The SDK stores a stable anonymous visitor ID in a first-party cookie. Behavior capture, replay, and performance collection remain disabled until explicitly enabled by the project policy and client options. On allowed pages, behavior capture automatically aggregates ordinary click coordinates for heatmaps. It does not collect DOM, page text, form values, complete HTML, or network request bodies. Configure `block_selectors` in the project policy to exclude sensitive regions.

`data-zj-track-id` is optional for stable identification of configured key elements. It is required for `submit` and `change` interactions; never place names, email addresses, order IDs, or free text in a track ID.

```html
<button data-zj-track-id="signup-submit">Create account</button>
```

See the repository [integration guide](https://github.com/earntools-labs/zhiji#sdk-%E4%B8%8E%E9%87%87%E9%9B%86) and [security policy](https://github.com/earntools-labs/zhiji/blob/main/SECURITY.md).
