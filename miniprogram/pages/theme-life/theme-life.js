const { getThemeTemplate } = require("../../data/themeTemplates");
const { getMiniProgramCode } = require("../../utils/api");
const { readCachedProfile, resolveCloudFileUrl } = require("../../utils/profile");
const { imageShareMethods } = require("../../utils/imageShare");
const {
  creatorProfileGateData,
  creatorProfileGateMethods,
  prepareCreatorProfileForCreate
} = require("../../utils/creatorProfileGate");

const SAVE_LABEL = "组成我人生的几分之几";

function readThemeAlbums() {
  return getApp().globalData.draftAlbums || [];
}

function countFilled(albums) {
  return (albums || []).filter((album) => album && album.id).length;
}

function getAlbumName(album) {
  return album.name || album.collectionName || "选一张专辑";
}

function getAlbumArtistName(album) {
  return album.artistName || " ";
}

function isCloudFileUrl(src) {
  return String(src || "").indexOf("cloud://") === 0;
}

function isHttpUrl(src) {
  return /^https?:\/\//.test(String(src || ""));
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function showPageShareMenu() {
  if (!wx.showShareMenu) return;
  wx.showShareMenu({
    menus: ["shareAppMessage"]
  });
}

function downloadCloudFile(fileID) {
  if (!isCloudFileUrl(fileID) || !wx.cloud || !wx.cloud.downloadFile) return Promise.resolve("");
  return wx.cloud.downloadFile({
    fileID
  }).then((res) => res.tempFilePath || "").catch(() => "");
}

function downloadRemoteFile(url) {
  if (!isHttpUrl(url) || !wx.downloadFile) return Promise.resolve(url || "");
  return new Promise((resolve) => {
    wx.downloadFile({
      url,
      success: (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath;
        resolve(ok ? res.tempFilePath : url);
      },
      fail: () => resolve(url)
    });
  });
}

function prepareCanvasImageSource(src, preferLocal = false) {
  const value = String(src || "").trim();
  if (!value) return Promise.resolve("");

  if (isCloudFileUrl(value)) {
    return downloadCloudFile(value).then((localPath) => {
      if (localPath) return localPath;
      return resolveCloudFileUrl(value).then((resolvedUrl) => (
        preferLocal ? downloadRemoteFile(resolvedUrl) : resolvedUrl
      ));
    });
  }

  return preferLocal ? downloadRemoteFile(value) : Promise.resolve(value);
}

function getImageInfo(src, options = {}) {
  if (!src) return Promise.resolve({ path: "", width: 0, height: 0 });
  return prepareCanvasImageSource(src, Boolean(options.preferLocal)).then((preparedSrc) => {
    if (!preparedSrc) return { path: "", width: 0, height: 0 };
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: preparedSrc,
        success: (res) => resolve({
          path: res.path || preparedSrc,
          width: res.width || 0,
          height: res.height || 0
        }),
        fail: () => resolve({ path: "", width: 0, height: 0 })
      });
    });
  });
}

function getImageInfoWithRetry(src, options = {}, retryDelay = 600) {
  return getImageInfo(src, options).then((image) => {
    if (image.path || !retryDelay) return image;
    return wait(retryDelay).then(() => getImageInfo(src, options));
  });
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

function fillRoundRect(ctx, x, y, width, height, radius, color) {
  drawRoundRectPath(ctx, x, y, width, height, radius);
  ctx.setFillStyle(color);
  ctx.fill();
}

function drawImageCover(ctx, image, x, y, width, height) {
  const path = image && image.path;
  const sourceWidth = image && image.width;
  const sourceHeight = image && image.height;
  if (!path) return;

  if (sourceWidth && sourceHeight) {
    const targetRatio = width / height;
    const sourceRatio = sourceWidth / sourceHeight;
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;
    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }
    ctx.drawImage(path, sx, sy, sw, sh, x, y, width, height);
    return;
  }

  ctx.drawImage(path, x, y, width, height);
}

function drawFitText(ctx, text, x, y, maxWidth, fontSize, minFontSize, fillStyle) {
  let size = fontSize;
  const value = String(text || "");
  if (fillStyle) ctx.setFillStyle(fillStyle);
  ctx.setFontSize(size);
  while (size > minFontSize && ctx.measureText(value).width > maxWidth) {
    size -= 1;
    ctx.setFontSize(size);
  }
  ctx.fillText(value, x, y);
}

function ellipsizeCanvasText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (!value || ctx.measureText(value).width <= maxWidth) return value;
  const ellipsis = "...";
  if (ctx.measureText(ellipsis).width > maxWidth) return ellipsis;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${value.slice(0, mid)}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${value.slice(0, low)}${ellipsis}`;
}

function drawEllipsizedText(ctx, text, x, y, maxWidth, fontSize, fillStyle) {
  if (fillStyle) ctx.setFillStyle(fillStyle);
  ctx.setFontSize(fontSize);
  ctx.fillText(ellipsizeCanvasText(ctx, text, maxWidth), x, y);
}

function drawRightFitText(ctx, text, rightX, y, maxWidth, fontSize, minFontSize, fillStyle) {
  let size = fontSize;
  const value = String(text || "");
  if (fillStyle) ctx.setFillStyle(fillStyle);
  ctx.setFontSize(size);
  while (size > minFontSize && ctx.measureText(value).width > maxWidth) {
    size -= 1;
    ctx.setFontSize(size);
  }
  ctx.fillText(value, rightX - Math.min(ctx.measureText(value).width, maxWidth), y);
}

function drawCircleImage(ctx, image, x, y, size, fallbackText) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (image && image.path) {
    drawImageCover(ctx, image, x, y, size, size);
  } else {
    ctx.setFillStyle("#171512");
    ctx.fillRect(x, y, size, size);
    ctx.setFillStyle("#fffdfa");
    ctx.setFontSize(18);
    const text = String(fallbackText || "我").slice(0, 1);
    const textWidth = ctx.measureText(text).width;
    ctx.fillText(text, x + (size - textWidth) / 2, y + size / 2 + 7);
  }
  ctx.restore();
}

Page({
  data: {
    ...creatorProfileGateData,
    templateId: "life9",
    title: "人生九专",
    prompts: [],
    selectedCount: 0,
    isComplete: false,
    savingImage: false,
    homeQrCodeUrl: "",
    saveLabel: SAVE_LABEL
  },

  onLoad(options) {
    showPageShareMenu();
    const templateId = options.template || "life9";
    const template = getThemeTemplate(templateId) || getThemeTemplate("life9");
    const app = getApp();
    app.globalData.draftMode = "theme";
    app.globalData.draftThemeTemplate = template.id;
    app.globalData.draftThemePrompts = template.prompts || [];
    app.globalData.draftThemeChoices = app.globalData.draftThemeChoices || {};
    app.globalData.draftThemeArtists = app.globalData.draftThemeArtists || {};
    app.globalData.draftAlbums = app.globalData.draftAlbums || [];
    this.setData({
      templateId: template.id,
      title: template.name,
      prompts: template.prompts || []
    }, () => this.renderPrompts());
    this.initCreatorProfileGate();
  },

  ...creatorProfileGateMethods,

  onShow() {
    this.renderPrompts();
  },

  renderPrompts() {
    const app = getApp();
    const basePrompts = (app.globalData.draftThemePrompts || []).length
      ? app.globalData.draftThemePrompts
      : ((getThemeTemplate(this.data.templateId) || {}).prompts || []);
    const albums = readThemeAlbums();
    const prompts = basePrompts.map((prompt, index) => {
      const album = albums[index] || {};
      return {
        ...prompt,
        album,
        albumCover: album.cover || "",
        albumName: getAlbumName(album),
        albumArtistName: getAlbumArtistName(album),
        doneClass: album.id ? "done" : ""
      };
    });
    const selectedCount = countFilled(albums);
    this.setData({
      prompts,
      selectedCount,
      saveLabel: SAVE_LABEL,
      isComplete: selectedCount === 9
    });
  },

  choosePrompt(event) {
    const slotId = event.currentTarget.dataset.id;
    if (!slotId) return;
    const app = getApp();
    app.globalData.currentThemeSlotId = slotId;
    app.globalData.draftMode = "themeAlbum";
    app.globalData.draftThemeTemplate = "life9";
    app.globalData.draftThemeAlbumTarget = 9;
    wx.navigateTo({
      url: "/pages/artists/artists?mode=themeAlbum&role=creator"
    });
  },

  saveImage() {
    if (!this.data.isComplete || this.data.savingImage) return;
    if (!this.ensureCreatorProfileForCreate("saveImage")) return;
    this.setData({ savingImage: true });
    wx.showLoading({ title: "绘制中..." });
    prepareCreatorProfileForCreate(this)
      .then(() => this.drawThemeCanvas())
      .then((filePath) => this.shareOrSaveImage(filePath))
      .then(() => {
        if (!this.usedImageShareMenu) wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch(() => {
        wx.showToast({ title: "保存失败，请检查相册权限", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ savingImage: false });
      });
  },

  ...imageShareMethods,

  goHome() {
    wx.reLaunch({ url: "/pages/home/home" });
  },

  getHomeQrCodeUrl() {
    if (this.data.homeQrCodeUrl) return Promise.resolve(this.data.homeQrCodeUrl);
    return getMiniProgramCode({
      page: "pages/home/home"
    }).then((res) => {
      const url = res.fileID || res.tempFileURL || "";
      if (url) this.setData({ homeQrCodeUrl: url });
      return url;
    }).catch(() => "");
  },

  drawThemeCanvas() {
    const width = 750;
    const margin = 30;
    const gap = 14;
    const cardWidth = (width - margin * 2 - gap * 2) / 3;
    const cardHeight = cardWidth * 1.28;
    const cardPadding = 10;
    const coverSize = cardWidth - cardPadding * 2;
    const gridTop = 128;
    const gridRows = 3;
    const gridBottom = gridTop + gridRows * cardHeight + (gridRows - 1) * gap;
    const footerTop = Math.ceil(gridBottom + 28);
    const qrSize = 112;
    const height = 1180;
    const ctx = wx.createCanvasContext("themeLifeCanvas", this);
    const prompts = this.data.prompts;
    const profile = getApp().globalData.creatorProfile || readCachedProfile();
    const nickName = profile.nickName || "匿名挑战者";
    const avatarPromise = resolveCloudFileUrl(profile.avatarUrl || "").then((avatarUrl) => getImageInfo(avatarUrl));

    return Promise.all([
      Promise.all(prompts.map((item) => getImageInfo((item.album || {}).cover))),
      avatarPromise,
      this.getHomeQrCodeUrl().then((url) => getImageInfoWithRetry(url, { preferLocal: true }))
    ]).then(([images, avatarImage, qrImage]) => new Promise((resolve, reject) => {
      ctx.setFillStyle("#f6f0e7");
      ctx.fillRect(0, 0, width, height);
      ctx.setFillStyle("#171512");
      ctx.setFontSize(48);
      ctx.fillText(SAVE_LABEL, margin, 78);
      drawCircleImage(ctx, avatarImage, width - margin - 52, 38, 52, nickName);
      drawRightFitText(ctx, nickName, width - margin - 66, 72, 220, 24, 16, "#171512");

      prompts.forEach((item, index) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const x = margin + col * (cardWidth + gap);
        const y = gridTop + row * (cardHeight + gap);
        const album = item.album || {};
        const image = images[index];
        const infoX = x + cardPadding;
        const coverTop = y + cardPadding;
        const infoTop = coverTop + coverSize + 30;
        const textWidth = cardWidth - cardPadding * 2;

        ctx.save();
        if (ctx.setShadow) ctx.setShadow(0, 9, 18, "rgba(23,21,18,.13)");
        fillRoundRect(ctx, x, y, cardWidth, cardHeight, 4, "#fffdfa");
        ctx.restore();

        ctx.save();
        drawRoundRectPath(ctx, x + cardPadding, coverTop, coverSize, coverSize, 2);
        ctx.clip();
        ctx.setFillStyle("#f1ebe2");
        ctx.fillRect(x + cardPadding, coverTop, coverSize, coverSize);
        drawImageCover(ctx, image, x + cardPadding, coverTop, coverSize, coverSize);
        ctx.restore();

        drawEllipsizedText(ctx, getAlbumName(album), infoX, infoTop, textWidth, 22, "#171512");
        drawEllipsizedText(ctx, getAlbumArtistName(album), infoX, infoTop + 25, textWidth, 18, "#171512");
      });

      drawFitText(ctx, "在这个混乱的世代感谢还有音乐。", margin, footerTop + 70, width - margin * 3 - qrSize, 25, 18, "#171512");
      fillRoundRect(ctx, width - margin - qrSize, footerTop, qrSize, qrSize, 8, "#fffdfa");
      if (qrImage && qrImage.path) {
        ctx.drawImage(qrImage.path, width - margin - qrSize + 8, footerTop + 8, qrSize - 16, qrSize - 16);
      }

      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "themeLifeCanvas",
          width,
          height,
          destWidth: width,
          destHeight: height,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this);
      });
    }));
  },

  onShareAppMessage() {
    return {
      title: "来排一张人生九专",
      path: `/pages/theme-life/theme-life?template=${encodeURIComponent(this.data.templateId || "life9")}`
    };
  }
});
