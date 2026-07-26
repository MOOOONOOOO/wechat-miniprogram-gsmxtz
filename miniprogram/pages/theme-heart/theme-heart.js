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
const HEART_TITLE = "心形专辑挑战";

const HEART_LAYOUT = [
  { id: "heart-01", x: 86, y: 0, w: 90, h: 91 },
  { id: "heart-02", x: 182, y: 0, w: 91, h: 91 },
  { id: "heart-03", x: 379, y: 0, w: 181, h: 181 },
  { id: "heart-04", x: 570, y: 90, w: 90, h: 91 },
  { id: "heart-05", x: 0, y: 98, w: 83, h: 84 },
  { id: "heart-06", x: 95, y: 99, w: 175, h: 175 },
  { id: "heart-07", x: 284, y: 99, w: 83, h: 83 },
  { id: "heart-08", x: 0, y: 188, w: 83, h: 84 },
  { id: "heart-09", x: 379, y: 188, w: 181, h: 181 },
  { id: "heart-10", x: 284, y: 190, w: 83, h: 84 },
  { id: "heart-11", x: 570, y: 190, w: 92, h: 94 },
  { id: "heart-12", x: 96, y: 288, w: 81, h: 81 },
  { id: "heart-13", x: 190, y: 288, w: 177, h: 177 },
  { id: "heart-14", x: 379, y: 376, w: 91, h: 92 },
  { id: "heart-15", x: 284, y: 474, w: 83, h: 84 }
];

function readThemeAlbums() {
  return getApp().globalData.draftAlbums || [];
}

function countFilled(albums) {
  return (albums || []).filter((album) => album && album.id).length;
}

function getTouchPoint(event) {
  const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]) || {};
  return {
    x: Number(touch.pageX || 0),
    y: Number(touch.pageY || 0)
  };
}

function getRpxScale() {
  try {
    const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    return 750 / (info.windowWidth || 375);
  } catch (error) {
    return 2;
  }
}

function getImageInfo(src) {
  if (!src) return Promise.resolve({ path: "", width: 0, height: 0 });
  const value = String(src || "").trim();
  const readInfo = (imageSrc) => new Promise((resolve) => {
    wx.getImageInfo({
      src: imageSrc,
      success: (res) => resolve({
        path: res.path || imageSrc,
        width: res.width || 0,
        height: res.height || 0
      }),
      fail: () => resolve({ path: "", width: 0, height: 0 })
    });
  });

  if (value.indexOf("cloud://") === 0 && wx.cloud && wx.cloud.downloadFile) {
    return wx.cloud.downloadFile({ fileID: value })
      .then((res) => readInfo(res.tempFilePath || ""))
      .catch(() => ({ path: "", width: 0, height: 0 }));
  }

  return readInfo(value);
}

function getImageInfoWithRetry(src, retryDelay = 600) {
  return getImageInfo(src).then((image) => {
    if (image.path || !retryDelay) return image;
    return new Promise((resolve) => {
      setTimeout(resolve, retryDelay);
    }).then(() => getImageInfo(src));
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

function getAlbumTitle(album = {}) {
  return String(album.name || album.collectionName || album.album || "未知专辑").trim();
}

function getAlbumArtist(album = {}) {
  return String(album.artistName || album.name || "未知歌手").trim();
}

function shuffleAlbums(albums) {
  const list = (albums || []).filter((album) => album && album.id).slice();
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = list[index];
    list[index] = list[swapIndex];
    list[swapIndex] = current;
  }
  return list;
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
    title: HEART_TITLE,
    slots: [],
    selectedCount: 0,
    isComplete: false,
    savingImage: false,
    saveLabel: SAVE_LABEL,
    draggingClass: "",
    homeQrCodeUrl: ""
  },

  onLoad() {
    const template = getThemeTemplate("heart");
    const app = getApp();
    app.globalData.draftMode = "theme";
    app.globalData.draftThemeTemplate = "heart";
    app.globalData.draftThemePrompts = template.prompts || [];
    app.globalData.draftThemeChoices = app.globalData.draftThemeChoices || {};
    app.globalData.draftThemeArtists = app.globalData.draftThemeArtists || {};
    app.globalData.draftAlbums = app.globalData.draftAlbums || [];
    app.globalData.draftThemeAlbumTarget = HEART_LAYOUT.length;
    this.setData({ title: template.name || HEART_TITLE });
    this.initCreatorProfileGate();
    this.renderSlots();
  },

  ...creatorProfileGateMethods,

  onShow() {
    this.renderSlots();
  },

  renderSlots() {
    const template = getThemeTemplate("heart");
    const prompts = (getApp().globalData.draftThemePrompts || []).length
      ? getApp().globalData.draftThemePrompts
      : (template.prompts || []);
    const albums = readThemeAlbums();
    const slots = HEART_LAYOUT.map((layout, index) => {
      const prompt = prompts[index] || { id: layout.id };
      const album = albums[index] || {};
      return {
        ...layout,
        ...prompt,
        album,
        albumCover: album.cover || "",
        doneClass: album.id ? "done" : "",
        dragClass: this.dragIndex === index ? "dragging" : "",
        hoverClass: this.hoverIndex === index ? "drop-target" : "",
        swapClass: this.swapIndexes && this.swapIndexes[index] ? "swapping" : "",
        dragStyle: this.dragIndex === index ? (this.dragStyle || "") : "",
        cardStyle: `left:${layout.x}rpx;top:${layout.y}rpx;width:${layout.w}rpx;height:${layout.h}rpx;`
      };
    });
    const selectedCount = countFilled(albums);
    this.setData({
      slots,
      selectedCount,
      saveLabel: SAVE_LABEL,
      isComplete: selectedCount === HEART_LAYOUT.length,
      draggingClass: this.dragIndex >= 0 ? "dragging" : ""
    });
  },

  chooseSlot(event) {
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }
    const slotId = event.currentTarget.dataset.id;
    if (!slotId) return;
    const app = getApp();
    app.globalData.currentThemeSlotId = slotId;
    app.globalData.draftMode = "themeAlbum";
    app.globalData.draftThemeTemplate = "heart";
    app.globalData.draftThemeAlbumTarget = HEART_LAYOUT.length;
    wx.navigateTo({
      url: "/pages/artists/artists?mode=themeAlbum&role=creator&template=heart"
    });
  },

  startDrag(event) {
    const index = Number(event.currentTarget.dataset.index);
    const slot = this.data.slots[index] || {};
    if (!this.data.isComplete) {
      wx.showToast({ title: "填满后可拖动调整", icon: "none" });
      return;
    }
    if (!slot.album || !slot.album.id) return;

    const point = getTouchPoint(event);
    this.dragIndex = index;
    this.hoverIndex = -1;
    this.dragStart = {
      x: point.x,
      y: point.y,
      baseX: slot.x,
      baseY: slot.y
    };
    this.dragOffset = { dx: 0, dy: 0 };
    this.dragStyle = "transform:translate(0rpx,0rpx) scale(1.04);";
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    this.renderSlots();
  },

  moveDrag(event) {
    if (this.dragIndex === undefined || this.dragIndex < 0 || !this.dragStart) return;
    const point = getTouchPoint(event);
    const scale = getRpxScale();
    const dx = (point.x - this.dragStart.x) * scale;
    const dy = (point.y - this.dragStart.y) * scale;
    this.dragOffset = { dx, dy };
    this.dragStyle = `transform:translate(${dx}rpx,${dy}rpx) scale(1.06);`;
    const hoverIndex = this.findDropIndex(this.dragIndex);
    const key = `slots[${this.dragIndex}].dragStyle`;
    const nextData = { [key]: this.dragStyle };
    if (hoverIndex !== this.hoverIndex) {
      if (this.hoverIndex >= 0) nextData[`slots[${this.hoverIndex}].hoverClass`] = "";
      if (hoverIndex >= 0) nextData[`slots[${hoverIndex}].hoverClass`] = "drop-target";
      this.hoverIndex = hoverIndex;
    }
    this.setData(nextData);
  },

  endDrag() {
    if (this.dragIndex === undefined || this.dragIndex < 0) return;
    const fromIndex = this.dragIndex;
    const toIndex = this.findDropIndex(fromIndex);
    this.dragIndex = -1;
    this.hoverIndex = -1;
    this.dragStart = null;
    this.dragStyle = "";
    this.justDragged = true;

    if (toIndex >= 0 && toIndex !== fromIndex) {
      const app = getApp();
      const albums = [...(app.globalData.draftAlbums || [])];
      const fromAlbum = albums[fromIndex];
      const toAlbum = albums[toIndex];
      if (fromAlbum && toAlbum) {
        albums[fromIndex] = toAlbum;
        albums[toIndex] = fromAlbum;
        app.globalData.draftAlbums = albums;
        this.swapIndexes = {
          [fromIndex]: true,
          [toIndex]: true
        };
      }
    }

    this.renderSlots();
    setTimeout(() => {
      this.swapIndexes = null;
      this.renderSlots();
    }, 260);
  },

  cancelDrag() {
    this.endDrag();
  },

  findDropIndex(fromIndex) {
    const slot = this.data.slots[fromIndex] || {};
    const offset = this.dragOffset || { dx: 0, dy: 0 };
    const centerX = slot.x + offset.dx + slot.w / 2;
    const centerY = slot.y + offset.dy + slot.h / 2;
    let closestIndex = -1;
    let closestDistance = Infinity;

    this.data.slots.forEach((target, index) => {
      if (index === fromIndex || !target.album || !target.album.id) return;
      const inBounds = (
        centerX >= target.x &&
        centerX <= target.x + target.w &&
        centerY >= target.y &&
        centerY <= target.y + target.h
      );
      if (inBounds) {
        closestIndex = index;
        closestDistance = 0;
        return;
      }
      const targetCenterX = target.x + target.w / 2;
      const targetCenterY = target.y + target.h / 2;
      const distance = Math.pow(centerX - targetCenterX, 2) + Math.pow(centerY - targetCenterY, 2);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    const sourceSize = Math.max(slot.w || 0, slot.h || 0);
    return closestDistance <= Math.pow(sourceSize * 1.4, 2) ? closestIndex : -1;
  },

  saveImage() {
    if (!this.data.isComplete || this.data.savingImage) return;
    if (!this.ensureCreatorProfileForCreate("saveImage")) return;
    this.setData({ savingImage: true });
    wx.showLoading({ title: "绘制中..." });
    prepareCreatorProfileForCreate(this)
      .then(() => this.drawHeartCanvas())
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

  drawHeartCanvas() {
    const width = 750;
    const height = 1240;
    const boardX = 54;
    const boardY = 160;
    const infoX = 54;
    const infoY = 780;
    const infoLineHeight = 27;
    const qrSize = 112;
    const qrX = width - infoX - qrSize;
    const qrY = height - qrSize - 36;
    const infoMaxWidth = qrX - infoX - 24;
    const ctx = wx.createCanvasContext("themeHeartCanvas", this);
    const slots = this.data.slots;
    const albumsForInfo = shuffleAlbums(slots.map((slot) => slot.album));
    const profile = getApp().globalData.creatorProfile || readCachedProfile();
    const nickName = profile.nickName || "匿名挑战者";
    const avatarPromise = resolveCloudFileUrl(profile.avatarUrl || "").then((avatarUrl) => getImageInfo(avatarUrl));

    return Promise.all([
      Promise.all(slots.map((item) => getImageInfo((item.album || {}).cover))),
      avatarPromise,
      this.getHomeQrCodeUrl().then((url) => getImageInfoWithRetry(url))
    ]).then(([images, avatarImage, qrImage]) => new Promise((resolve, reject) => {
      ctx.setFillStyle("#f6f0e7");
      ctx.fillRect(0, 0, width, height);
      ctx.setFillStyle("#171512");
      ctx.setFontSize(54);
      ctx.fillText(HEART_TITLE, 54, 82);
      drawCircleImage(ctx, avatarImage, width - 84, 38, 52, nickName);
      drawRightFitText(ctx, nickName, width - 98, 72, 220, 24, 16, "#171512");

      slots.forEach((slot, index) => {
        const x = boardX + slot.x;
        const y = boardY + slot.y;
        const image = images[index];
        ctx.save();
        if (ctx.setShadow) ctx.setShadow(0, 9, 18, "rgba(23,21,18,.14)");
        fillRoundRect(ctx, x, y, slot.w, slot.h, 2, "#fffdfa");
        ctx.restore();
        ctx.save();
        drawRoundRectPath(ctx, x, y, slot.w, slot.h, 2);
        ctx.clip();
        ctx.setFillStyle("#fffdfa");
        ctx.fillRect(x, y, slot.w, slot.h);
        drawImageCover(ctx, image, x, y, slot.w, slot.h);
        ctx.restore();
        drawRoundRectPath(ctx, x, y, slot.w, slot.h, 2);
        ctx.setStrokeStyle("#2f2f2f");
        ctx.setLineWidth(4);
        ctx.stroke();
      });

      ctx.setFillStyle("#171512");
      ctx.setFontSize(24);
      ctx.fillText("专辑清单", infoX, infoY);
      albumsForInfo.forEach((album, index) => {
        const line = `${index + 1}. ${getAlbumArtist(album)}-${getAlbumTitle(album)}`;
        drawFitText(ctx, line, infoX, infoY + 40 + index * infoLineHeight, infoMaxWidth, 19, 12, "#5f584f");
      });
      fillRoundRect(ctx, qrX, qrY, qrSize, qrSize, 8, "#fffdfa");
      if (qrImage && qrImage.path) {
        ctx.drawImage(qrImage.path, qrX + 8, qrY + 8, qrSize - 16, qrSize - 16);
      }

      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "themeHeartCanvas",
          width,
          height,
          destWidth: width,
          destHeight: height,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this);
      });
    }));
  }
});
