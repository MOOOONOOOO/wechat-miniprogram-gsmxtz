const { getMiniProgramCode } = require("../../utils/api");
const { imageShareMethods } = require("../../utils/imageShare");
const { resolveCloudFileUrl } = require("../../utils/profile");
const {
  clearActiveTournament,
  deriveTournament,
  getSongName,
  getTournamentRecord
} = require("../../utils/songTournament");
const {
  POSTER_WIDTH,
  buildPosterGraph
} = require("../../utils/tournamentPoster");

const EXPORT_WIDTH = 1080;
const EXPORT_SCALE = EXPORT_WIDTH / POSTER_WIDTH;
const EXPORT_HEIGHT = Math.round(1050 * EXPORT_SCALE);
const SHARE_WIDTH = 500;
const SHARE_HEIGHT = 400;
const COVER_LOAD_CONCURRENCY = 6;

function setCanvasFont(ctx, size, bold = false, family = "serif") {
  ctx.setFontSize(size);
  try {
    const fontFamily = family === "sans" ? "sans-serif" : "serif";
    ctx.font = `${bold ? "bold " : ""}${size}px ${fontFamily}`;
  } catch (error) {}
}

function clipText(ctx, value, maxWidth) {
  const text = String(value || "");
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

function drawRoundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCover(ctx, image, fallbackText, x, y, size, highlighted = false) {
  ctx.save();
  drawRoundRectPath(ctx, x, y, size, size, Math.max(3, size * 0.06));
  ctx.setFillStyle("#e8dfd2");
  ctx.fill();
  ctx.clip();
  if (image && image.path) {
    ctx.drawImage(image.path, x, y, size, size);
  } else {
    ctx.setFillStyle("#171512");
    ctx.fillRect(x, y, size, size);
    ctx.setFillStyle("rgba(247,240,223,0.82)");
    setCanvasFont(ctx, Math.max(11, size * 0.34), true);
    ctx.setTextAlign("center");
    ctx.setTextBaseline("middle");
    ctx.fillText(String(fallbackText || "音").slice(0, 1), x + size / 2, y + size / 2);
  }
  ctx.restore();
  ctx.save();
  drawRoundRectPath(ctx, x, y, size, size, Math.max(3, size * 0.06));
  ctx.setStrokeStyle(highlighted ? "#3d7f5a" : "rgba(23,21,18,0.28)");
  ctx.setLineWidth(highlighted ? Math.max(1.6, size * 0.025) : Math.max(0.8, size * 0.012));
  ctx.stroke();
  ctx.restore();
}

function drawRouteNode(ctx, node, image) {
  const width = scaled(node.width);
  const height = scaled(node.height);
  const x = scaled(node.x) - width / 2;
  const y = scaled(node.y) - height / 2;
  const padding = scaled(4);
  const thumbSize = scaled(node.thumbSize);
  const highlighted = node.highlighted === true;

  ctx.save();
  if (ctx.setGlobalAlpha) ctx.setGlobalAlpha(1);
  drawRoundRectPath(ctx, x, y, width, height, scaled(6));
  ctx.setFillStyle(highlighted ? "#e3efd8" : "#fffdfa");
  ctx.fill();
  ctx.setStrokeStyle(highlighted ? "#3d7f5a" : "#cfc9c0");
  ctx.setLineWidth(highlighted ? 2 : 1);
  ctx.stroke();
  ctx.restore();

  const thumbX = x + padding;
  const thumbY = y + (height - thumbSize) / 2;
  drawCover(ctx, image, node.fallbackText, thumbX, thumbY, thumbSize, false);

  ctx.save();
  if (ctx.setGlobalAlpha) ctx.setGlobalAlpha(1);
  setCanvasFont(ctx, Math.max(11, scaled(node.fontSize)), true, "sans");
  ctx.setFillStyle(highlighted ? "#1f6f42" : "#171512");
  ctx.setTextAlign("left");
  ctx.setTextBaseline("middle");
  const textX = thumbX + thumbSize + scaled(5);
  const maxWidth = Math.max(10, x + width - padding - textX);
  ctx.fillText(clipText(ctx, node.name, maxWidth), textX, y + height / 2);
  ctx.restore();
}

function readImageInfo(src) {
  if (!src) return Promise.resolve(null);
  const getInfo = (imageSrc) => new Promise((resolve) => {
    wx.getImageInfo({
      src: imageSrc,
      success: resolve,
      fail: () => resolve(null)
    });
  });
  if (String(src).indexOf("cloud://") === 0 && wx.cloud && wx.cloud.downloadFile) {
    return wx.cloud.downloadFile({ fileID: src })
      .then((res) => getInfo(res.tempFilePath || ""))
      .catch(() => null);
  }
  return getInfo(src);
}

function loadImageMap(sources) {
  const uniqueSources = [...new Set((sources || []).filter(Boolean))];
  const images = {};
  let cursor = 0;
  const worker = () => {
    const source = uniqueSources[cursor];
    cursor += 1;
    if (!source) return Promise.resolve();
    return readImageInfo(source)
      .then((image) => {
        images[source] = image;
      })
      .then(worker);
  };
  const workerCount = Math.min(COVER_LOAD_CONCURRENCY, uniqueSources.length);
  return Promise.all(Array.from({ length: workerCount }, worker)).then(() => images);
}

function finalistLabels(graph) {
  return (graph.finalSongs || []).map((item) => ({
    key: `${item.id}-label`,
    style: [
      `left:${Math.round(item.x - 52)}rpx`,
      `top:${Math.round(item.y + item.height / 2 + 8)}rpx`,
      "width:104rpx"
    ].join(";")
  }));
}

function scaled(value) {
  return value * EXPORT_SCALE;
}

Page({
  data: {
    invalid: false,
    tournamentId: "",
    artistName: "",
    size: 16,
    championName: "",
    championAlbum: "",
    championCover: "",
    championFallback: "音",
    posterNodes: [],
    posterEdges: [],
    finalistLabels: [],
    qrUrl: "",
    savingPoster: false,
    shareImageLoading: true,
    shareImageUrl: "",
    posterPreviewUrl: "",
    posterPreviewLoading: true,
    posterCanvasWidth: EXPORT_WIDTH,
    posterCanvasHeight: EXPORT_HEIGHT,
    shareCanvasWidth: SHARE_WIDTH,
    shareCanvasHeight: SHARE_HEIGHT
  },

  onLoad(options = {}) {
    if (options.fromShare === "1" && !options.id) {
      wx.redirectTo({ url: "/pages/artists/artists?mode=songTournament&fromShare=1" });
      return;
    }
    const id = options.id ? decodeURIComponent(options.id) : "";
    const record = getTournamentRecord(id);
    const derived = record ? deriveTournament(record) : null;
    if (!record || !derived || !derived.valid || !derived.complete) {
      this.setData({ invalid: true });
      return;
    }
    this.record = record;
    this.derived = derived;
    this.posterGraph = buildPosterGraph(record, derived);
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.loadHomeQrCode();
    this.setData({
      tournamentId: record.id,
      artistName: (record.artist || {}).name || "",
      size: record.size,
      championName: this.posterGraph.champion.name,
      championAlbum: this.posterGraph.champion.album,
      championCover: this.posterGraph.champion.cover,
      championFallback: this.posterGraph.champion.fallbackText,
      posterNodes: this.posterGraph.nodes,
      posterEdges: this.posterGraph.edges,
      finalistLabels: finalistLabels(this.posterGraph)
    }, () => {
      this.prepareShareThumbnail();
      this.preparePosterPreview().catch(() => {});
    });
  },

  ...imageShareMethods,

  loadHomeQrCode() {
    this.qrUrlPromise = getMiniProgramCode({ page: "pages/home/home" })
      .then((res) => resolveCloudFileUrl(res.fileID || res.tempFileURL || ""))
      .catch(() => "");
    this.qrUrlPromise.then((qrUrl) => {
      this.qrUrl = qrUrl;
      if (qrUrl) this.setData({ qrUrl });
      return qrUrl;
    });
    return this.qrUrlPromise;
  },

  onPosterCoverError(event) {
    const failedCover = event.currentTarget.dataset.cover || "";
    if (!failedCover) return;
    const updates = {
      posterNodes: this.data.posterNodes.map((node) => (
        node.cover === failedCover ? { ...node, cover: "" } : node
      ))
    };
    if (this.data.championCover === failedCover) updates.championCover = "";
    this.setData(updates);
  },

  onQrError() {
    this.qrUrl = "";
    this.setData({ qrUrl: "" });
  },

  replay() {
    clearActiveTournament();
    getApp().globalData.songTournamentArtist = this.record.artist;
    wx.redirectTo({ url: "/pages/tournament-setup/tournament-setup" });
  },

  goHome() {
    wx.reLaunch({ url: "/pages/home/home" });
  },

  exportCanvas() {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvasId: "tournamentPosterCanvas",
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
        destWidth: EXPORT_WIDTH,
        destHeight: EXPORT_HEIGHT,
        fileType: "png",
        quality: 1,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      }, this);
    });
  },

  exportShareCanvas() {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvasId: "tournamentShareCanvas",
        width: SHARE_WIDTH,
        height: SHARE_HEIGHT,
        destWidth: 1000,
        destHeight: 800,
        fileType: "jpg",
        quality: 0.92,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      }, this);
    });
  },

  prepareShareThumbnail() {
    if (this.shareThumbnailPromise) return this.shareThumbnailPromise;
    this.setData({ shareImageLoading: true });
    this.shareThumbnailPromise = this.drawShareThumbnail()
      .catch(() => this.data.championCover || "")
      .then((shareImageUrl) => {
        this.setData({
          shareImageLoading: false,
          shareImageUrl
        });
        if (wx.showShareMenu) {
          wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
        }
        return shareImageUrl;
      });
    return this.shareThumbnailPromise;
  },

  drawShareThumbnail() {
    const champion = this.posterGraph.champion;
    return readImageInfo(champion.cover).then((coverImage) => new Promise((resolve, reject) => {
      const ctx = wx.createCanvasContext("tournamentShareCanvas", this);
      const background = ctx.createLinearGradient(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
      background.addColorStop(0, "#fffdfa");
      background.addColorStop(1, "#eee5d9");
      ctx.setFillStyle(background);
      ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);

      ctx.setFillStyle("rgba(61,127,90,0.12)");
      ctx.fillRect(0, 0, 12, SHARE_HEIGHT);
      ctx.setFillStyle("#171512");
      ctx.setTextAlign("left");
      ctx.setTextBaseline("middle");
      setCanvasFont(ctx, 34, true);
      ctx.fillText("决战歌曲之巅", 34, 48);
      ctx.setFillStyle("#5c554d");
      setCanvasFont(ctx, 17, true, "sans");
      ctx.fillText(
        clipText(ctx, `${this.data.artistName}丨${this.data.size}首参赛`, 420),
        35,
        82
      );

      drawCover(ctx, coverImage, champion.fallbackText, 35, 116, 230, true);
      ctx.setFillStyle("#3d7f5a");
      setCanvasFont(ctx, 14, true, "sans");
      ctx.fillText("最 后 留 下", 296, 144);
      ctx.setFillStyle("#171512");
      setCanvasFont(ctx, 28, true);
      const songName = clipText(ctx, champion.name, 168);
      ctx.fillText(songName, 296, 195);
      ctx.setFillStyle("#827b70");
      setCanvasFont(ctx, 14, false, "sans");
      ctx.fillText(clipText(ctx, champion.album, 168), 296, 230);
      ctx.setFillStyle("#1f6f42");
      setCanvasFont(ctx, 17, true, "sans");
      ctx.fillText("你也来选一遍", 296, 312);

      ctx.draw(false, () => {
        this.exportShareCanvas().then(resolve).catch(reject);
      });
    }));
  },

  saveResultPoster() {
    if (this.data.savingPoster || !this.derived) return;
    this.setData({ savingPoster: true });
    wx.showLoading({ title: "生成决选海报" });
    this.preparePosterPreview()
      .then((filePath) => this.shareOrSaveImage(filePath))
      .then(() => {
        if (!this.usedImageShareMenu) wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch(() => wx.showToast({ title: "海报生成失败，请重试", icon: "none" }))
      .finally(() => {
        wx.hideLoading();
        this.setData({ savingPoster: false });
      });
  },

  preparePosterPreview() {
    if (this.posterPreviewPromise) return this.posterPreviewPromise;
    this.setData({ posterPreviewLoading: true });
    const qrPromise = this.qrUrlPromise || Promise.resolve(this.data.qrUrl || "");
    this.posterPreviewPromise = qrPromise
      .then((qrUrl) => this.drawResultPoster(qrUrl))
      .then((posterPreviewUrl) => {
        this.setData({
          posterPreviewUrl,
          posterPreviewLoading: false
        });
        return posterPreviewUrl;
      })
      .catch((error) => {
        this.posterPreviewPromise = null;
        this.setData({ posterPreviewLoading: false });
        throw error;
      });
    return this.posterPreviewPromise;
  },

  drawResultPoster(qrUrl) {
    const graph = this.posterGraph;
    const sources = graph.nodes.map((node) => node.cover)
      .concat([graph.champion.cover, qrUrl])
      .filter(Boolean);
    return loadImageMap(sources).then((images) => {
      const ctx = wx.createCanvasContext("tournamentPosterCanvas", this);
      const background = ctx.createLinearGradient(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
      background.addColorStop(0, "#fffdfa");
      background.addColorStop(0.5, "#f6f0e7");
      background.addColorStop(1, "#eee5d9");
      ctx.setFillStyle(background);
      ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

      setCanvasFont(ctx, 55, true);
      ctx.setFillStyle("#171512");
      ctx.setTextAlign("center");
      ctx.setTextBaseline("middle");
      ctx.fillText("决 战 歌 曲 之 巅", EXPORT_WIDTH / 2, 194);

      setCanvasFont(ctx, 27, true);
      ctx.setFillStyle("#5c554d");
      ctx.setTextAlign("center");
      ctx.fillText(
        clipText(ctx, `${this.data.artistName}丨${this.data.size}首参赛`, 520),
        EXPORT_WIDTH / 2,
        247
      );

      graph.edges.forEach((edge) => {
        ctx.beginPath();
        ctx.moveTo(scaled(edge.x1), scaled(edge.y1));
        ctx.lineTo(scaled(edge.x2), scaled(edge.y2));
        ctx.setStrokeStyle(edge.highlighted ? "#3d7f5a" : "rgba(23,21,18,0.2)");
        ctx.setLineWidth(edge.highlighted ? 2.2 : 0.9);
        ctx.stroke();
      });

      graph.nodes.forEach((node) => {
        drawRouteNode(ctx, node, images[node.cover]);
      });

      ctx.setTextAlign("center");
      graph.finalSongs.forEach((finalist) => {
        setCanvasFont(ctx, 10, true, "sans");
        ctx.setFillStyle("#3d7f5a");
        ctx.fillText("决赛", scaled(finalist.x), scaled(finalist.y + finalist.height / 2 + 13));
      });

      const champion = graph.champion;
      const championSize = scaled(champion.size);
      const championX = scaled(champion.x) - championSize / 2;
      const championY = scaled(champion.y) - championSize / 2;
      setCanvasFont(ctx, 14, true, "sans");
      ctx.setFillStyle("#3d7f5a");
      ctx.fillText("冠 军", EXPORT_WIDTH / 2, championY - 18);
      drawCover(
        ctx,
        images[champion.cover],
        champion.fallbackText,
        championX,
        championY,
        championSize,
        true
      );
      setCanvasFont(ctx, 34, true);
      ctx.setFillStyle("#171512");
      ctx.fillText(clipText(ctx, champion.name, 380), EXPORT_WIDTH / 2, championY + championSize + 42);
      setCanvasFont(ctx, 14, false, "sans");
      ctx.setFillStyle("#827b70");
      ctx.fillText(clipText(ctx, champion.album, 360), EXPORT_WIDTH / 2, championY + championSize + 70);

      const footerY = EXPORT_HEIGHT - 136;
      const qrImage = images[qrUrl];
      const brandX = qrImage && qrImage.path ? 492 : EXPORT_WIDTH / 2;
      if (qrImage && qrImage.path) {
        ctx.setFillStyle("#fffdfa");
        ctx.fillRect(387, footerY - 8, 92, 92);
        ctx.drawImage(qrImage.path, 393, footerY - 2, 80, 80);
      }
      ctx.setTextAlign(qrImage && qrImage.path ? "left" : "center");
      setCanvasFont(ctx, 21, true);
      ctx.setFillStyle("#171512");
      ctx.fillText("决战歌曲之巅", brandX, footerY + 18);
      setCanvasFont(ctx, 12, false, "sans");
      ctx.setFillStyle("#827b70");
      ctx.fillText("扫码开始你的歌曲决选", brandX, footerY + 49);

      return new Promise((resolve, reject) => {
        ctx.draw(false, () => this.exportCanvas().then(resolve).catch(reject));
      });
    });
  },

  onShareAppMessage() {
    const payload = {
      title: `我留下了《${this.data.championName}》，你也来选一遍`,
      path: "/pages/artists/artists?mode=songTournament&fromShare=1"
    };
    if (this.data.shareImageUrl) payload.imageUrl = this.data.shareImageUrl;
    return payload;
  },

  onShareTimeline() {
    const payload = {
      title: `我留下了《${this.data.championName}》，你也来选一遍`,
      query: "fromShare=1"
    };
    if (this.data.shareImageUrl) payload.imageUrl = this.data.shareImageUrl;
    return payload;
  }
});
