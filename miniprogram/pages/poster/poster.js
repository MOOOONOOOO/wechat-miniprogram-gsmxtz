const { getMiniProgramCode } = require("../../utils/api");
const { pickResultCopy } = require("../../utils/resultCopy");

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

function drawRoundImage(ctx, path, x, y, size, fallbackText) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.setFillStyle("#171512");
  ctx.fill();
  ctx.clip();
  if (path) {
    ctx.drawImage(path, x, y, size, size);
  } else {
    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(28);
    ctx.fillText(fallbackText, x + 22, y + 46);
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
    top9LeftTitle: "我的 Top9",
    top9RightTitle: "友的 Top9",
    top9LeftSongs: [],
    top9RightSongs: [],
    top9PosterLeftSongs: [],
    top9PosterRightSongs: [],
    top9MatchedText: "",
    topRankMatches: [],
    matchedCount: 0,
    missedCount: 0,
    modeTitle: "歌手默契挑战",
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
    creatorAvatarUrl: "",
    friendAvatarUrl: "",
    friendAvatarText: "友"
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
        ? `${(topArtist.name) || "同担歌手"} Top9 默契结果`
        : "你们的音乐品味契合结果",
      creatorTopSongs,
      friendTopSongs,
      matchedSongs,
      top9PosterMatches: matchedSongs.slice(0, 5),
      top9LeftTitle: result.top9LeftTitle || "我的 Top9",
      top9RightTitle: result.top9RightTitle || "友的 Top9",
      top9LeftSongs,
      top9RightSongs,
      top9PosterLeftSongs: top9LeftSongs.slice(0, 9),
      top9PosterRightSongs: top9RightSongs.slice(0, 9),
      top9MatchedText: matchedSongs.map((item) => item.name).join("、") || "这次没有重复歌曲，但也算一种品味边界。",
      topRankMatches: result.topRankMatches || [],
      matchedCount: (result.matched || []).length,
      missedCount: (result.missed || []).length,
      modeTitle: mode === "album" ? "专辑默契挑战" : (mode === "top9" ? "同担 Top9 挑战" : (mode === "color" ? "颜色推歌挑战" : "歌手默契挑战")),
      creatorProfile,
      friendProfile,
      creatorAvatarUrl: "",
      friendAvatarUrl: "",
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

  async drawPoster() {
    if (this.data.mode === "top9") return this.drawTop9Poster();

    const width = 750;
    const comparisons = this.data.comparisons.slice(0, 9);
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
    const ctx = wx.createCanvasContext("posterCanvas", this);
    const tileW = 190;
    const gapX = 24;
    const labelTopGap = 30;
    const labelLineHeight = 30;
    const labelFontSize = 24;
    const labelMaxLines = 2;
    const rowGap = 40;
    const startX = 54;
    const startY = 320;
    const rowLayouts = [];
    let cursorY = startY;

    ctx.setFontSize(labelFontSize);
    const rowCount = Math.ceil(comparisons.length / 3);
    for (let row = 0; row < rowCount; row += 1) {
      const rowItems = comparisons
        .map((item, index) => ({ item, index }))
        .filter(({ index }) => Math.floor(index / 3) === row);
      const rowTextHeight = Math.max(
        labelLineHeight,
        ...rowItems.map(({ item }) => (
          getClampedLines(ctx, ((item.artist || {}).name) || "", tileW, labelMaxLines).length * labelLineHeight
        ))
      );
      rowItems.forEach(({ item, index }) => {
        const col = index % 3;
        rowLayouts.push({
          item,
          index,
          x: startX + col * (tileW + gapX),
          y: cursorY
        });
      });
      cursorY += tileW + labelTopGap + rowTextHeight + rowGap;
    }

    const gridBottom = rowLayouts.length ? cursorY - rowGap : startY;
    const footerTop = Math.ceil(gridBottom + 50);
    const height = Math.max(1280, footerTop + 220);

    ctx.setFillStyle("#f6f0e7");
    ctx.fillRect(0, 0, width, height);
    ctx.setFillStyle("#fffdf8");
    ctx.fillRect(28, 28, width - 56, height - 56);

    drawRoundImage(ctx, creatorAvatar, 54, 70, 62, "发");
    drawRoundImage(ctx, friendAvatar, 100, 70, 62, "我");
    ctx.setFillStyle("#171512");
    ctx.setFontSize(30);
    ctx.fillText(this.data.modeTitle, 500, 112);

    ctx.setFontSize(50);
    drawWrappedText(ctx, "你们的音乐品味契合结果", 54, 194, 620, 60, 2);

    ctx.setFontSize(88);
    ctx.setFillStyle("#171512");
    const scoreText = `${this.data.score}%`;
    const scoreX = 54;
    const scoreBaseline = 306;
    ctx.fillText(scoreText, scoreX, scoreBaseline);

    const headlineRight = 674;
    const quoteX = scoreX + ctx.measureText(scoreText).width + 20;
    const quoteMaxWidth = Math.max(250, headlineRight - quoteX);
    ctx.setFillStyle("#6f6961");
    ctx.setFontSize(26);
    drawCenteredWrappedText(ctx, `“${this.data.resultCopy}”`, quoteX, 272, quoteMaxWidth, 30, 3);

    rowLayouts.forEach(({ item, index, x, y }) => {
      const coverImage = coverImages[index];
      ctx.setFillStyle("#171512");
      ctx.fillRect(x, y, tileW, tileW);
      drawSquareImage(ctx, coverImage, x, y, tileW);

      drawBadge(ctx, x + tileW - 86, y, item.matched);

      drawClampedText(ctx, (item.artist || {}).name || "", x, y + tileW + labelTopGap, tileW, 30, 2, 24, "#171512");
    });

    ctx.setFillStyle("#ffffff");
    ctx.fillRect(546, footerTop, 152, 152);
    if (qrPath) ctx.drawImage(qrPath, 554, footerTop + 8, 136, 136);
    ctx.setFillStyle("#171512");
    ctx.setFontSize(30);
    ctx.fillText("在这个混乱的世代感谢还有音乐。", 54, footerTop + 184);
    ctx.setFillStyle("#6f6961");
    ctx.setFontSize(15);
    ctx.fillText("扫码和朋友一起玩", 560, footerTop + 184);

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
    const width = 750;
    const height = 1600;
    const matchRows = this.data.top9PosterMatches.slice(0, 5);
    const leftSongs = this.data.top9PosterLeftSongs.slice(0, 9);
    const rightSongs = this.data.top9PosterRightSongs.slice(0, 9);
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
    const ctx = wx.createCanvasContext("posterCanvas", this);
    const artistName = (this.data.topArtist || {}).name || "同担歌手";

    ctx.setFillStyle("#f6f0e7");
    ctx.fillRect(0, 0, width, height);
    ctx.setFillStyle("#fffdf8");
    ctx.fillRect(28, 28, width - 56, height - 56);

    drawRoundImage(ctx, creatorAvatar, 54, 70, 62, "发");
    drawRoundImage(ctx, friendAvatar, 100, 70, 62, "我");
    ctx.setFillStyle("#171512");
    ctx.setFontSize(30);
    ctx.fillText("同担 Top9 挑战", 500, 112);

    const titleText = `${artistName} Top9 默契结果`;
    ctx.setFontSize(48);
    const titleLines = getWrappedLines(ctx, titleText, 642, 2);
    titleLines.forEach((line, index) => {
      ctx.fillText(line, 54, 198 + index * 56);
    });

    const heroTop = 230 + (titleLines.length - 1) * 56;
    drawCoverBox(ctx, artistImage, 514, heroTop + 24, 162, 14);
    if (!artistImage.path) {
      ctx.setFillStyle("#171512");
      ctx.setFontSize(64);
      ctx.fillText(artistName.slice(0, 1) || "音", 566, heroTop + 126);
    }

    ctx.setFontSize(86);
    ctx.setFillStyle("#171512");
    ctx.fillText(`${this.data.score}%`, 54, heroTop + 124);
    ctx.setFillStyle("#6f6961");
    ctx.setFontSize(28);
    drawWrappedText(ctx, `“${this.data.resultCopy}”`, 54, heroTop + 170, 420, 38, 1);

    const pillY = heroTop + 210;
    fillRoundRect(ctx, 54, pillY, 218, 46, 8, "#e8f2ea");
    ctx.setFillStyle("#171512");
    ctx.setFontSize(26);
    ctx.fillText("共同选择", 78, pillY + 31);
    ctx.setFillStyle("#3d7f5a");
    ctx.setFontSize(28);
    ctx.fillText(`${this.data.matchedSongs.length}/9`, 198, pillY + 31);

    const sharedY = pillY + 72;
    const matchRowGap = 62;
    const sharedHeight = matchRows.length
      ? 88 + matchRows.length * matchRowGap
      : 136;
    fillRoundRect(ctx, 54, sharedY, 642, sharedHeight, 12, "#e8f2ea");
    ctx.setFillStyle("#171512");
    ctx.setFontSize(32);
    ctx.fillText("你们都选了", 78, sharedY + 48);

    if (!matchRows.length) {
      ctx.setFillStyle("#5c554d");
      ctx.setFontSize(26);
      drawWrappedText(ctx, "这次没有重复歌曲，但也算一种品味边界。", 78, sharedY + 96, 590, 34, 2);
    }

    matchRows.forEach((song, index) => {
      const y = sharedY + 94 + index * matchRowGap;
      if (index > 0) {
        ctx.setStrokeStyle("rgba(23,21,18,.1)");
        ctx.setLineWidth(1);
        ctx.beginPath();
        ctx.moveTo(132, y - 44);
        ctx.lineTo(660, y - 44);
        ctx.stroke();
      }
      drawCoverBox(ctx, matchImages[index], 78, y - 32, 42, 6);
      ctx.setFillStyle("#171512");
      drawEllipsizedText(ctx, song.name || "", 140, y, 280, 24);
      ctx.setFillStyle("#3d7f5a");
      ctx.setFontSize(22);
      ctx.fillText(`你 #${song.viewerRank || "-"} / 友 #${song.otherRank || "-"}`, 440, y);
      if (song.rankHitText) {
        ctx.setFillStyle("#6f6961");
        drawEllipsizedText(ctx, song.rankHitText, 140, y + 30, 420, 18);
      }
    });

    const compareY = sharedY + sharedHeight + 26;
    const colW = 300;
    const colH = 452;
    fillRoundRect(ctx, 54, compareY, colW, colH, 10, "#fffdf8");
    fillRoundRect(ctx, 396, compareY, colW, colH, 10, "#fffdf8");
    ctx.setStrokeStyle("rgba(23,21,18,.12)");
    ctx.strokeRect(54, compareY, colW, colH);
    ctx.strokeRect(396, compareY, colW, colH);
    ctx.setFillStyle("#171512");
    ctx.setFontSize(26);
    ctx.fillText(this.data.top9LeftTitle, 76, compareY + 42);
    ctx.fillText(this.data.top9RightTitle, 418, compareY + 42);

    const drawMiniList = (songs, imagesForSongs, x) => {
      songs.forEach((song, index) => {
        const y = compareY + 64 + index * 40;
        if (song.matched) {
          fillRoundRect(ctx, x - 8, y - 5, 254, 36, 6, "rgba(61,127,90,.11)");
        }
        fillRoundRect(ctx, x, y, 26, 26, 13, "rgba(61,127,90,.16)");
        ctx.setFillStyle("#3d7f5a");
        ctx.setFontSize(16);
        ctx.fillText(String(song.rank || index + 1), x + (Number(song.rank || index + 1) >= 10 ? 5 : 9), y + 19);
        drawCoverBox(ctx, imagesForSongs[index], x + 38, y - 3, 32, 5);
        ctx.setFillStyle("#171512");
        drawEllipsizedText(ctx, song.name || "", x + 82, y + 20, 166, 18);
      });
    };
    drawMiniList(leftSongs, leftImages, 76);
    drawMiniList(rightSongs, rightImages, 418);

    const footerTop = compareY + colH + 30;
    ctx.setFillStyle("#ffffff");
    ctx.fillRect(544, footerTop, 152, 152);
    if (qrPath) ctx.drawImage(qrPath, 552, footerTop + 8, 136, 136);
    ctx.setFillStyle("#171512");
    ctx.setFontSize(30);
    ctx.fillText("在这个混乱的世代感谢还有音乐。", 54, footerTop + 126);
    ctx.setFillStyle("#6f6961");
    ctx.setFontSize(15);
    ctx.fillText("扫码和朋友一起玩", 558, footerTop + 178);

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
