const { createChallenge, getMiniProgramCode } = require("../../utils/api");
const { ensureChallenge, needsChallenge } = require("../../utils/challengeState");
const { readFriendDraft } = require("../../utils/friendDraft");
const { saveCreatedChallenge } = require("../../utils/history");
const { resolveCloudFileUrl } = require("../../utils/profile");
const {
  creatorProfileGateData,
  creatorProfileGateMethods,
  prepareCreatorProfileForCreate
} = require("../../utils/creatorProfileGate");
const { getColorSubjects } = require("../../data/colors");

function readChoices(role) {
  const app = getApp();
  return role === "friend" ? (app.globalData.friendChoices || {}) : (app.globalData.creatorChoices || {});
}

function countFilledColors(colors, choices) {
  return (colors || []).filter((color) => {
    const song = choices[color.id] || {};
    return song.trackId;
  }).length;
}

function areAllColorsFilled(colors, choices) {
  return colors.length === 9 && countFilledColors(colors, choices) === colors.length;
}

function getSongName(song) {
  return song.name || song.trackName || "选一首歌";
}

function getSongAlbumName(song) {
  return song.album || song.collectionName || "";
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
  ctx.setFontSize(size);
  if (fillStyle) ctx.setFillStyle(fillStyle);
  while (size > minFontSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.setFontSize(size);
  }
  ctx.fillText(text, x, y);
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
  const width = Math.min(ctx.measureText(value).width, maxWidth);
  ctx.fillText(value, rightX - width, y);
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
    role: "creator",
    challengeId: "",
    colors: [],
    selectedCount: 0,
    isComplete: false,
    actionClass: "",
    primaryLabel: "分享挑战",
    creating: false,
    savingImage: false,
    homeQrCodeUrl: ""
  },

  onLoad(options) {
    const safeOptions = options || {};
    const role = safeOptions.role || "creator";
    const challengeId = safeOptions.challengeId
      ? decodeURIComponent(safeOptions.challengeId)
      : ((getApp().globalData.challenge || {}).challengeId || "");

    if (role === "friend" && challengeId && needsChallenge(challengeId)) {
      wx.showLoading({ title: "读取挑战" });
      ensureChallenge(challengeId)
        .then(() => this.initPage({ ...safeOptions, challengeId }))
        .catch(() => {
          wx.showToast({ title: "挑战不存在", icon: "none" });
        })
        .finally(() => wx.hideLoading());
      return;
    }

    this.initPage({ ...safeOptions, challengeId });
  },

  initPage(options) {
    const role = options.role || "creator";
    const challengeId = options.challengeId || ((getApp().globalData.challenge || {}).challengeId || "");
    const app = getApp();
    const colors = (app.globalData.draftColors || []).length ? app.globalData.draftColors : getColorSubjects();
    app.globalData.draftMode = "color";
    app.globalData.draftColors = colors;
    if (role === "friend") {
      app.globalData.friendChoices = app.globalData.friendChoices || {};
      const draft = readFriendDraft(challengeId);
      if (!Object.keys(app.globalData.friendChoices).length && Object.keys(draft.friendChoices || {}).length) {
        app.globalData.friendChoices = draft.friendChoices;
      }
      if (draft.friendProfile && (draft.friendProfile.nickName || draft.friendProfile.avatarUrl)) {
        app.globalData.friendProfile = draft.friendProfile;
      }
    } else {
      app.globalData.creatorChoices = app.globalData.creatorChoices || {};
      this.initCreatorProfileGate();
    }
    this.setData({
      role,
      challengeId,
      actionClass: role === "friend" ? "single" : "",
      primaryLabel: role === "friend" ? "查看结果" : "分享挑战"
    }, () => this.renderColors());
  },

  ...creatorProfileGateMethods,

  onShow() {
    this.renderColors();
  },

  renderColors() {
    const app = getApp();
    const choices = readChoices(this.data.role);
    const baseColors = (app.globalData.draftColors || []).length ? app.globalData.draftColors : getColorSubjects();
    const colors = baseColors.map((color) => {
      const song = choices[color.id] || {};
      return {
        ...color,
        song,
        songName: getSongName(song),
        songArtistName: song.artistName || " ",
        songAlbumName: getSongAlbumName(song),
        borderColor: color.borderColor || "rgba(23,21,18,.1)",
        cardStyle: `background:${color.color};color:${color.textColor};border-color:${color.borderColor || "rgba(23,21,18,.1)"};`,
        doneClass: song.trackId ? "done" : "",
        darkClass: color.id === "color-black" ? "dark" : ""
      };
    });
    const selectedCount = countFilledColors(baseColors, choices);
    this.setData({
      colors,
      selectedCount,
      isComplete: areAllColorsFilled(baseColors, choices)
    });
  },

  chooseColor(event) {
    const colorId = event.currentTarget.dataset.id;
    if (!colorId) return;
    wx.navigateTo({
      url: `/pages/artists/artists?mode=color&role=${this.data.role}&colorId=${colorId}&challengeId=${encodeURIComponent(this.data.challengeId || "")}`
    });
  },

  primaryAction() {
    const colors = (getApp().globalData.draftColors || []).length ? getApp().globalData.draftColors : getColorSubjects();
    const choices = readChoices(this.data.role);
    if (!areAllColorsFilled(colors, choices)) {
      wx.showToast({ title: "先填满 9 个颜色格", icon: "none" });
      this.renderColors();
      return;
    }
    if (this.data.role === "friend") {
      const challengeId = this.data.challengeId || (getApp().globalData.challenge || {}).challengeId || "";
      if (!challengeId) {
        wx.showToast({ title: "挑战信息丢失，请重新进入", icon: "none" });
        return;
      }
      wx.navigateTo({ url: `/pages/result/result?mode=friend&challengeId=${encodeURIComponent(challengeId)}` });
      return;
    }
    this.createColorChallenge();
  },

  createColorChallenge() {
    if (this.data.creating) return;
    if (!this.ensureCreatorProfileForCreate("createColorChallenge")) return;
    const colors = (getApp().globalData.draftColors || []).length ? getApp().globalData.draftColors : getColorSubjects();
    const choices = getApp().globalData.creatorChoices || {};
    if (!areAllColorsFilled(colors, choices)) {
      wx.showToast({ title: "先填满 9 个颜色格", icon: "none" });
      this.renderColors();
      return;
    }
    this.setData({ creating: true });
    wx.showLoading({ title: "创建中" });
    const app = getApp();
    prepareCreatorProfileForCreate(this)
      .then((creatorProfile) => createChallenge({
        mode: "color",
        colors,
        creatorChoices: choices,
        creatorProfile
      }))
      .then((res) => {
        app.globalData.challenge = {
          challengeId: res.challengeId,
          mode: "color",
          colors,
          creatorChoices: choices,
          creatorProfile: app.globalData.creatorProfile || wx.getStorageSync("creatorProfile") || {},
          createdAt: Date.now()
        };
        saveCreatedChallenge(app.globalData.challenge);
        wx.navigateTo({ url: `/pages/share/share?challengeId=${res.challengeId}` });
      })
      .catch((error) => {
        wx.showToast({ title: (error && error.message) || "创建失败", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ creating: false });
      });
  },

  saveImage() {
    if (!this.data.isComplete || this.data.savingImage) return;
    if (this.data.role !== "friend" && !this.ensureCreatorProfileForCreate("saveImage")) return;
    this.setData({ savingImage: true });
    wx.showLoading({ title: "绘制中..." });
    const profileReady = this.data.role === "friend" ? Promise.resolve() : prepareCreatorProfileForCreate(this);
    profileReady
      .then(() => this.drawColorCanvas())
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

  shareOrSaveImage(filePath) {
    this.usedImageShareMenu = false;
    if (wx.showShareImageMenu) {
      return new Promise((resolve, reject) => {
        wx.showShareImageMenu({
          path: filePath,
          success: () => {
            this.usedImageShareMenu = true;
            resolve();
          },
          fail: (error) => {
            const errMsg = String((error && error.errMsg) || "");
            if (errMsg.indexOf("cancel") >= 0) {
              this.usedImageShareMenu = true;
              resolve();
              return;
            }
            reject(error);
          }
        });
      }).catch(() => this.saveImageToAlbum(filePath));
    }
    return this.saveImageToAlbum(filePath);
  },

  saveImageToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: resolve,
        fail: reject
      });
    });
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

  drawColorCanvas() {
    const width = 750;
    const height = 1360;
    const margin = 30;
    const gap = 14;
    const cardWidth = (width - margin * 2 - gap * 2) / 3;
    const cardHeight = cardWidth * 1.5;
    const cardPadding = 10;
    const coverSize = cardWidth - cardPadding * 2;
    const qrSize = 112;
    const footerTop = 1206;
    const ctx = wx.createCanvasContext("colorCanvas", this);
    const colors = this.data.colors;
    const profile = getApp().globalData.creatorProfile || wx.getStorageSync("creatorProfile") || {};
    const nickName = profile.nickName || "匿名挑战者";
    const avatarPromise = resolveCloudFileUrl(profile.avatarUrl || "").then((avatarUrl) => getImageInfo(avatarUrl));

    return Promise.all([
      Promise.all(colors.map((item) => getImageInfo((item.song || {}).cover))),
      avatarPromise,
      this.getHomeQrCodeUrl().then((url) => getImageInfoWithRetry(url))
    ])
      .then(([images, avatarImage, qrImage]) => new Promise((resolve, reject) => {
        ctx.setFillStyle("#f6f0e7");
        ctx.fillRect(0, 0, width, height);
        ctx.setFillStyle("#171512");
        ctx.setFontSize(44);
        ctx.fillText("颜色推歌挑战", margin, 76);
        drawCircleImage(ctx, avatarImage, width - margin - 52, 38, 52, nickName);
        drawRightFitText(ctx, nickName, width - margin - 66, 72, 220, 24, 16, "#171512");

        colors.forEach((item, index) => {
          const row = Math.floor(index / 3);
          const col = index % 3;
          const x = margin + col * (cardWidth + gap);
          const y = 126 + row * (cardHeight + gap);
          const song = item.song || {};
          const image = images[index];
          const infoX = x + cardPadding;
          const coverTop = y + cardPadding + 30;
          const infoTop = coverTop + coverSize + 28;
          const textWidth = cardWidth - cardPadding * 2;

          ctx.save();
          if (ctx.setShadow) ctx.setShadow(0, 8, 14, "rgba(23,21,18,.16)");
          fillRoundRect(ctx, x, y, cardWidth, cardHeight, 4, item.color);
          ctx.restore();
          drawEllipsizedText(ctx, item.name, infoX, y + cardPadding + 20, textWidth, 21, item.textColor || "#171512");

          ctx.save();
          drawRoundRectPath(ctx, x + cardPadding, coverTop, coverSize, coverSize, 2);
          ctx.clip();
          ctx.setFillStyle("#fffdfa");
          ctx.fillRect(x + cardPadding, coverTop, coverSize, coverSize);
          drawImageCover(ctx, image, x + cardPadding, coverTop, coverSize, coverSize);
          ctx.restore();

          drawEllipsizedText(ctx, getSongName(song), infoX, infoTop, textWidth, 22, item.textColor || "#171512");
          drawEllipsizedText(ctx, song.artistName || "", infoX, infoTop + 24, textWidth, 18, item.textColor || "#171512");
          drawEllipsizedText(ctx, getSongAlbumName(song), infoX, infoTop + 46, textWidth, 17, item.textColor || "#171512");
        });

        drawFitText(ctx, "在这个混乱的世代感谢还有音乐。", margin, footerTop + 70, width - margin * 3 - qrSize, 25, 18, "#171512");
        fillRoundRect(ctx, width - margin - qrSize, footerTop, qrSize, qrSize, 8, "#fffdfa");
        if (qrImage && qrImage.path) {
          ctx.drawImage(qrImage.path, width - margin - qrSize + 8, footerTop + 8, qrSize - 16, qrSize - 16);
        }

        ctx.draw(false, () => {
          wx.canvasToTempFilePath({
            canvasId: "colorCanvas",
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
