const { getMiniProgramCode } = require("../../utils/api");
const { pickResultCopy } = require("../../utils/resultCopy");

const POSTER_WIDTH = 750;
const PAGE_PADDING = 18;
const POSTER_PAD_X = 28;
const POSTER_PAD_TOP = 34;
const POSTER_PAD_BOTTOM = 42;
const CONTENT_X = PAGE_PADDING + POSTER_PAD_X;
const CONTENT_RIGHT = POSTER_WIDTH - PAGE_PADDING - POSTER_PAD_X;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_X;

function friendProfileKey(challengeId) {
  return challengeId ? `friendProfile:${challengeId}` : "friendProfile";
}

function rankLabel(rank) {
  return ["", "一", "二", "三"][Number(rank)] || String(rank || "");
}

function pickTopArtistCover(topArtist, ...songGroups) {
  const artist = topArtist || {};
  const directCover = artist.avatarUrl || artist.cover || artist.coverUrl || artist.artworkUrl600 || artist.artworkUrl100 || "";
  if (directCover) return directCover;

  const songs = songGroups.reduce((list, group) => list.concat(Array.isArray(group) ? group : []), []);
  const coverSong = songs.find((song) => song && song.cover);
  return (coverSong && coverSong.cover) || "";
}

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

function isUsableAvatarUrl(url) {
  const value = String(url || "").trim();
  return value.indexOf("cloud://") === 0
    || value.indexOf("wxfile://") === 0
    || /^https?:\/\//i.test(value);
}

function avatarImageSource(resolvedUrl, originalUrl) {
  const value = resolvedUrl || originalUrl || "";
  return isUsableAvatarUrl(value) ? value : "";
}

function resolveCloudFileUrl(fileID) {
  if (!fileID || !isCloudFileUrl(fileID) || !wx.cloud || !wx.cloud.getTempFileURL) {
    return Promise.resolve(fileID || "");
  }
  return wx.cloud.getTempFileURL({ fileList: [fileID] })
    .then((res) => {
      const item = (res.fileList || [])[0] || {};
      return item.tempFileURL || fileID;
    })
    .catch(() => fileID);
}

function getImageInfo(src) {
  if (!src) return Promise.resolve({ path: "", width: 0, height: 0 });
  const readInfo = (imageSrc) => new Promise((resolve) => {
    wx.getImageInfo({
      src: imageSrc,
      success: (res) => resolve({
        path: res.path,
        width: res.width || 0,
        height: res.height || 0
      }),
      fail: () => resolve({ path: "", width: 0, height: 0 })
    });
  });

  if (src.indexOf("cloud://") === 0 && wx.cloud) {
    return wx.cloud.downloadFile({ fileID: src })
      .then((res) => readInfo(res.tempFilePath || ""))
      .catch(() => ({ path: "", width: 0, height: 0 }));
  }
  return readInfo(src);
}

function drawRoundImage(ctx, path, x, y, size, fallbackText, fallbackColor = "#171512") {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.setFillStyle(fallbackColor);
  ctx.fill();
  ctx.clip();
  if (path) {
    ctx.drawImage(path, x, y, size, size);
  } else {
    const text = String(fallbackText || "").slice(0, 1);
    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(Math.max(18, Math.floor(size * 0.42)));
    const textWidth = ctx.measureText(text).width;
    ctx.fillText(text, x + (size - textWidth) / 2, y + size * 0.66);
  }
  ctx.restore();
}

function drawSquareImage(ctx, image, x, y, size) {
  const path = image && image.path;
  const sourceWidth = image && image.width;
  const sourceHeight = image && image.height;
  if (!path) return;

  if (sourceWidth && sourceHeight) {
    const sourceSize = Math.min(sourceWidth, sourceHeight);
    const sx = Math.max(0, (sourceWidth - sourceSize) / 2);
    const sy = Math.max(0, (sourceHeight - sourceSize) / 2);
    ctx.drawImage(path, sx, sy, sourceSize, sourceSize, x, y, size, size);
    return;
  }

  ctx.drawImage(path, x, y, size, size);
}

function drawCoverBox(ctx, image, x, y, size, radius = 0) {
  ctx.save();
  if (radius) {
    drawRoundRectPath(ctx, x, y, size, size, radius);
    ctx.clip();
  }
  ctx.setFillStyle("#efe8dd");
  ctx.fillRect(x, y, size, size);
  drawSquareImage(ctx, image, x, y, size);
  ctx.restore();
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

function getWrappedLines(ctx, text, maxWidth, maxLines) {
  const chars = String(text || "").split("");
  const lines = [];
  let line = "";

  for (let i = 0; i < chars.length; i += 1) {
    const testLine = line + chars[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      if (maxLines && lines.length >= maxLines - 1) {
        lines.push(line);
        return lines;
      }
      lines.push(line);
      line = chars[i];
    } else {
      line = testLine;
    }
  }

  if (line && (!maxLines || lines.length < maxLines)) {
    lines.push(line);
  }
  return lines;
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = getWrappedLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function drawCenteredWrappedText(ctx, text, x, centerY, maxWidth, lineHeight, maxLines) {
  const lines = getWrappedLines(ctx, text, maxWidth, maxLines);
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2 + 10;
  lines.forEach((line, index) => {
    ctx.fillText(line, x, firstY + index * lineHeight);
  });
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

function drawEllipsizedText(ctx, text, x, y, maxWidth, fontSize) {
  ctx.setFontSize(fontSize);
  ctx.fillText(ellipsizeCanvasText(ctx, text, maxWidth), x, y);
}

function drawPosterPairHead(ctx, creatorAvatar, friendAvatar, data, modeTitle) {
  const creatorName = ((data.creatorProfile || {}).nickName) || data.creatorName || "周同学";
  const friendName = ((data.friendProfile || {}).nickName) || data.friendName || "小夏";
  const creatorInitial = data.creatorAvatarText || creatorName.slice(0, 1) || "发";
  const friendInitial = data.friendAvatarText || friendName.slice(0, 1) || "友";
  const y = PAGE_PADDING + POSTER_PAD_TOP;
  const avatarSize = 58;
  const modeText = String(modeTitle || "");

  ctx.setFillStyle("#171512");
  ctx.setFontSize(30);
  const modeWidth = ctx.measureText(modeText).width;
  const modeX = CONTENT_RIGHT - modeWidth;
  ctx.fillText(modeText, modeX, y + 39);

  drawRoundImage(ctx, creatorAvatar, CONTENT_X, y, avatarSize, creatorInitial, "#171512");
  ctx.setFillStyle("#171512");
  ctx.setFontSize(20);
  ctx.fillText("×", CONTENT_X + avatarSize + 10, y + 37);
  drawRoundImage(ctx, friendAvatar, CONTENT_X + avatarSize + 26, y, avatarSize, friendInitial, "#3d7f5a");

  ctx.setFillStyle("#171512");
  drawEllipsizedText(ctx, `${creatorName} × ${friendName}`, CONTENT_X + avatarSize * 2 + 40, y + 38, Math.max(120, modeX - (CONTENT_X + avatarSize * 2 + 58)), 28);
}

function getClampedLines(ctx, text, maxWidth, maxLines) {
  const chars = String(text || "").split("");
  const lines = [];
  let line = "";

  for (let index = 0; index < chars.length; index += 1) {
    const testLine = line + chars[index];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = chars[index];
      if (lines.length >= maxLines - 1) {
        const rest = `${line}${chars.slice(index + 1).join("")}`;
        lines.push(ellipsizeCanvasText(ctx, rest, maxWidth));
        return lines;
      }
    } else {
      line = testLine;
    }
  }

  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function drawClampedText(ctx, text, x, y, maxWidth, lineHeight, maxLines, fontSize, fillStyle) {
  if (fillStyle) ctx.setFillStyle(fillStyle);
  ctx.setFontSize(fontSize);
  getClampedLines(ctx, text, maxWidth, maxLines).forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function drawBadge(ctx, x, y, matched) {
  ctx.setFillStyle(matched ? "#3d7f5a" : "rgba(106,103,100,.86)");
  ctx.fillRect(x, y, 86, 38);
  ctx.setFillStyle("#171512");
  ctx.setFontSize(21);
  ctx.fillText(matched ? "✓ 契合" : "× 不同", x + 9, y + 26);
}

function drawPosterShell(ctx, height) {
  ctx.setFillStyle("#f6f0e7");
  ctx.fillRect(0, 0, POSTER_WIDTH, height);
  ctx.setFillStyle("#fffdf8");
  ctx.fillRect(PAGE_PADDING, PAGE_PADDING, POSTER_WIDTH - PAGE_PADDING * 2, height - PAGE_PADDING * 2);
}

function drawPosterFooter(ctx, qrPath, y) {
  const qrSize = 132;
  const qrX = CONTENT_RIGHT - qrSize;
  ctx.setFillStyle("#171512");
  ctx.setFontSize(30);
  ctx.fillText("在这个混乱的世代感谢还有音乐。", CONTENT_X, y + 88);

  ctx.setFillStyle("#ffffff");
  ctx.fillRect(qrX, y, qrSize, qrSize);
  if (qrPath) ctx.drawImage(qrPath, qrX, y, qrSize, qrSize);
  ctx.setFillStyle("#6f6961");
  ctx.setFontSize(16);
  ctx.fillText("扫码和朋友一起玩", qrX + 9, y + qrSize + 22);
}

function subjectLabelForPoster(mode) {
  return mode === "album" ? "专辑" : "歌手";
}

function comparisonSubjectName(item) {
  const subject = (item && (item.artist || item.subject)) || {};
  return subject.name || "";
}

function comparisonSongName(item, key) {
  const direct = item && item[key];
  if (direct) return direct;
  const side = key === "creatorSongName" ? item.creator : item.friend;
  return (side && (side.name || side.trackName)) || "未选择";
}

function drawDetailColumn(ctx, options) {
  const {
    x,
    y,
    width,
    height,
    title,
    items,
    emptyText,
    ok,
    renderSubline
  } = options;
  const rows = items;

  fillRoundRect(ctx, x, y, width, height, 12, ok ? "#e8f2ea" : "#fffdf8");
  drawRoundRectPath(ctx, x, y, width, height, 12);
  ctx.setStrokeStyle("rgba(23,21,18,.13)");
  ctx.setLineWidth(1);
  ctx.stroke();
  ctx.setFillStyle("#171512");
  ctx.setFontSize(34);
  ctx.fillText(title, x + 20, y + 48);

  if (!rows.length) {
    ctx.setFillStyle("#5f584f");
    ctx.setFontSize(22);
    drawWrappedText(ctx, emptyText, x + 20, y + 90, width - 40, 30, 2);
    return;
  }

  rows.forEach((item, index) => {
    const rowTop = y + 76 + index * 78;
    ctx.setFillStyle("#171512");
    drawEllipsizedText(ctx, comparisonSubjectName(item), x + 20, rowTop + 24, width - 40, 28);
    ctx.setFillStyle("#5f584f");
    drawEllipsizedText(ctx, renderSubline(item), x + 20, rowTop + 56, width - 40, 22);
  });

}

function drawStandardDetailColumns(ctx, data, x, y, width) {
  const matched = Array.isArray(data.matched) ? data.matched : [];
  const missed = Array.isArray(data.missed) ? data.missed : [];
  const maxRows = Math.max(1, Math.max(matched.length, missed.length));
  const height = Math.max(220, 76 + maxRows * 78);
  const gap = 18;
  const colW = (width - gap) / 2;
  const subjectLabel = subjectLabelForPoster(data.mode);
  const creatorName = data.creatorName || ((data.creatorProfile || {}).nickName) || "我";
  const friendName = data.friendName || ((data.friendProfile || {}).nickName) || "友";

  drawDetailColumn(ctx, {
    x,
    y,
    width: colW,
    height,
    title: `契合${subjectLabel}`,
    items: matched,
    emptyText: `暂时没有契合${subjectLabel}`,
    ok: true,
    renderSubline: (item) => `都选了 ${comparisonSongName(item, "friendSongName") || comparisonSongName(item, "creatorSongName")}`
  });

  drawDetailColumn(ctx, {
    x: x + colW + gap,
    y,
    width: colW,
    height,
    title: `未契合${subjectLabel}`,
    items: missed,
    emptyText: `没有未契合${subjectLabel}`,
    ok: false,
    renderSubline: (item) => `${creatorName}: ${comparisonSongName(item, "creatorSongName")} / ${friendName}: ${comparisonSongName(item, "friendSongName")}`
  });

  return height;
}

Page({
  data: {
    score: 0,
    resultCopy: "",
    comparisons: [],
    matched: [],
    missed: [],
    mode: "artist",
    topArtist: {},
    topArtistAvatar: "音",
    topArtistCover: "",
    posterHeadline: "你们的音乐品味契合结果",
    creatorTopSongs: [],
    friendTopSongs: [],
    matchedSongs: [],
    top9PosterMatches: [],
    top9LeftTitle: "我的排序",
    top9RightTitle: "友的排序",
    top9LeftSongs: [],
    top9RightSongs: [],
    top9PosterLeftSongs: [],
    top9PosterRightSongs: [],
    top9MatchedText: "",
    topRankMatches: [],
    matchTotal: 9,
    matchedCount: 0,
    missedCount: 0,
    modeTitle: "歌手默契挑战",
    subjectLabel: "歌手",
    qrCodeUrl: "",
    qrCodeFileID: "",
    creatorProfile: {
      nickName: "",
      avatarUrl: ""
    },
    friendProfile: {
      nickName: "",
      avatarUrl: ""
    },
    creatorName: "发起人",
    friendName: "朋友",
    creatorAvatarUrl: "",
    friendAvatarUrl: "",
    creatorAvatarText: "发",
    friendAvatarText: "友",
    posterCanvasWidth: 750,
    posterCanvasHeight: 1600
  },

  onLoad() {
    const app = getApp();
    const result = app.globalData.lastResult || {};
    const challengeId = (app.globalData.challenge || {}).challengeId;
    const challengeProfile = (app.globalData.challenge || {}).creatorProfile || {};
    const creatorProfile = (challengeProfile.avatarUrl || challengeProfile.nickName)
      ? challengeProfile
      : (app.globalData.creatorProfile || wx.getStorageSync("creatorProfile") || {});
    const friendProfile = app.globalData.friendProfile || wx.getStorageSync(friendProfileKey(challengeId)) || {};
    const mode = app.globalData.draftMode || ((app.globalData.challenge || {}).mode) || "artist";
    const viewerRole = result.viewerRole || "friend";
    const creatorTopSongs = result.creatorTopSongs || [];
    const friendTopSongs = result.friendTopSongs || [];
    const isCreatorViewer = viewerRole === "creator";
    const top9LeftSongs = result.top9LeftSongs || (isCreatorViewer ? creatorTopSongs : friendTopSongs);
    const top9RightSongs = result.top9RightSongs || (isCreatorViewer ? friendTopSongs : creatorTopSongs);
    const topArtist = result.topArtist || ((app.globalData.challenge || {}).topArtist) || app.globalData.draftTopArtist || {};
    const topArtistCover = result.topArtistCover || pickTopArtistCover(topArtist, top9LeftSongs, top9RightSongs, creatorTopSongs, friendTopSongs);
    const matchedSongs = (result.matchedSongs || []).map((item) => ({
      ...item,
      viewerRank: item.viewerRank || (isCreatorViewer ? item.creatorRank : item.friendRank),
      otherRank: item.otherRank || (isCreatorViewer ? item.friendRank : item.creatorRank),
      rankHitText: item.rankHitText || (item.creatorRank <= 3 && item.creatorRank === item.friendRank
        ? `你们都把这首歌排在了第${rankLabel(item.creatorRank)}位`
        : "")
    }));
    this.setData({
      score: result.score || 0,
      resultCopy: result.resultCopy || pickResultCopy(result.matchCount),
      comparisons: result.comparisons || [],
      matched: result.matched || [],
      missed: result.missed || [],
      mode,
      topArtist,
      topArtistAvatar: topArtist.name ? topArtist.name.slice(0, 1) : "音",
      topArtistCover,
      posterHeadline: mode === "top9"
        ? `${(topArtist.name) || "同担歌手"} Top 默契结果`
        : "你们的音乐品味契合结果",
      creatorTopSongs,
      friendTopSongs,
      matchedSongs,
      top9PosterMatches: matchedSongs.slice(0, 5),
      top9LeftTitle: result.top9LeftTitle || "我的排序",
      top9RightTitle: result.top9RightTitle || "友的排序",
      top9LeftSongs,
      top9RightSongs,
      top9PosterLeftSongs: top9LeftSongs,
      top9PosterRightSongs: top9RightSongs,
      top9MatchedText: matchedSongs.map((item) => item.name).join("、") || "这次没有重复歌曲，但也算一种品味边界。",
      topRankMatches: result.topRankMatches || [],
      matchedCount: (result.matched || []).length,
      missedCount: (result.missed || []).length,
      modeTitle: mode === "album" ? "专辑默契挑战" : (mode === "top9" ? "同担 Top 挑战" : (mode === "color" ? "颜色推歌挑战" : "歌手默契挑战")),
      matchTotal: result.totalCount || Math.max(top9LeftSongs.length, top9RightSongs.length, 9),
      subjectLabel: subjectLabelForPoster(mode),
      creatorProfile,
      friendProfile,
      creatorName: creatorProfile.nickName || "发起人",
      friendName: friendProfile.nickName || "朋友",
      creatorAvatarUrl: "",
      friendAvatarUrl: "",
      creatorAvatarText: (creatorProfile.nickName || "发").slice(0, 1),
      friendAvatarText: (friendProfile.nickName || "友").slice(0, 1)
    }, () => {
      this.resolveProfileAvatars();
      this.loadQrCode();
    });
  },

  resolveProfileAvatars() {
    const creatorAvatar = (this.data.creatorProfile || {}).avatarUrl || "";
    const friendAvatar = (this.data.friendProfile || {}).avatarUrl || "";
    Promise.all([
      resolveCloudFileUrl(creatorAvatar),
      resolveCloudFileUrl(friendAvatar)
    ]).then(([creatorTempUrl, friendTempUrl]) => {
      const nextData = {};
      if (((this.data.creatorProfile || {}).avatarUrl || "") === creatorAvatar) {
        const nextCreatorAvatar = isCloudFileUrl(creatorAvatar) && creatorTempUrl === creatorAvatar ? "" : (creatorTempUrl || "");
        nextData.creatorAvatarUrl = isUsableAvatarUrl(nextCreatorAvatar) ? nextCreatorAvatar : "";
      }
      if (((this.data.friendProfile || {}).avatarUrl || "") === friendAvatar) {
        const nextFriendAvatar = isCloudFileUrl(friendAvatar) && friendTempUrl === friendAvatar ? "" : (friendTempUrl || "");
        nextData.friendAvatarUrl = isUsableAvatarUrl(nextFriendAvatar) ? nextFriendAvatar : "";
      }
      this.setData(nextData);
    });
  },

  loadQrCode() {
    const challengeId = (getApp().globalData.challenge || {}).challengeId;
    const request = this.data.mode === "color"
      ? { page: "pages/home/home" }
      : challengeId;
    if (!request) return;

    getMiniProgramCode(request)
      .then((res) => {
        if (res.fileID || res.tempFileURL) {
          this.setData({
            qrCodeFileID: res.fileID || "",
            qrCodeUrl: res.fileID || res.tempFileURL
          });
        }
      })
      .catch(() => {
        wx.showToast({ title: "小程序码生成失败", icon: "none" });
      });
  },

  onChooseAvatar(event) {
    const avatarUrl = event.detail.avatarUrl;
    const friendProfile = {
      ...this.data.friendProfile,
      avatarUrl
    };
    getApp().globalData.friendProfile = friendProfile;
    wx.setStorageSync(friendProfileKey((getApp().globalData.challenge || {}).challengeId), friendProfile);
    this.setData({ friendProfile, friendAvatarUrl: avatarUrl, friendAvatarText: (friendProfile.nickName || "友").slice(0, 1) });
  },

  setPosterCanvasSize(width, height) {
    const safeWidth = Math.ceil(Number(width) || 750);
    const safeHeight = Math.ceil(Number(height) || 1600);
    if (this.data.posterCanvasWidth === safeWidth && this.data.posterCanvasHeight === safeHeight) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.setData({
        posterCanvasWidth: safeWidth,
        posterCanvasHeight: safeHeight
      }, () => {
        if (wx.nextTick) {
          wx.nextTick(resolve);
        } else {
          setTimeout(resolve, 0);
        }
      });
    });
  },

  async drawPoster() {
    if (this.data.mode === "top9") return this.drawTop9Poster();

    const width = POSTER_WIDTH;
    const comparisons = this.data.comparisons || [];
    const imageSources = [
      avatarImageSource(this.data.creatorAvatarUrl, this.data.creatorProfile.avatarUrl),
      avatarImageSource(this.data.friendAvatarUrl, this.data.friendProfile.avatarUrl),
      ...comparisons.map((item) => item.cover),
      this.data.qrCodeFileID || this.data.qrCodeUrl
    ];
    const images = await Promise.all(imageSources.map((src) => getImageInfo(src)));
    const creatorAvatar = images[0].path;
    const friendAvatar = images[1].path;
    const coverImages = images.slice(2, 2 + comparisons.length);
    const qrPath = (images[2 + comparisons.length] || {}).path;
    const measureCtx = wx.createCanvasContext("posterCanvas", this);
    const tileW = (CONTENT_WIDTH - 16) / 3;
    const gapX = 8;
    const labelTopGap = 8;
    const labelLineHeight = 28;
    const labelFontSize = 24;
    const labelMaxLines = 2;
    const rowGap = 14;
    const rowLayouts = [];
    const headerBottom = PAGE_PADDING + POSTER_PAD_TOP + 58;
    const headlineTop = headerBottom + 34;

    measureCtx.setFontSize(54);
    const headlineLines = getWrappedLines(measureCtx, "你们的音乐品味契合结果", CONTENT_WIDTH, 2);
    const headlineHeight = headlineLines.length * 62;
    const scoreRowTop = headlineTop + headlineHeight + 14;
    const gridTop = scoreRowTop + 88 + 16;
    let cursorY = gridTop;

    measureCtx.setFontSize(labelFontSize);
    const rowCount = Math.ceil(comparisons.length / 3);
    for (let row = 0; row < rowCount; row += 1) {
      const rowItems = comparisons
        .map((item, index) => ({ item, index }))
        .filter(({ index }) => Math.floor(index / 3) === row);
      const rowTextHeight = Math.max(
        labelLineHeight,
        ...rowItems.map(({ item }) => (
          getClampedLines(measureCtx, ((item.artist || {}).name) || "", tileW, labelMaxLines).length * labelLineHeight
        ))
      );
      rowItems.forEach(({ item, index }) => {
        const col = index % 3;
        rowLayouts.push({
          item,
          index,
          x: CONTENT_X + col * (tileW + gapX),
          y: cursorY
        });
      });
      cursorY += tileW + labelTopGap + rowTextHeight + rowGap;
    }

    const gridBottom = rowLayouts.length ? cursorY - rowGap : gridTop;
    const detailTop = Math.ceil(gridBottom + 28);
    const detailRows = Math.max(1, Math.max(this.data.matched.length, this.data.missed.length));
    const detailHeight = Math.max(220, 76 + detailRows * 78);
    const footerTop = Math.ceil(detailTop + detailHeight + 18);
    const height = Math.ceil(footerTop + 132 + 22 + POSTER_PAD_BOTTOM + PAGE_PADDING);
    await this.setPosterCanvasSize(width, height);
    const ctx = wx.createCanvasContext("posterCanvas", this);

    drawPosterShell(ctx, height);
    drawPosterPairHead(ctx, creatorAvatar, friendAvatar, this.data, this.data.modeTitle);

    ctx.setFillStyle("#171512");
    ctx.setFontSize(54);
    headlineLines.forEach((line, index) => {
      ctx.fillText(line, CONTENT_X, headlineTop + 54 + index * 62);
    });

    ctx.setFontSize(88);
    ctx.setFillStyle("#171512");
    const scoreText = `${this.data.score}%`;
    const scoreX = CONTENT_X;
    const scoreBaseline = scoreRowTop + 82;
    ctx.fillText(scoreText, scoreX, scoreBaseline);

    const quoteX = scoreX + ctx.measureText(scoreText).width + 20;
    const quoteMaxWidth = Math.max(250, CONTENT_RIGHT - quoteX);
    ctx.setFillStyle("#6f6961");
    ctx.setFontSize(28);
    drawCenteredWrappedText(ctx, `“${this.data.resultCopy}”`, quoteX, scoreRowTop + 45, quoteMaxWidth, 32, 3);

    rowLayouts.forEach(({ item, index, x, y }) => {
      const coverImage = coverImages[index];
      ctx.setFillStyle("#171512");
      ctx.fillRect(x, y, tileW, tileW);
      drawSquareImage(ctx, coverImage, x, y, tileW);

      drawBadge(ctx, x + tileW - 86, y, item.matched);

      drawClampedText(ctx, (item.artist || {}).name || "", x, y + tileW + labelTopGap + 24, tileW, labelLineHeight, 2, 24, "#171512");
    });

    drawStandardDetailColumns(ctx, this.data, CONTENT_X, detailTop, CONTENT_WIDTH);
    drawPosterFooter(ctx, qrPath, footerTop);

    return new Promise((resolve, reject) => {
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "posterCanvas",
          width,
          height,
          destWidth: width * 2,
          destHeight: height * 2,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this);
      });
    });
  },

  async drawTop9Poster() {
    const width = POSTER_WIDTH;
    const matchRows = this.data.top9PosterMatches.slice(0, 5);
    const leftSongs = this.data.top9PosterLeftSongs.slice();
    const rightSongs = this.data.top9PosterRightSongs.slice();
    const imageSources = [
      avatarImageSource(this.data.creatorAvatarUrl, this.data.creatorProfile.avatarUrl),
      avatarImageSource(this.data.friendAvatarUrl, this.data.friendProfile.avatarUrl),
      this.data.topArtistCover,
      ...matchRows.map((item) => item.cover),
      ...leftSongs.map((item) => item.cover),
      ...rightSongs.map((item) => item.cover),
      this.data.qrCodeFileID || this.data.qrCodeUrl
    ];
    const images = await Promise.all(imageSources.map((src) => getImageInfo(src)));
    const creatorAvatar = images[0].path;
    const friendAvatar = images[1].path;
    const artistImage = images[2];
    const matchStart = 3;
    const leftStart = matchStart + matchRows.length;
    const rightStart = leftStart + leftSongs.length;
    const qrIndex = rightStart + rightSongs.length;
    const matchImages = images.slice(matchStart, leftStart);
    const leftImages = images.slice(leftStart, rightStart);
    const rightImages = images.slice(rightStart, qrIndex);
    const qrPath = (images[qrIndex] || {}).path;
    const measureCtx = wx.createCanvasContext("posterCanvas", this);
    const artistName = (this.data.topArtist || {}).name || "同担歌手";
    const headerBottom = PAGE_PADDING + POSTER_PAD_TOP + 58;
    const heroTop = headerBottom + 34;

    measureCtx.setFontSize(50);
    const titleText = `${artistName} Top 默契结果`;
    const titleLines = getWrappedLines(measureCtx, titleText, CONTENT_WIDTH, 2);
    const titleHeight = titleLines.length * 56;
    const heroRowTop = heroTop + titleHeight + 16;
    const coverSize = 180;
    const coverX = CONTENT_RIGHT - coverSize;
    const coverY = heroRowTop + 30;
    const scoreBaseline = heroRowTop + 88;
    const quoteBaseline = scoreBaseline + 38;
    const heroBottom = Math.max(quoteBaseline + 10, coverY + coverSize);
    const pillY = heroBottom + 12;
    const pillHeight = 52;
    const summaryY = pillY + pillHeight + 24;
    const matchRowSpace = 16;
    const matchContentTop = summaryY + 20 + 34 + 18;
    let matchCursor = matchContentTop;
    const matchLayouts = matchRows.map((song) => {
      const heightForRow = song.rankHitText ? 100 : 78;
      const layout = {
        top: matchCursor,
        height: heightForRow
      };
      matchCursor += heightForRow + matchRowSpace;
      return layout;
    });
    const summaryHeight = matchRows.length
      ? Math.max(136, matchCursor - matchRowSpace - summaryY + 20)
      : 136;
    const compareY = summaryY + summaryHeight + 18;
    const compareGap = 14;
    const colW = (CONTENT_WIDTH - compareGap) / 2;
    const top9RowHeight = 50;
    const top9RowGap = 8;
    const compareRows = Math.max(leftSongs.length, rightSongs.length, 1);
    const colH = 16 + 29 + 10 + compareRows * (top9RowHeight + top9RowGap) + 8;
    const footerTop = compareY + colH + 18;
    const height = Math.ceil(footerTop + 132 + 22 + POSTER_PAD_BOTTOM + PAGE_PADDING);

    await this.setPosterCanvasSize(width, height);
    const ctx = wx.createCanvasContext("posterCanvas", this);

    drawPosterShell(ctx, height);
    drawPosterPairHead(ctx, creatorAvatar, friendAvatar, this.data, "同担 Top 挑战");

    ctx.setFillStyle("#171512");
    ctx.setFontSize(50);
    titleLines.forEach((line, index) => {
      ctx.fillText(line, CONTENT_X, heroTop + 50 + index * 56);
    });

    drawCoverBox(ctx, artistImage, coverX, coverY, coverSize, 12);
    if (!artistImage.path) {
      ctx.setFillStyle("#171512");
      ctx.setFontSize(58);
      const fallback = artistName.slice(0, 1) || "音";
      const fallbackWidth = ctx.measureText(fallback).width;
      ctx.fillText(fallback, coverX + (coverSize - fallbackWidth) / 2, coverY + 112);
    }

    ctx.setFontSize(86);
    ctx.setFillStyle("#171512");
    ctx.fillText(`${this.data.score}%`, CONTENT_X, scoreBaseline);
    ctx.setFillStyle("#6f6961");
    ctx.setFontSize(28);
    drawWrappedText(ctx, `“${this.data.resultCopy}”`, CONTENT_X, quoteBaseline, coverX - CONTENT_X - 24, 38, 1);

    fillRoundRect(ctx, CONTENT_X, pillY, 228, pillHeight, 8, "#e8f2ea");
    drawRoundRectPath(ctx, CONTENT_X, pillY, 228, pillHeight, 8);
    ctx.setStrokeStyle("rgba(61,127,90,.22)");
    ctx.stroke();
    ctx.setFillStyle("#171512");
    ctx.setFontSize(28);
    ctx.fillText("共同选择", CONTENT_X + 24, pillY + 35);
    ctx.setFillStyle("#3d7f5a");
    ctx.setFontSize(28);
    ctx.fillText(`${this.data.matchedSongs.length}/${this.data.matchTotal || 9}`, CONTENT_X + 144, pillY + 35);

    fillRoundRect(ctx, CONTENT_X, summaryY, CONTENT_WIDTH, summaryHeight, 8, "#e8f2ea");
    ctx.setFillStyle("#171512");
    ctx.setFontSize(28);
    ctx.fillText("你们都选了", CONTENT_X + 20, summaryY + 48);

    if (!matchRows.length) {
      ctx.setFillStyle("#5c554d");
      ctx.setFontSize(22);
      drawWrappedText(ctx, "这次没有重复歌曲，但也算一种品味边界。", CONTENT_X + 20, summaryY + 92, CONTENT_WIDTH - 40, 32, 2);
    }

    matchRows.forEach((song, index) => {
      const rowTop = matchLayouts[index].top;
      drawCoverBox(ctx, matchImages[index], CONTENT_X + 20, rowTop, 64, 6);
      ctx.setFillStyle("#171512");
      drawEllipsizedText(ctx, song.name || "", CONTENT_X + 98, rowTop + 27, CONTENT_WIDTH - 138, 25);
      ctx.setFillStyle("#3d7f5a");
      ctx.setFontSize(20);
      ctx.fillText(`你 #${song.viewerRank || "-"} / 友 #${song.otherRank || "-"}`, CONTENT_X + 98, rowTop + 55);
      if (song.rankHitText) {
        ctx.setFillStyle("#6f6961");
        drawEllipsizedText(ctx, song.rankHitText, CONTENT_X + 98, rowTop + 80, CONTENT_WIDTH - 138, 18);
      }
    });

    fillRoundRect(ctx, CONTENT_X, compareY, colW, colH, 8, "rgba(255,255,255,.64)");
    fillRoundRect(ctx, CONTENT_X + colW + compareGap, compareY, colW, colH, 8, "rgba(255,255,255,.64)");
    ctx.setFillStyle("#171512");
    ctx.setFontSize(24);
    drawEllipsizedText(ctx, this.data.top9LeftTitle, CONTENT_X + 16, compareY + 42, colW - 32, 24);
    drawEllipsizedText(ctx, this.data.top9RightTitle, CONTENT_X + colW + compareGap + 16, compareY + 42, colW - 32, 24);

    const drawMiniList = (songs, imagesForSongs, x) => {
      songs.forEach((song, index) => {
        const y = compareY + 64 + index * (top9RowHeight + top9RowGap);
        if (song.matched) {
          fillRoundRect(ctx, x - 6, y - 4, colW - 20, top9RowHeight, 8, "rgba(61,127,90,.11)");
        }
        fillRoundRect(ctx, x, y + 10, 30, 30, 15, "rgba(61,127,90,.14)");
        ctx.setFillStyle("#3d7f5a");
        ctx.setFontSize(17);
        const rankText = String(song.rank || index + 1);
        ctx.fillText(rankText, x + (Number(rankText) >= 10 ? 6 : 10), y + 31);
        drawCoverBox(ctx, imagesForSongs[index], x + 44, y + 4, 42, 6);
        ctx.setFillStyle("#171512");
        drawEllipsizedText(ctx, song.name || "", x + 96, y + 31, colW - 118, 20);
      });
    };
    drawMiniList(leftSongs, leftImages, CONTENT_X + 16);
    drawMiniList(rightSongs, rightImages, CONTENT_X + colW + compareGap + 16);

    drawPosterFooter(ctx, qrPath, footerTop);

    return new Promise((resolve, reject) => {
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "posterCanvas",
          width,
          height,
          destWidth: width * 2,
          destHeight: height * 2,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this);
      });
    });
  },

  savePoster() {
    wx.showLoading({ title: "绘制中..." });
    this.drawPoster()
      .then((filePath) => this.shareOrSaveImage(filePath))
      .then(() => {
        if (!this.usedImageShareMenu) wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch((error) => {
        if (error && /auth|authorize|permission/i.test(String(error.errMsg || error.message))) {
          wx.showModal({
            title: "需要相册权限",
            content: "请允许保存图片到相册。",
            success: (res) => {
              if (res.confirm) wx.openSetting();
            }
          });
          return;
        }
        wx.showToast({ title: "保存失败", icon: "none" });
      })
      .finally(() => wx.hideLoading());
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

  createNew() {
    wx.reLaunch({ url: "/pages/home/home" });
  }
});
