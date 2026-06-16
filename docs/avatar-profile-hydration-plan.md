# 挑战记录头像资料修复方案

## 背景

挑战记录、发起记录详情、多人榜等页面偶尔拿不到朋友头像，主要原因是页面依赖提交当时写入的 `friendProfile.avatarUrl` 快照。这个快照可能是临时地址、空值，或者后续过期不可用。

当前系统已经具备更稳定的身份基础：

- 云函数可通过 `cloud.getWXContext().OPENID` 获取当前微信用户唯一身份。
- 朋友作答时，`submitAnswer` 会写入 `friendOpenId`。
- 发起挑战时，`createChallenge` 会写入 `creatorOpenId`。
- 用户资料保存在 `userProfiles/{openid}`，包含 `profile.nickName` 和 `profile.avatarUrl`。

因此可以用 `openid -> userProfiles/{openid}` 的方式补齐头像昵称。

## 目标

在所有展示挑战参与者、朋友作答记录、多人榜、历史记录的地方，优先展示稳定的用户资料。

资料优先级建议：

1. `userProfiles/{openId}.profile`
2. 作答/挑战记录里的 profile 快照
3. 本地缓存 profile
4. 占位头像和默认昵称

头像优先级建议：

1. cloud file 或稳定远程 URL
2. 记录快照里的稳定 URL
3. 空头像占位

临时地址如 `wxfile://`、`tmp/`、`http://tmp/` 不应作为长期头像保存或展示兜底。

## 需要覆盖的云函数

- `getCreatorInbox`
  - 已经有 `friendOpenId -> userProfiles` 合并逻辑。
  - 后续重点检查是否所有返回入口都使用合并后的 `friendProfile`。

- `getChallengeParticipants`
  - 返回参与者头像墙时，应根据 `friendOpenId` 批量读取 `userProfiles` 并合并。

- `getChallengeMultiplayer`
  - 多人榜参与者、pair 详情参与者，都应 hydrate profile。

- `getRecentSubmission`
  - 参与者看最近提交结果时，应补齐自己的最新 profile。

- `getSharedResult`
  - 分享结果页如展示双方资料，应按 openId 补齐。

## 数据模型现状

`challengeResults` 保存：

- `challengeId`
- `resultId`
- `friendOpenId`
- `creatorOpenId`
- `friendProfile`
- `friendChoices`
- `friendTopSongs`
- `result`
- `expiresAt`

`challenges` 保存：

- `creatorOpenId`
- `creatorProfile`
- `mode`
- `targetCount`
- 挑战题目和发起者答案

`userProfiles/{openid}` 保存：

- `openId`
- `profile.nickName`
- `profile.avatarUrl`
- `updatedAt`

## 实现建议

新增或复用一个云函数侧 helper：

```js
async function readUserProfile(openId, cache) {
  if (!openId) return normalizeProfile();
  const key = `profile:${openId}`;
  if (cache[key]) return cache[key];
  try {
    const res = await db.collection("userProfiles").doc(openId).get();
    cache[key] = normalizeProfile((res.data || {}).profile || res.data || {});
  } catch (error) {
    cache[key] = normalizeProfile();
  }
  return cache[key];
}
```

合并策略：

```js
function mergeProfile(snapshot, saved) {
  return {
    nickName: saved.nickName || snapshot.nickName || "",
    avatarUrl: pickStableAvatar(saved.avatarUrl, snapshot.avatarUrl)
  };
}
```

注意权限：

- 前端不直接按别人的 openid 查询资料。
- 由已有业务云函数在确认用户有查看权限后，在服务端补齐 profile。
- 返回给前端的只应该是 `nickName/avatarUrl`，不需要暴露额外用户资料。

## 兼容老数据

- 老记录如果没有 `friendOpenId`，只能继续使用 `friendProfile` 快照。
- 老记录如果有 `friendOpenId` 但 `userProfiles` 不存在，继续使用快照。
- 已过期并被清理的 `challengeResults` 无法再恢复参与者身份。

## 验收点

- 用户改名换头像后，新提交记录显示新资料。
- 发起人查看朋友作答列表时，能用 `friendOpenId` 补齐头像。
- 多人榜头像墙和 pair 详情头像一致。
- 临时头像 URL 不再长期污染历史记录。
- 没有权限的用户不能通过 openId 任意查询别人资料。
