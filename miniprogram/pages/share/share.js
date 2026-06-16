const { getChallenge, updateChallengeProfile } = require("../../utils/api");

const SHARE_COPIES = [
  "我怀疑我的音乐品味在你之上",
  "看看我们的音乐品味能不能对上",
  "想做的士司机让世界听我的歌单",
  "我们之中有两个人的品味很好",
  "总以为谜一般难懂的我 喵~",
  "我猜着你的心 要再一次决定",
  "长长的路上我想我们是朋友",
  "我们是对方 特别的人？",
  "我想是因为我不确定是否你有同样心愿"
];

function pickShareCopy() {
  return SHARE_COPIES[Math.floor(Math.random() * SHARE_COPIES.length)];
}

function getInviteShareTitle(mode, nickName) {
  const name = String(nickName || "我").trim() || "我";
  if (mode === "album") return `来做${name}的专辑默契挑战`;
  if (mode === "top9") return `来做${name}的同担 Top 挑战`;
  if (mode === "color") return `来做${name}的颜色推歌挑战`;
  if (mode === "qa") return `来填${name}的歌单问答`;
  return `来做${name}的音乐默契挑战`;
}

function getProfileInitial(profile) {
  return String((profile || {}).nickName || "音").slice(0, 1);
}

function resolveCloudFileUrl(fileID) {
  if (!fileID || String(fileID).indexOf("cloud://") !== 0 || !wx.cloud || !wx.cloud.getTempFileURL) {
    return Promise.resolve(fileID || "");
  }
  return wx.cloud.getTempFileURL({ fileList: [fileID] })
    .then((res) => {
      const item = (res.fileList || [])[0] || {};
      return item.tempFileURL || fileID;
    })
    .catch(() => fileID);
}

function setNativeShareReady(ready) {
  const options = { menus: ["shareAppMessage", "shareTimeline"] };
  if (ready && wx.showShareMenu) {
    wx.showShareMenu(options);
  } else if (!ready && wx.hideShareMenu) {
    wx.hideShareMenu(options);
  }
}

function uniqueImages(images) {
  const seen = {};
  return images.filter((image) => {
    if (!image || seen[image]) return false;
    seen[image] = true;
    return true;
  });
}

function pickShareImages(images) {
  const picked = uniqueImages(images).slice(0, 3);
  if (!picked.length) return [];
  while (picked.length < 3) {
    picked.push(picked[0]);
  }
  return picked;
}

function collectShareCovers(app, mode) {
  const challenge = app.globalData.challenge || {};
  const choices = app.globalData.creatorChoices || challenge.creatorChoices || {};
  const draftAlbums = app.globalData.draftAlbums || [];
  const draftArtists = app.globalData.draftArtists || [];
  const albums = draftAlbums.length ? draftAlbums : (challenge.albums || []);
  const artists = draftArtists.length ? draftArtists : (challenge.artists || []);
  const choiceCovers = Object.values(choices).map((item) => item && item.cover);
  const topSongs = (app.globalData.creatorTopSongs || []).length
    ? app.globalData.creatorTopSongs
    : (challenge.creatorTopSongs || []);

  if (mode === "top9") {
    return pickShareImages(topSongs.map((item) => item && item.cover));
  }

  if (mode === "album") {
    return pickShareImages([
      ...albums.map((item) => item && item.cover),
      ...choiceCovers
    ]);
  }

  if (mode === "color") {
    return pickShareImages(choiceCovers);
  }

  if (mode === "qa") {
    return [];
  }

  return pickShareImages([
    ...choiceCovers,
    ...artists.map((item) => item && (item.avatarUrl || item.cover))
  ]);
}

function hydrateAppFromChallenge(challenge) {
  if (!challenge || !challenge.challengeId) return;
  const app = getApp();
  app.globalData.challenge = challenge;
  app.globalData.draftMode = challenge.mode || "artist";
  app.globalData.draftArtists = challenge.mode === "album"
    ? []
    : (challenge.mode === "top9" ? [challenge.topArtist].filter(Boolean) : (challenge.mode === "color" ? (challenge.colors || []) : (challenge.mode === "qa" ? (challenge.qaPrompts || []) : (challenge.artists || []))));
  app.globalData.draftAlbums = challenge.albums || [];
  app.globalData.draftColors = challenge.colors || [];
  app.globalData.draftQaPrompts = challenge.qaPrompts || [];
  app.globalData.draftTopArtist = challenge.topArtist || null;
  app.globalData.creatorChoices = challenge.creatorChoices || {};
  app.globalData.creatorTopSongs = challenge.creatorTopSongs || [];
  app.globalData.creatorProfile = challenge.creatorProfile || {};
}

function getModeTitle(mode) {
  if (mode === "album") return "专辑默契挑战";
  if (mode === "top9") return "同担 Top 挑战";
  if (mode === "color") return "颜色推歌挑战";
  if (mode === "qa") return "歌单问答";
  return "歌手默契挑战";
}

function getModeMeta(mode, isInviteLanding) {
  if (mode === "qa") return isInviteLanding ? "9 个音乐题目，快来接受挑战" : "9 个问题，来填一张歌单问答";
  return "只有几道题，快来测测看";
}

function getShareCopy(mode, isInviteLanding) {
  if (mode === "top9") return "";
  if (mode === "qa") return isInviteLanding ? "" : "我做了一张歌单问答表";
  return pickShareCopy();
}

function getShareHeadline(mode, isInviteLanding) {
  if (isInviteLanding) {
    if (mode === "top9") return "来完成这个同担 Top 挑战。";
    if (mode === "color") return "来完成这个颜色推歌挑战。";
    if (mode === "qa") return "朋友发来了9个音乐题目。";
    if (mode === "album") return "来完成这组专辑选择。";
    return "来完成这组音乐选择题。";
  }
  if (mode === "top9") return "把你的同担 Top 发给朋友。";
  if (mode === "color") return "把你的颜色推歌发给朋友。";
  if (mode === "qa") return "把这张歌单问答发给朋友。";
  return "把这几个音乐选择题发给朋友。";
}

function getShareDescription(mode, isInviteLanding) {
  if (isInviteLanding) {
    return "点击开始作答，进入小程序，来接受挑战吧。";
  }
  return "点击分享给好友的按钮分享给朋友或群聊，也可以点击右上角三个点分享到朋友圈，让朋友一起来参与。";
}

function readImageInfo(src) {
  if (!src) return Promise.resolve({ path: "", width: 0, height: 0 });

  const read = (imageSrc) => new Promise((resolve) => {
    wx.getImageInfo({
      src: imageSrc,
      success: (res) => resolve({
        path: res.path,
        width: res.width || 0,
        height: res.height || 0,
        src
      }),
      fail: (error) => resolve({ path: "", width: 0, height: 0, src, errMsg: error && error.errMsg })
    });
  });

  const downloadAndRead = (imageSrc) => new Promise((resolve) => {
    if (!/^https?:\/\//.test(imageSrc) || !wx.downloadFile) {
      resolve({ path: "", width: 0, height: 0, src, errMsg: "download unavailable" });
      return;
    }
    wx.downloadFile({
      url: imageSrc,
      success: (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          resolve({ path: "", width: 0, height: 0, src, errMsg: `download ${res.statusCode}` });
          return;
        }
        read(res.tempFilePath || "").then(resolve);
      },
      fail: (error) => resolve({ path: "", width: 0, height: 0, src, errMsg: error && error.errMsg })
    });
  });

  if (src.indexOf("cloud://") === 0 && wx.cloud) {
    return wx.cloud.downloadFile({ fileID: src })
      .then((res) => read(res.tempFilePath || ""))
      .catch((error) => ({ path: "", width: 0, height: 0, src, errMsg: error && error.errMsg }));
  }

  return read(src).then((image) => (image.path ? image : downloadAndRead(src)));
}

function readImageInfoWithTimeout(src, timeout = 8000) {
  return Promise.race([
    readImageInfo(src),
    new Promise((resolve) => {
      setTimeout(() => resolve({ path: "", width: 0, height: 0, src, errMsg: "timeout" }), timeout);
    })
  ]);
}

function countDrawableImages(images) {
  return images.filter((image) => image && image.path).length;
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

function strokeRoundRect(ctx, x, y, width, height, radius, color, lineWidth) {
  drawRoundRectPath(ctx, x, y, width, height, radius);
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(lineWidth);
  ctx.stroke();
}

function drawImageCover(ctx, image, x, y, width, height) {
  const path = image && image.path;
  const sourceWidth = image && image.width;
  const sourceHeight = image && image.height;
  if (!path) return false;

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
    return true;
  }

  ctx.drawImage(path, x, y, width, height);
  return true;
}

function drawCircleImage(ctx, image, x, y, size, fallbackText) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.setFillStyle("#171512");
  ctx.fill();
  ctx.clip();
  const didDraw = drawImageCover(ctx, image, x, y, size, size);
  if (!didDraw) {
    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(30);
    ctx.fillText(fallbackText, x + 24, y + 50);
  }
  ctx.restore();
}

function drawCoverCard(ctx, image, x, y, size, fallbackText) {
  fillRoundRect(ctx, x + 10, y + 12, size, size, 14, "rgba(0,0,0,.14)");

  ctx.save();
  drawRoundRectPath(ctx, x, y, size, size, 12);
  ctx.clip();
  ctx.setFillStyle("#e9e1d7");
  ctx.fillRect(x, y, size, size);
  const didDraw = drawImageCover(ctx, image, x, y, size, size);
  if (!didDraw) {
    if (fallbackText === "?") {
      drawQuestionBlock(ctx, x, y, size);
      ctx.restore();
      strokeRoundRect(ctx, x, y, size, size, 12, "#efe8dd", 4);
      return;
    }
    ctx.setFillStyle("#dfeee3");
    ctx.fillRect(x, y, size, size);
    ctx.setFillStyle("#1f7a48");
    ctx.setFontSize(28);
    ctx.fillText(fallbackText, x + 38, y + 106);
  }
  ctx.restore();
  strokeRoundRect(ctx, x, y, size, size, 12, "#efe8dd", 4);
}

function drawQuestionBlock(ctx, x, y, size) {
  ctx.setFillStyle("#f4b536");
  ctx.fillRect(x, y, size, size);
  ctx.setFillStyle("#f9d06c");
  ctx.fillRect(x + 16, y + 14, size - 32, 24);
  ctx.setFillStyle("#b56f1d");
  const dot = 16;
  [
    [x + 20, y + 20],
    [x + size - 36, y + 20],
    [x + 20, y + size - 36],
    [x + size - 36, y + size - 36]
  ].forEach((point) => ctx.fillRect(point[0], point[1], dot, dot));
  ctx.setFillStyle("#171512");
  ctx.setFontSize(Math.floor(size * .58));
  const mark = "?";
  const markWidth = ctx.measureText(mark).width;
  ctx.fillText(mark, x + (size - markWidth) / 2, y + size * .66);
}

function getWrappedLines(ctx, text, maxWidth, maxLines) {
  const chars = String(text || "").split("");
  const lines = [];
  let line = "";

  chars.forEach((char) => {
    const testLine = line + char;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      if (!maxLines || lines.length < maxLines - 1) {
        lines.push(line);
        line = char;
      }
    } else {
      line = testLine;
    }
  });

  if (line && (!maxLines || lines.length < maxLines)) lines.push(line);
  return lines;
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  getWrappedLines(ctx, text, maxWidth, maxLines).forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function drawHeavyText(ctx, text, x, y) {
  ctx.fillText(text, x, y);
  ctx.fillText(text, x + 1, y);
  ctx.fillText(text, x, y + 1);
  ctx.fillText(text, x + 1, y + 1);
}

function drawHeavyWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = getWrappedLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => {
    drawHeavyText(ctx, line, x, y + index * lineHeight);
  });
  return lines.length;
}

function drawFitText(ctx, text, x, y, maxWidth, fontSize, minFontSize) {
  let size = fontSize;
  ctx.setFontSize(size);
  while (size > minFontSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.setFontSize(size);
  }
  ctx.fillText(text, x, y);
}

function drawShareMeta(ctx, text, x, y) {
  ctx.save();
  ctx.setFillStyle("#4f4a43");
  ctx.setFontSize(30);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function makeShareImageKey(data) {
  return [
    data.challengeId || "",
    data.mode || "",
    data.shareCopy || "",
    (data.creatorProfile || {}).nickName || "",
    (data.creatorProfile || {}).avatarUrl || "",
    ...(data.covers || [])
  ].join("|");
}

Page({
  data: {
    challengeId: "",
    mode: "artist",
    modeTitle: "歌手默契挑战",
    modeMeta: "只有几道题，快来测测看",
    shareCopy: "",
    covers: [],
    creatorProfile: {
      nickName: "",
      avatarUrl: ""
    },
    creatorInitial: "音",
    creatorAvatarUrl: "",
    isInviteLanding: false,
    headline: "把这几个音乐选择题发给朋友。",
    description: "点击分享给好友的按钮分享给朋友或群聊，也可以点击右上角三个点分享到朋友圈，让朋友一起来参与。",
    shareImageUrl: "",
    timelineImageUrl: "",
    shareImageLoading: true
  },

  onLoad(options) {
    const safeOptions = options || {};
    const challengeId = safeOptions.challengeId ? decodeURIComponent(safeOptions.challengeId) : "";
    const app = getApp();
    const localChallenge = app.globalData.challenge || {};
    const hasLocalChallenge = Boolean(localChallenge.challengeId && localChallenge.challengeId === challengeId);
    if (challengeId && (safeOptions.timelineInvite || !hasLocalChallenge)) {
      this.loadInviteLanding(challengeId);
      return;
    }

    const mode = app.globalData.draftMode || ((app.globalData.challenge || {}).mode) || "artist";
    const covers = collectShareCovers(app, mode);
    setNativeShareReady(false);
    this.skipNextShowRefresh = true;
    this.setData({
      challengeId,
      mode,
      isInviteLanding: false,
      modeTitle: getModeTitle(mode),
      modeMeta: getModeMeta(mode, false),
      shareCopy: getShareCopy(mode, false),
      headline: getShareHeadline(mode, false),
      description: getShareDescription(mode, false),
      covers
    }, () => {
      this.refreshCreatorProfile();
    });
  },

  loadInviteLanding(challengeId) {
    setNativeShareReady(true);
    this.skipNextShowRefresh = true;
    this.setData({
      challengeId,
      isInviteLanding: true,
      headline: "来完成这组音乐选择题。",
      description: "点击开始作答，进入小程序，来接受挑战吧。",
      creatorAvatarUrl: "",
      shareImageUrl: "",
      shareImageLoading: true
    });
    wx.showLoading({ title: "读取挑战" });
    getChallenge(challengeId)
      .then((res) => {
        const challenge = res.challenge || {};
        hydrateAppFromChallenge(challenge);
        const mode = challenge.mode || "artist";
        const covers = collectShareCovers(getApp(), mode);
        this.setData({
          mode,
          modeTitle: getModeTitle(mode),
          modeMeta: getModeMeta(mode, true),
          shareCopy: getShareCopy(mode, true),
          headline: getShareHeadline(mode, true),
          description: getShareDescription(mode, true),
          covers,
          creatorProfile: challenge.creatorProfile || {},
          creatorInitial: getProfileInitial(challenge.creatorProfile || {}),
          creatorAvatarUrl: ""
        }, () => {
          this.resolveCreatorAvatar();
          this.createShareImage();
        });
      })
      .catch(() => {
        wx.showToast({ title: "挑战不存在", icon: "none" });
        this.setData({ shareImageLoading: false });
      })
      .finally(() => wx.hideLoading());
  },

  onShow() {
    if (this.skipNextShowRefresh) {
      this.skipNextShowRefresh = false;
      return;
    }
    if (this.data.isInviteLanding) return;
    this.refreshCreatorProfile();
  },

  refreshCreatorProfile() {
    const app = getApp();
    const challengeProfile = (app.globalData.challenge || {}).creatorProfile || {};
    const hasChallengeProfile = Boolean(challengeProfile.avatarUrl || challengeProfile.nickName);
    const creatorProfile = hasChallengeProfile ? challengeProfile : (app.globalData.creatorProfile || wx.getStorageSync("creatorProfile") || {
      nickName: "",
      avatarUrl: ""
    });
    this.usingChallengeProfile = hasChallengeProfile;
    this.setData({
      creatorProfile,
      creatorInitial: getProfileInitial(creatorProfile),
      creatorAvatarUrl: ""
    }, () => {
      this.resolveCreatorAvatar();
      if (!hasChallengeProfile) this.saveCreatorProfile();
      this.createShareImage();
    });
  },

  resolveCreatorAvatar() {
    const avatarUrl = (this.data.creatorProfile || {}).avatarUrl || "";
    const isCloudFile = String(avatarUrl).indexOf("cloud://") === 0;
    if (!avatarUrl) {
      this.setData({ creatorAvatarUrl: "" });
      return;
    }
    if (!isCloudFile) {
      this.setData({ creatorAvatarUrl: avatarUrl });
      return;
    }
    resolveCloudFileUrl(avatarUrl).then((tempUrl) => {
      if (((this.data.creatorProfile || {}).avatarUrl || "") !== avatarUrl) return;
      this.setData({ creatorAvatarUrl: tempUrl && tempUrl !== avatarUrl ? tempUrl : "" });
    });
  },

  saveCreatorProfile() {
    if (this.data.isInviteLanding) return;
    if (this.usingChallengeProfile) return;
    const creatorProfile = this.data.creatorProfile || {};
    getApp().globalData.creatorProfile = creatorProfile;
    wx.setStorageSync("creatorProfile", creatorProfile);
    if (!this.data.challengeId) return;

    updateChallengeProfile({
      challengeId: this.data.challengeId,
      creatorProfile
    }).catch(() => {});
  },

  async createShareImage() {
    const imageKey = makeShareImageKey(this.data);
    if (this.shareImageKey === imageKey && this.data.shareImageUrl) return;
    this.shareImageKey = imageKey;

    this.setData({
      shareImageUrl: "",
      timelineImageUrl: "",
      shareImageLoading: true
    });
    setNativeShareReady(false);

    const [avatarImage, ...coverImages] = await Promise.all([
      readImageInfoWithTimeout(this.data.creatorProfile.avatarUrl),
      ...this.data.covers.map((cover) => readImageInfoWithTimeout(cover))
    ]);

    if (this.shareImageKey !== imageKey) return;
    if (this.data.covers.length && !countDrawableImages(coverImages)) {
      console.warn("Share cover images were not drawable on canvas", coverImages);
      this.setData({
        shareImageUrl: this.data.covers[0],
        timelineImageUrl: this.data.covers[0],
        shareImageLoading: false
      });
      setNativeShareReady(true);
      return;
    }
    this.drawShareCanvas(avatarImage, coverImages, imageKey, () => {
      this.drawTimelineCanvas(coverImages, imageKey);
    });
  },

  drawShareCanvas(avatarImage, coverImages, imageKey, callback) {
    if (this.data.mode === "top9") {
      this.drawTop9ShareCanvas(avatarImage, coverImages, imageKey, callback);
      return;
    }

    const ctx = wx.createCanvasContext("shareCanvas", this);
    const width = 1000;
    const height = 800;

    ctx.setFillStyle("#fbfaf7");
    ctx.fillRect(0, 0, width, height);
    fillRoundRect(ctx, 42, 48, 916, 704, 24, "#fffdfa");
    strokeRoundRect(ctx, 42, 48, 916, 704, 24, "#efe8dd", 10);
    fillRoundRect(ctx, 72, 84, 856, 624, 22, "#f7f2eb");

    const nickname = this.data.creatorProfile.nickName || "匿名挑战者";
    drawCircleImage(ctx, avatarImage, 112, 118, 78, nickname.slice(0, 1) || "我");
    ctx.setFillStyle("#171512");
    ctx.setFontSize(28);
    drawFitText(ctx, nickname, 210, 164, 360, 28, 20);

    fillRoundRect(ctx, 706, 118, 182, 50, 8, "#dfeee3");
    ctx.setFillStyle("#1f7a48");
    ctx.setFontSize(23);
    ctx.fillText(this.data.modeTitle, 724, 151);

    const labels = this.data.mode === "album" ? ["Album", "Pick", "Music"] : (this.data.mode === "color" ? ["Color", "Cover", "Song"] : (this.data.mode === "qa" ? ["?", "?", "?"] : ["Live", "Album", "Music"]));
    const cards = [
      { x: 686, y: 248, image: coverImages[2], label: labels[0] },
      { x: 608, y: 302, image: coverImages[1], label: labels[1] },
      { x: 530, y: 356, image: coverImages[0], label: labels[2] }
    ];
    cards.forEach((card) => {
      drawCoverCard(ctx, card.image, card.x, card.y, 196, card.label);
    });

    ctx.save();
    ctx.setFillStyle("#171512");
    ctx.setFontSize(58);
    const headlineLineCount = drawHeavyWrappedText(ctx, this.data.shareCopy, 112, 318, 400, 76, 4);
    ctx.restore();

    drawShareMeta(ctx, this.data.modeMeta, 112, 552);

    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: "shareCanvas",
        width,
        height,
        destWidth: width,
        destHeight: height,
        success: (res) => {
          if (imageKey && this.shareImageKey !== imageKey) return;
          const nextData = { shareImageUrl: res.tempFilePath };
          if (!callback) nextData.shareImageLoading = false;
          this.setData(nextData);
          if (!callback) setNativeShareReady(true);
        },
        fail: () => this.setData({ shareImageLoading: false }),
        complete: () => {
          if (callback) callback();
        }
      }, this);
    });
  },

  drawTop9ShareCanvas(avatarImage, coverImages, imageKey, callback) {
    const ctx = wx.createCanvasContext("shareCanvas", this);
    const width = 1000;
    const height = 800;
    const nickname = this.data.creatorProfile.nickName || "匿名挑战者";
    const challenge = getApp().globalData.challenge || {};
    const artist = getApp().globalData.draftTopArtist || challenge.topArtist || {};
    const artistName = artist.name || "同担歌手";

    ctx.setFillStyle("#fbfaf7");
    ctx.fillRect(0, 0, width, height);
    fillRoundRect(ctx, 42, 48, 916, 704, 24, "#fffdfa");
    strokeRoundRect(ctx, 42, 48, 916, 704, 24, "#efe8dd", 10);
    fillRoundRect(ctx, 72, 84, 856, 624, 22, "#f7f2eb");

    drawCircleImage(ctx, avatarImage, 112, 118, 78, nickname.slice(0, 1) || "我");
    ctx.setFillStyle("#171512");
    ctx.setFontSize(28);
    drawFitText(ctx, nickname, 210, 164, 330, 28, 20);

    fillRoundRect(ctx, 684, 118, 204, 50, 8, "#dfeee3");
    ctx.setFillStyle("#1f7a48");
    ctx.setFontSize(23);
    ctx.fillText("同担 Top 挑战", 704, 151);

    ctx.setFontSize(60);
    const top9TitleLines = getWrappedLines(ctx, `${artistName} Top`, 358, 2);
    ctx.save();
    ctx.setFillStyle("#171512");
    ctx.setFontSize(60);
    top9TitleLines.forEach((line, index) => {
      drawHeavyText(ctx, line, 112, 292 + index * 72);
    });
    drawHeavyText(ctx, "大挑战！", 112, 292 + top9TitleLines.length * 72);
    ctx.restore();

    const cards = [
      { x: 686, y: 248, image: coverImages[2], label: "Top 3" },
      { x: 608, y: 302, image: coverImages[1], label: "Top 2" },
      { x: 530, y: 356, image: coverImages[0], label: "Top 1" }
    ];
    cards.forEach((card) => {
      drawCoverCard(ctx, card.image, card.x, card.y, 196, card.label);
    });

    drawShareMeta(ctx, "只有几道题，快来测测看", 112, 552);

    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: "shareCanvas",
        width,
        height,
        destWidth: width,
        destHeight: height,
        success: (res) => {
          if (imageKey && this.shareImageKey !== imageKey) return;
          const nextData = { shareImageUrl: res.tempFilePath };
          if (!callback) nextData.shareImageLoading = false;
          this.setData(nextData);
          if (!callback) setNativeShareReady(true);
        },
        fail: () => this.setData({ shareImageLoading: false }),
        complete: () => {
          if (callback) callback();
        }
      }, this);
    });
  },

  drawTimelineCanvas(coverImages, imageKey) {
    const ctx = wx.createCanvasContext("timelineCanvas", this);
    const width = 1000;
    const height = 1000;
    const cardSize = 420;
    const cards = this.data.mode === "qa"
      ? [
          { x: 222, y: 352, image: null, label: "?", rotate: -7 },
          { x: 340, y: 282, image: null, label: "?", rotate: 0 },
          { x: 458, y: 352, image: null, label: "?", rotate: 7 }
        ]
      : [
          { x: 222, y: 352, image: coverImages[0], label: "Music", rotate: -7 },
          { x: 340, y: 282, image: coverImages[1], label: "Pick", rotate: 0 },
          { x: 458, y: 352, image: coverImages[2], label: "Album", rotate: 7 }
        ];

    ctx.setFillStyle("#fbfaf7");
    ctx.fillRect(0, 0, width, height);
    fillRoundRect(ctx, 74, 74, 852, 852, 28, "#f7f2eb");
    strokeRoundRect(ctx, 74, 74, 852, 852, 28, "#efe8dd", 12);

    cards.forEach((card) => {
      ctx.save();
      ctx.translate(card.x + cardSize / 2, card.y + cardSize / 2);
      ctx.rotate((card.rotate * Math.PI) / 180);
      drawCoverCard(ctx, card.image, -cardSize / 2, -cardSize / 2, cardSize, card.label);
      ctx.restore();
    });

    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: "timelineCanvas",
        width,
        height,
        destWidth: width,
        destHeight: height,
        success: (res) => {
          if (imageKey && this.shareImageKey !== imageKey) return;
          this.setData({ timelineImageUrl: res.tempFilePath });
        },
        complete: () => {
          if (imageKey && this.shareImageKey !== imageKey) return;
          this.setData({ shareImageLoading: false });
          setNativeShareReady(true);
        }
      }, this);
    });
  },

  onShareAppMessage() {
    if (!this.data.isInviteLanding) this.saveCreatorProfile();
    const nickName = (this.data.creatorProfile || {}).nickName || "我";
    return {
      title: getInviteShareTitle(this.data.mode, nickName),
      path: `/pages/friend/friend?challengeId=${this.data.challengeId}`,
      imageUrl: this.data.shareImageUrl || ""
    };
  },

  onShareTimeline() {
    if (!this.data.isInviteLanding) this.saveCreatorProfile();
    const nickName = (this.data.creatorProfile || {}).nickName || "我";
    return {
      title: getInviteShareTitle(this.data.mode, nickName),
      query: `timelineInvite=1&challengeId=${encodeURIComponent(this.data.challengeId)}`,
      imageUrl: this.data.timelineImageUrl || this.data.shareImageUrl || ""
    };
  },

  createNew() {
    wx.reLaunch({ url: "/pages/home/home" });
  },

  startAnswer() {
    if (!this.data.challengeId) {
      wx.showToast({ title: "挑战不存在", icon: "none" });
      return;
    }
    wx.reLaunch({
      url: `/pages/friend/friend?challengeId=${encodeURIComponent(this.data.challengeId)}`
    });
  }
});
