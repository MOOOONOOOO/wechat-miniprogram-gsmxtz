const MEDIA_VERSION = "2026-07-26-v3-write";

// 推荐填写微信云开发存储返回的 cloud:// fileID。
// 也支持已加入 downloadFile 合法域名的 HTTPS CDN 地址。
// 视频不进入小程序代码包；小程序启动后会自动下载并持久缓存。
const RAIN_BOX_MEDIA = [
  {
    id: "timeline1",
    source: "cloud://cloud1-d7g2ztvs63d2800d4.636c-cloud1-d7g2ztvs63d2800d4-1434331557/雨水一盒视频/进入页.mp4",
    fileName: "timeline-1.mp4",
    bytes: 0
  },
  {
    id: "timeline2",
    source: "cloud://cloud1-d7g2ztvs63d2800d4.636c-cloud1-d7g2ztvs63d2800d4-1434331557/雨水一盒视频/循环页.mp4",
    fileName: "timeline-2.mp4",
    bytes: 0
  },
  {
    id: "timeline3",
    source: "cloud://cloud1-d7g2ztvs63d2800d4.636c-cloud1-d7g2ztvs63d2800d4-1434331557/雨水一盒视频/信纸页.mp4",
    fileName: "timeline-3.mp4",
    bytes: 0
  },
  {
    id: "timeline4",
    source: "cloud://cloud1-d7g2ztvs63d2800d4.636c-cloud1-d7g2ztvs63d2800d4-1434331557/雨水一盒视频/写信.mp4",
    fileName: "timeline-4.mp4",
    bytes: 0
  }
];

module.exports = {
  MEDIA_VERSION,
  RAIN_BOX_MEDIA
};
