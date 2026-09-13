# @zhiji/react-native

用于 React Native 的 Zhiji 移动端 TypeScript SDK。它不依赖 React Native
运行时包；应用提供可选的 `fetch` 和受保护的访客 ID 存储即可。当前包不是
Swift/Kotlin 原生 SDK，也不假装提供原生控件自动采集、剪贴板采集或离线持久
化事件队列。

移动 Key 是随应用发布的项目标识，不能当作用户认证凭据。服务端会校验 Key、
登记的平台、application ID 和版本；在接入平台证明前，验证等级恒为
`declaration_only`。

## 初始化

在项目控制台登记 mobile Key、平台、application ID 与允许的版本范围后：

```ts
import { ZhijiMobileClient } from '@zhiji/react-native'

const zhiji = new ZhijiMobileClient({
  key: 'zj_mob_...',
  platform: 'react_native',
  applicationId: 'com.example.app',
  applicationVersion: '1.4.0',
  endpointBaseUrl: 'https://telemetry.example.com',
  // 建议使用受系统保护的 SecureStore/Keychain/Keystore 适配器。
  visitorStorage: secureStorage,
})

// 在首次事件前恢复既有匿名 ID。
await zhiji.ready()
```

`endpointBaseUrl` 必须是没有路径、query、凭据的 HTTPS origin。仅开发环境可
设置 `allowInsecureTransport: true` 使用 HTTP localhost。SDK 固定发送
`POST /api/ingest/mobile/events` 和 `POST /api/ingest/mobile/errors`，并带有
`X-Zhiji-Key`、平台、应用 ID、应用版本声明头。

## API

```ts
zhiji.track('order_created', { plan: 'pro', item_count: 2 })
zhiji.captureException(error, { dist: '42' })
zhiji.capturePerformance({ name: 'screen_ready', value: 180, unit: 'ms' })

// 必须由你的登录服务签发 assertion；接受回执前后续事件不会携带 user ID。
const linked = await zhiji.login('user_123', identityAssertion, { plan: 'pro' })
zhiji.logout() // 清除业务用户关联，但保留同一安装的匿名 visitor ID

// 从 React Native AppState 监听器调用；后台发送只是 best effort。
zhiji.appState('background')
await zhiji.flush()
await zhiji.shutdown()
```

移动端目前没有独立的性能 ingest lane；`capturePerformance` 会发送受限的
`mobile_performance` analytics event，以保持移动端现有的 `{ key, events }`
合同、移动声明校验和 lane Receipt 幂等性。

## 数据与安全边界

- 只持久化随机匿名 `visitor_id`，而且仅通过调用方提供的安全存储接口。
  事件、错误、登录 assertion 与业务用户 ID 都不落盘。
- 队列只在内存中，单 lane 上限为 240 KiB，单批最多 50 条；网络、408、429
  与 5xx 最多保留原 `client_event_id` 重试三次。后台终止可能丢失尚未发送的
  内存事件。
- 属性仅接受有限的 string、number、boolean、string array；密码、token、
  Cookie、认证、邮箱、电话、地址、通知、剪贴板和请求正文等可疑键会被丢弃。
  不要把控件文本、通知正文或自由文本放入事件属性。
- `login` 的 assertion 只进内存请求体，debug 输出不包含 Key、assertion、
  visitor/user ID、属性、错误栈或事件正文。

请求成功后应检查 `accepted`、`duplicate`、`sampled`、`rateLimited` 与
`dropped`。4xx（除 408/429）不会重试；请先检查移动 Key、应用登记信息和
payload 字段。
