# @zhiji-labs/browser-sdk

Browser SDK for Zhiji error monitoring and product analytics.

## Install

```bash
npm install @zhiji-labs/browser-sdk
```

## Quick start

```ts
import { init } from "@zhiji-labs/browser-sdk";

const zhiji = init({
  key: "zj_pk_your_project_key",
  release: "2026.09.12",
});

zhiji.track("pricing_viewed", { plan: "pro" });
```

The SDK sends data to same-origin `/api/ingest/*` endpoints by default. To report directly to a hosted Zhiji deployment, set each endpoint to an absolute HTTPS URL such as `https://zhiji.example.com/api/ingest/events`. Configure the application's exact origin and collection policies in the Zhiji console before use.

## Privacy

The SDK stores a stable anonymous visitor ID in a first-party cookie. Behavior capture, replay, and performance collection remain disabled until explicitly enabled by the project policy and client options. It does not collect form values, complete DOM, or network request bodies.

See the repository [integration guide](https://github.com/earntools-labs/zhiji#sdk-%E4%B8%8E%E9%87%87%E9%9B%86) and [security policy](https://github.com/earntools-labs/zhiji/blob/main/SECURITY.md).
