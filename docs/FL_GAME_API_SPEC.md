# FL 游戏端 API 对接需求

> **目标**：让玩家在 fl-platform 上架物品 / 查看金币 / 转账时，能直接调游戏服的接口，而不是手动输入。
>
> **对接方式**：HTTPS REST JSON，走游戏服对外的 Web 网关（FLWebSubsystem 同款路径即可）。
> 不建议用 protobuf — 浏览器/App 调用成本高，JSON 足够。

---

## 鉴权 (Auth)

### 设计原则

玩家已经在平台登录（CloudBase session），平台**没有游戏账号密码**，所以需要一个桥接机制：

```
平台 ──[CloudBase uid + ticket]──► 游戏服 ──► 返回 game_token (短时效 JWT)
平台 ──[带 game_token 调游戏 API]──► 游戏服
```

### API: `POST /fl/auth/bind_platform`

**用途**：玩家首次从平台调游戏接口时，平台换取 game_token。

```http
POST https://game-api.forgottenland.cn/fl/auth/bind_platform
Content-Type: application/json

{
  "platform": "fl_platform",
  "platform_uid": "xxxxxx-cloudbase-uid",
  "platform_ticket": "xxxxxxxxxxxxx",
  "signature": "HMAC_SHA256(body, SHARED_SECRET)"
}
```

**响应**：
```json
{
  "ok": true,
  "game_token": "eyJhbGciOi...",   // JWT，默认有效期 2h
  "game_uid": 12345678,            // 游戏内 player_id
  "character_name": "Alice",
  "expires_at": 1698765432
}
```

**游戏服侧要做**：
- 校验 `signature`（避免伪造请求）
- 查 `platform_uid` 是否已绑定过游戏账号：
  - 已绑定 → 直接返 token
  - 未绑定 → 返 `{ok: false, error: "NOT_BOUND", bind_url: "https://game-api/bind?ticket=xxx"}`，平台引导玩家去游戏里绑定（一次性流程）

---

## 玩家基本数据

### `GET /fl/player/me`

```http
GET https://game-api.forgottenland.cn/fl/player/me
Authorization: Bearer eyJhbGciOi...
```

**响应**：
```json
{
  "game_uid": 12345678,
  "character_name": "Alice",
  "level": 45,
  "career": "knight",           // EFLCareerType: knight / mage / ranger / ...
  "gold": 152340,                // 金币
  "last_online_at": 1698765000
}
```

---

## 背包 / 仓库 (Inventory)

### `GET /fl/inventory/list`

**查询参数**：
- `scope` = `raid`（局内背包）/ `lobby`（大厅仓库 / 库存）/ `all`
- `category` = `weapon` / `armor` / `potion` / `material` / `misc`（可选）
- `page` / `size`（分页）

**响应**：
```json
{
  "items": [
    {
      "item_id": "itm_8f3a9b",   // 背包内唯一 id
      "item_def_id": "sword_001", // 物品模板 id（对应 DT_FL_EquipMeta 表）
      "name": "晨曦之刃",
      "rarity": "epic",
      "level": 42,
      "class": "武器",             // 对应 DT_FL_EquipMeta.EquipClass
      "stack": 1,
      "durability_cur": 80,
      "durability_max": 100,
      "implicits": [               // 固有词条
        { "name": "力量", "value": 15 }
      ],
      "rolled_affixes": [          // DA_FL_AffixPool 中 roll 出来的词条
        { "name": "+45 力量", "rarity": "epic" },
        { "name": "暴击率 +12%", "rarity": "rare" },
        { "name": "吸血 8%", "rarity": "rare" }
      ],
      "locked": false,              // 玩家手动锁定的物品不能交易
      "soulbound": false            // true = 绑定物品，永远不能交易
    }
  ],
  "total": 42,
  "page": 1,
  "size": 20
}
```

---

## 发起交易 / 上架

### `POST /fl/trade/list_item`

**用途**：从背包拿出物品，托管到游戏服的"交易仓库"，同时通知平台生成挂单。

```json
{
  "item_id": "itm_8f3a9b",
  "price": 15000,
  "listing_id": "trade_listings_xxx",  // 平台 CloudBase 挂单 id，回传后游戏服记录
  "expires_in_seconds": 1209600        // 14 天
}
```

**响应**：
```json
{
  "ok": true,
  "escrow_id": "esc_xxxxx",            // 游戏服托管凭证
  "locked_at": 1698765000
}
```

**游戏服侧要做**：
- 从玩家背包中**锁定/移走**该物品 → 移到"交易托管仓库"
- 返回 escrow_id，平台把它写回 CloudBase `trade_listings.escrow_id`
- 到期 / 下架时释放回玩家背包

### `POST /fl/trade/cancel_listing`

```json
{ "escrow_id": "esc_xxxxx" }
```
→ 游戏服把托管物品还回玩家背包。

### `POST /fl/trade/complete_transaction`

**用途**：买家付款完成后，平台通知游戏服：把物品转给买家 + 把金币转给卖家。

```json
{
  "escrow_id": "esc_xxxxx",
  "buyer_game_uid": 99999,
  "seller_game_uid": 12345678,
  "price": 15000,
  "fee_percent": 5                      // 平台税，比如 5%
}
```

**响应**：
```json
{
  "ok": true,
  "item_sent_to_buyer": true,
  "gold_sent_to_seller": 14250,        // 扣税后
  "fee_collected": 750
}
```

---

## 金币转账（好友/公会间）

### `POST /fl/gold/transfer`

```json
{
  "to_game_uid": 99999,
  "amount": 5000,
  "memo": "欠你那顿饭"
}
```

**响应**：
```json
{ "ok": true, "transaction_id": "tx_xxxxx" }
```

- 单日上限可走 L2 / L3 认证梯度（未绑手机号 → 禁止；未实名 → 单日 5k；实名 → 无限）

---

## 推送事件 (Webhook Game → Platform)

### 游戏服**主动回调**平台 CloudBase 云函数

#### 场景 1：物品卖出 → 推送通知

```http
POST https://xxx-1-abc.ap-shanghai.service.tcloudbase.com/trade_sold_webhook
Content-Type: application/json
X-FL-Signature: HMAC_SHA256(body, WEBHOOK_SECRET)

{
  "event": "trade_sold",
  "listing_id": "trade_listings_xxx",
  "seller_platform_uid": "xxxxxx-cloudbase-uid",
  "buyer_character_name": "Bob",
  "item_name": "晨曦之刃",
  "price": 15000,
  "sold_at": 1698765000
}
```

平台云函数：
- 校验签名
- 更新 `trade_listings` 的 `status = sold`
- 往 `notifications` 集合插一条 → 推送到卖家 App

#### 场景 2：玩家金币变化（大额转账到账）

```http
POST /gold_received_webhook
{
  "event": "gold_received",
  "player_platform_uid": "xxx",
  "amount": 5000,
  "from_character": "Alice",
  "received_at": 1698765000
}
```

---

## 技术要求汇总

### 平台侧提供给游戏服的

| 项 | 值 |
|---|---|
| **CloudBase 环境 ID** | `fl-platform-d9ggvxhq738a2a52a` |
| **Webhook 基础 URL** | CloudBase 云函数触发 URL（后期我来部署）|
| **HMAC 签名 SECRET** | 生成一个 32 位随机串，两边各存一份 |
| **CloudBase 自定义登录私钥** | 用于游戏服给玩家签发 CloudBase ticket（如果后期做自动登录）|

### 游戏服侧需要提供的

| 项 | 值 |
|---|---|
| **API 基础 URL** | 如 `https://game-api.forgottenland.cn/fl` |
| **API 版本** | `v1` |
| **SHARED_SECRET** | HMAC 共享密钥，跟平台那份对齐 |
| **文档** | 建议用 OpenAPI / Swagger 自动生成，或至少给我一个 Postman collection |

---

## 实施顺序建议

1. **阶段 A（最小可行）**：只做 `/auth/bind_platform` + `/player/me` + `/inventory/list`。
   平台在上架物品时弹"从游戏背包选货"弹窗，玩家选好后仍然手动填价格。
2. **阶段 B**：加 `/trade/list_item` + `/trade/complete_transaction`。
   真正实现游戏-平台原子化交易（避免双花）。
3. **阶段 C**：加 Webhook + 推送通知。
4. **阶段 D**：`/gold/transfer` + L2/L3 认证分级。

---

## 开放问题（需要你 / 游戏服团队回答）

1. FLWebSubsystem 的 protobuf 协议用不用扩展？还是另起一套 JSON HTTP？
2. 游戏服的"交易托管仓库"机制现在有吗？没有的话得单独做。
3. 玩家是否需要两边绑定一次才能用？（推荐这样，否则伪造 `platform_uid` 就能偷别人金币）
4. 游戏服部署在哪？（域名、SSL 证书、ICP 备案状态？）
5. 税率、单日上限、交易手续费等经济参数，定了吗？

---

## 对接流程

1. **你**：给 FL 游戏服开发组看这个文档，约定协议
2. **你**：给我 API 基础 URL + SHARED_SECRET + 测试账号
3. **我**：在 fl-platform 里写一个 `src/lib/fl-game-api.ts` 客户端
4. **我**：改 `TradeMarketView` 上架流程，加"从游戏背包选货"按钮
5. **我**：写 CloudBase 云函数做 Webhook 接收端
6. **联调**：游戏服在测试环境发几单，平台收到事件并正确处理
