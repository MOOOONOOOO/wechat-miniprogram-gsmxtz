# 2026-05-22 缓存优化版本说明

这个版本主要围绕降低 iTunes Search 云函数调用、复用云数据库缓存、改善好友答题时的默认歌曲列表加载速度展开。

## 新增能力

### 1. iTunes 元数据字段透传

`cloudfunctions/itunesSearch` 的歌曲和专辑结果新增透传字段：

- `artistId`
- `collectionId`
- `collectionName`
- `artworkUrl100`
- `artworkUrl600`
- `trackName`

这些字段用于把歌手头像、专辑封面、歌曲封面统一关联到 iTunes 原始 ID 上。

### 2. 歌手头像与封面资产缓存

新增前端缓存工具：

- `miniprogram/utils/itunesCache.js`

新增云数据库集合：

- `artistCoverCache`
- `coverAssetCache`

缓存逻辑：

- 歌手头像优先读取本机缓存。
- 本机没有时，前端直读云数据库 `artistCoverCache`。
- 云端没有时，继续走现有 `itunesSearch` 补头像。
- iTunes 返回歌曲或专辑结果后，会按原始字段沉淀封面资产。
- `coverAssetCache` 使用 `collectionId` 作为 `_id`。
- `artistCoverCache` 使用 `artistId` 作为 `_id`。
- 已存在的数据不会重复新增。

### 3. 默认歌曲列表缓存

新增云数据库集合：

- `artistSongListCache`
- `albumSongListCache`

用于缓存进入选歌页时默认展示的歌曲列表。

缓存范围：

- 缓存歌手默认列表：`searchSongs(artist, "")`
- 缓存专辑默认列表：`searchAlbumSongs(collectionId, "")`
- 不缓存用户输入关键词后的搜索结果列表

加载逻辑：

- 进入选歌页且搜索框为空时，先查本地默认歌曲列表缓存。
- 本地没有时，查云数据库。
- 给数据库缓存 250ms 抢跑时间。
- 250ms 内命中就直接显示缓存歌曲列表。
- 250ms 内没有命中或没有返回，就走 `itunesSearch`。
- iTunes 返回后显示歌曲列表，并写入本地和云数据库缓存。

### 4. 关键词搜索策略

用户输入关键词后的歌曲搜索仍然走 iTunes Search。

不会缓存整份关键词搜索结果列表，例如：

- 不缓存 `孙燕姿 + 遇见`
- 不缓存 `周杰伦 + 晴天`

但关键词搜索返回的歌曲里，如果包含新的 `collectionId`、`artistId` 和封面 URL，仍会参与封面资产沉淀。

### 5. 分享图保底逻辑保留

分享页生成缩略图时，如果体验版无法下载 Apple 封面图，仍然保留原有保底逻辑：

- 封面图不可绘制时，使用第一张封面 URL 作为保底分享图。

同时建议在微信公众平台配置 Apple 封面下载合法域名，减少体验版触发保底的概率。

## 需要部署或配置

### 云函数

需要重新上传并部署：

- `cloudfunctions/itunesSearch`

原因：这个云函数新增了 `artistId`、`collectionId` 等字段透传。

### 云数据库集合

需要确认存在以下集合：

- `challenges`
- `submissions`
- `creatorInboxes`
- `artistCoverCache`
- `coverAssetCache`
- `artistSongListCache`
- `albumSongListCache`

### 小程序合法域名

如果体验版分享图经常触发保底，需要在微信公众平台配置 `downloadFile合法域名`：

- `https://is1-ssl.mzstatic.com`
- `https://is2-ssl.mzstatic.com`
- `https://is3-ssl.mzstatic.com`
- `https://is4-ssl.mzstatic.com`
- `https://is5-ssl.mzstatic.com`

多个域名用英文分号分隔。

## 主要改动文件

- `cloudfunctions/itunesSearch/index.js`
- `miniprogram/utils/itunesCache.js`
- `miniprogram/utils/api.js`
- `miniprogram/pages/artists/artists.js`
- `miniprogram/pages/songs/songs.js`
- `miniprogram/pages/share/share.js`
- `README.md`

## 行为边界

- 默认歌曲列表缓存只服务空搜索，不服务关键词搜索。
- 250ms 是缓存抢跑窗口，不是强制等待完整数据库结果。
- 预设歌手没有 `artistId` 时，会尝试从 `artistCoverCache` 解析；仍无法解析时，第一次会走 iTunes，返回后再按 iTunes 原始 `artistId` 写入缓存。
- 分享图保底仍保留，避免体验版因远程图片不可绘制导致分享按钮不可用。
