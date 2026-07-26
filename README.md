# 歌手默契挑战微信小程序 正式版本

这是从当前 H5 原型迁移出来的微信小程序工程骨架。

## 协作原则

- 未经用户明确确认，不得擅自改动代码。
- 新增功能时优先复用现有页面、样式、模式、工具函数和云端链路，避免重复实现同类能力。

## 目录

- `miniprogram/`：小程序前端页面
- `cloudfunctions/itunesSearch`：iTunes Search API 代理，搜索歌手、专辑和最多 49 首歌曲
- `cloudfunctions/createChallenge`：创建挑战
- `cloudfunctions/getChallenge`：通过 `challengeId` 读取挑战
- `cloudfunctions/submitAnswer`：好友提交答案并按歌手粒度计算契合度
- `cloudfunctions/getRecentSubmission`：读取当前用户 3 天内的提交结果，并清理过期提交
- `cloudfunctions/getChallengeParticipants`：读取某个挑战已提交朋友的头像昵称，用于邀请页多人头像墙
- `cloudfunctions/getChallengeMultiplayer`：读取歌手/专辑/Top9 挑战的多人同频榜和两两对比结果
- `cloudfunctions/getCreatorInbox`：读取发起者 3 天内收到的朋友提交结果，兼容旧收件中转
- `cloudfunctions/publishSharedResult`：用户触发分享后，把三天结果缓存标记为公开可读
- `cloudfunctions/getSharedResult`：通过公开 `resultId` 读取朋友圈/好友分享结果
- `cloudfunctions/getMiniProgramCode`：生成挑战页或首页小程序码，供海报/保存图使用
- `cloudfunctions/cleanupExpiredSubmissions`：每 30 分钟定时清理过期提交和发起者中转收件

## 云数据库集合

需要创建这些集合：

- `challenges`
- `submissions`
- `creatorInboxes`
- `userProfiles`
- `artistCoverCache`
- `coverAssetCache`
- `artistSongListCache`
- `albumSongListCache`
- `announcements`
- `feedbacks`
- `themeCovers`
- `challengeResults`

### `announcements` 用法

更新公告和首页弹窗共用 `announcements` 集合。

- 普通更新公告：`title`、`content`、`version`、`publishedAt`、`priority`、`hidden`
- 首页弹窗公告：在普通公告字段基础上加 `popup: true`
- 可选弹窗字段：`popupId`、`buttonText`
- `popup: true` 的记录只用于首页弹窗，默认不显示在“更新公告”列表里
- `hidden: true` 会同时从首页弹窗和“更新公告”列表里隐藏
- 每个账号只会看到同一个 `popupId`/记录 `_id` 一次；新增弹窗或更换 `popupId` 后会重新弹出
- `content` 支持换行，前端会按换行逐行渲染

示例：

```json
{
  "title": "更新公告",
  "content": "第一行\n第二行",
  "version": "v0.2.0",
  "popup": true,
  "popupId": "v0.2.0-popup",
  "buttonText": "知道了",
  "priority": 10,
  "hidden": false,
  "publishedAt": "2026-06-02T12:00:00+08:00"
}
```

## 开发者工具接入

1. 用微信开发者工具导入 `wechat-miniprogram`。
2. 如果只是用测试号预览，`miniprogram/app.js` 里的 `globalData.envId` 可以先留空。
3. 测试号预览时，在开发者工具详情里勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」，这样前端可以直接请求 iTunes。
4. 如果要用云开发，换成正式小程序 AppID，修改 `globalData.envId` 为你的云开发环境 ID。
5. 上传并部署 `cloudfunctions/` 下的云函数。
6. 确认云函数可以访问 `https://itunes.apple.com`。

## 测试号模式

测试号不能使用微信云开发时，工程会自动进入本地调试模式：

- iTunes 搜索优先请求本机开发代理：`http://127.0.0.1:8788/itunes`。
- 启动代理：在项目根目录运行 `node dev-proxy.js`。
- `challengeId` 会保存到本机 storage。
- 「模拟好友打开」可以完整跑通。
- 真正发给另一台手机时无法读取本机 storage，所以正式分享仍需要云开发。

## 当前状态

- 发起人选择 9 位歌手。
- 每位歌手默认从 iTunes 拉最多 49 首歌。
- 歌曲搜索会用「歌手名 + 关键词」重新拉最多 49 首结果。
- 测试号模式下如果 iTunes 请求失败或返回空结果，会显示本地兜底曲库，保证选歌流程可用。
- 创建挑战后生成 `challengeId`。
- 分享路径进入 `/pages/friend/friend?challengeId=...`。
- 好友作答后按歌手粒度计算契合度；同一个挑战最多支持 99 位不同朋友提交，同一朋友重复提交会覆盖自己的结果。
- 邀请页在已有 2 位及以上朋友提交后，会显示「已加入挑战的人」头像墙；头像墙只展示已提交的朋友，不包含发起人。
- 歌手默契、专辑默契、同担 Top9 支持多人同频 MVP：参与者结果页展示“你和大家的同频排行”，发起记录页在 2 位及以上朋友提交后展示“全场最佳拍档”和“全场默契榜”，并可点进任意两人的单独对比。颜色推歌、歌单问答、人生九专、心形专辑暂不进入多人榜。
- 多人同频前端可用本地 mock 预览，不依赖云函数或数据库。结果页：`/pages/result/result?mock=multiplayer&mode=artist`；发起记录页：`/pages/challenge-results/challenge-results?mock=multiplayer&mode=artist`。`mode` 可换成 `album` 或 `top9`。
- 好友结果会永久保存到本机 storage；云端 `challengeResults` 保留 3 天，默认 `private`，用户分享到好友/群聊/朋友圈时由 `publishSharedResult` 标为 `public`，公开链接通过 `getSharedResult` 读取。旧中转集合 `submissions`、`creatorInboxes` 仍用于兼容读取，并会在提交/读取时及定时云函数中清理过期记录。
- 「我发起/参与的」展示本机保存的历史；小程序切回前台、进入首页、进入历史页、点击历史页刷新按钮时会同步发起者收到的朋友提交，不做常驻轮询。
- 海报页和聊天分享卡片已接 Canvas 导出图片；颜色结果保存会进入海报页，颜色海报使用首页小程序码。海报保存优先调用 `wx.showShareImageMenu`，让用户在系统菜单里选择保存/分享，失败时回退保存相册。普通/专辑/颜色结果海报保持固定封面尺寸，按每行文字实际高度自适应排版，长文本最多两行并省略。
- 主题推歌包含心形专辑挑战、人生九专、歌单问答；歌单问答支持“自己先填”和“只让朋友填”，后者结果展示为九宫格。
- 心形专辑、人生九专、歌单问答九宫格保存图会嵌入指向首页的小程序码；心形图只画码，不额外加扫码文案。保存图 Canvas 的文字函数需要显式设置颜色和字号，避免被头像兜底、二维码白底等绘制状态污染；二维码缺失时只留白底，不画假码兜底。
- 人生九专页面支持右上角分享给好友和分享到朋友圈；填好的九宫格仍建议通过“保存图片”的系统图片菜单分享。
- 颜色推歌创建页的“仅保存图片”仍在当前页绘制九宫格，但已补首页小程序码、底部文案、长文本省略和 `wx.showShareImageMenu`。
- 同担 Top9 海报页走 `poster` 页面生成；Canvas 里的长歌名使用省略号截断，防止越过卡片边界。
- 首页支持从 `announcements` 读取一次性更新弹窗；新用户会先填写资料，再看到弹窗。
- 单人模式「决战歌曲之巅」支持从一位歌手的 16/32 首歌曲中决选：首轮每组 4 首留下 2 首，之后两两淘汰，直到只剩唯一结果；进度与完成记录仅保存在当前设备。
- 决选结果使用单张分享海报呈现，完整展示 16/32 首歌曲从首轮到冠军的全部封面节点和晋级连线，冠军路径以现有墨绿主题色高亮；不再展示横向表格。聊天分享卡片使用冠军缩略图，并把好友带到正式的“决战歌曲之巅”创建流程；本地比赛数据仍不公开。
- 开发者工具控制台可运行 `getApp().openTournamentMock(16)` 或 `getApp().openTournamentMock(32)`：命令会从正式歌曲接口读取林俊杰曲目，使用正式赛事逻辑生成并保存记录，再打开正式结果页。
- 开发者工具控制台可运行 `getApp().openTreeMock()`：命令会填满圣诞树发起者左侧，点击创建后仍调用正式云函数生成挑战，好友可通过真实 `challengeId` 填写右侧。圣诞树完成结果会从双方歌曲中随机抽取 3 张不重复封面填入 5:4 分享缩略图，再开放聊天与朋友圈分享。
