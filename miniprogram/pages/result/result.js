const { getChallengeMultiplayer, getMiniProgramCode, getRecentSubmission, getSharedResult, publishSharedResult, submitAnswer } = require("../../utils/api");
const { ensureChallenge, needsChallenge } = require("../../utils/challengeState");
const { readFriendDraft } = require("../../utils/friendDraft");
const { compareByItems, compareQaAnswers, compareTopSongs } = require("../../utils/result");
const { getResultCopyPool, pickResultCopy } = require("../../utils/resultCopy");
const { getResultSnapshot, saveResultSnapshot } = require("../../utils/resultSnapshot");
const { getMockPair, normalizeMode } = require("../../utils/multiplayerMock");
const { getColorSubjects } = require("../../data/colors");
const { ensureStableAccountProfile, readCachedProfile, resolveCloudFileUrl } = require("../../utils/profile");
const {
  getCreatedResult,
  getParticipatedResult,
  saveParticipatedResult
} = require("../../utils/history");

function friendProfileKey(challengeId) {
  return challengeId ? `friendProfile:${challengeId}` : "friendProfile";
}

function hasChoices(choices) {
  return choices && Object.keys(choices).length > 0;
}

function hasTopSongs(songs) {
  return Array.isArray(songs) && songs.length >= 3 && songs.length <= 18 && songs.length % 3 === 0;
}

function hasCompleteTop9Result(result) {
  return result && result.mode === "top9" && hasTopSongs(result.creatorTopSongs) && hasTopSongs(result.friendTopSongs);
}

function hasFriendAnswersForMode(mode, app) {
  if (mode === "top9") return hasTopSongs(app.globalData.friendTopSongs);
  return hasChoices(app.globalData.friendChoices);
}

function readStoredFriendProfile(challengeId) {
  try {
    return wx.getStorageSync(friendProfileKey(challengeId)) || {};
  } catch (error) {
    return {};
  }
}

function showPageShareMenu() {
  if (!wx.showShareMenu) return;
  wx.showShareMenu({
    menus: ["shareAppMessage", "shareTimeline"]
  });
}

function hidePageShareMenu() {
  if (!wx.hideShareMenu) return;
  wx.hideShareMenu({
    menus: ["shareAppMessage", "shareTimeline"]
  });
}

function rankLabel(rank) {
  return ["", "一", "二", "三"][Number(rank)] || String(rank || "");
}

function shouldShowPoster(mode) {
  return mode !== "qa";
}

function subjectLabelForMode(mode) {
  if (mode === "album") return "专辑";
  if (mode === "top9") return "歌曲";
  if (mode === "color") return "颜色";
  if (mode === "qa") return "题目";
  return "歌手";
}

function resetColorDraft() {
  const app = getApp();
  app.globalData.draftMode = "color";
  app.globalData.draftColors = getColorSubjects();
  app.globalData.draftColorArtists = {};
  app.globalData.currentColorId = "";
  app.globalData.currentColorArtist = null;
  app.globalData.creatorChoices = {};
  app.globalData.friendChoices = {};
  app.globalData.challenge = null;
}

function pickTopArtistCover(topArtist, ...songGroups) {
  const artist = topArtist || {};
  const directCover = artist.avatarUrl || artist.cover || artist.coverUrl || artist.artworkUrl600 || artist.artworkUrl100 || "";
  if (directCover) return directCover;

  const songs = songGroups.reduce((list, group) => list.concat(Array.isArray(group) ? group : []), []);
  const coverSong = songs.find((song) => song && pickSongCover(song));
  return pickSongCover(coverSong) || "";
}

function getChallengeId(options) {
  return options.challengeId || ((getApp().globalData.challenge || {}).challengeId) || "";
}

function restoreFriendDraft(challengeId) {
  if (!challengeId) return;
  const draft = readFriendDraft(challengeId);
  const app = getApp();
  if (!hasChoices(app.globalData.friendChoices) && hasChoices(draft.friendChoices)) {
    app.globalData.friendChoices = draft.friendChoices;
  }
  if (!hasTopSongs(app.globalData.friendTopSongs) && hasTopSongs(draft.friendTopSongs)) {
    app.globalData.friendTopSongs = draft.friendTopSongs;
  }
  if (draft.friendProfile && (draft.friendProfile.nickName || draft.friendProfile.avatarUrl)) {
    app.globalData.friendProfile = draft.friendProfile;
  }
}

function getResultIdFromSubmission(submission) {
  return (submission && (submission.resultId || submission.submissionId || submission._id)) || "";
}

function getShareTitle(mode, score, nickName) {
  const name = String(nickName || "我").trim() || "我";
  if (mode === "top9") return `${name}和友的同担 Top 挑战结果`;
  if (mode === "color") return `${name}和友的颜色推歌挑战结果`;
  if (mode === "qa") return `${name}和友的歌单问答挑战结果`;
  return `${name}和朋友有${Number(score) || 0}%音乐品味契合度`;
}

function getTimelineShareTitle(mode, score, nickName) {
  const name = String(nickName || "我").trim() || "我";
  if (mode === "top9") return `你好，人，${name}和朋友有${Number(score) || 0}%默契度，点进来看看吧。`;
  if (mode === "album" || mode === "artist") return `你好，人，${name}和朋友有${Number(score) || 0}%音乐品味契合度，点进来看看吧。`;
  return `你好，人，${getShareTitle(mode, score, name)}，点进来看看吧。`;
}

function pickSongCover(song) {
  return (song && (song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || song.artworkUrl60 || song.picUrl || song.albumCover || song.imageUrl || song.avatarUrl)) || "";
}

function uniqueImages(images) {
  const seen = {};
  return (images || []).map((url) => String(url || "").trim()).filter((url) => {
    if (!url || seen[url]) return false;
    seen[url] = true;
    return true;
  });
}

function pickTimelineImages(images) {
  const picked = uniqueImages(images).slice(0, 3);
  if (!picked.length) return [];
  while (picked.length < 3) picked.push(picked[0]);
  return picked;
}

function makeSharedResultQuery(resultId, shareToken) {
  const query = `sharedResultId=${encodeURIComponent(resultId || "")}`;
  return shareToken ? `${query}&shareToken=${encodeURIComponent(shareToken)}` : query;
}

function formatTopLabel(prefix) {
  return `${prefix}排序`;
}

function isPlaceholderName(name) {
  const value = String(name || "").trim();
  return !value || ["我", "友", "匿名", "匿名挑战者"].indexOf(value) >= 0;
}

function hydrateAppFromChallenge(challenge, friendChoices, friendProfile, friendTopSongs) {
  if (!challenge || !challenge.challengeId) return;
  const app = getApp();
  app.globalData.challenge = challenge;
  app.globalData.creatorProfile = challenge.creatorProfile || app.globalData.creatorProfile || {};
  app.globalData.draftMode = challenge.mode || "artist";
  app.globalData.draftTargetCount = challenge.targetCount || 9;
  app.globalData.draftArtists = (challenge.mode || "artist") === "album"
    ? (challenge.albums || [])
    : ((challenge.mode || "artist") === "top9" ? [challenge.topArtist].filter(Boolean) : ((challenge.mode || "artist") === "color" ? (challenge.colors || []) : ((challenge.mode || "artist") === "qa" ? (challenge.qaPrompts || []) : (challenge.artists || []))));
  app.globalData.draftAlbums = challenge.albums || [];
  app.globalData.draftColors = challenge.colors || [];
  app.globalData.draftQaPrompts = challenge.qaPrompts || [];
  app.globalData.draftQaArtists = app.globalData.draftQaArtists || {};
  app.globalData.draftColorArtists = app.globalData.draftColorArtists || {};
  app.globalData.draftTopArtist = challenge.topArtist || null;
  app.globalData.creatorChoices = challenge.creatorChoices || {};
  app.globalData.creatorTopSongs = challenge.creatorTopSongs || [];
  app.globalData.friendChoices = friendChoices || {};
  app.globalData.friendTopSongs = friendTopSongs || [];
  app.globalData.friendProfile = friendProfile || {};
}

function normalizeProfile(profile, fallbackName) {
  const safeProfile = profile || {};
  const name = String(safeProfile.nickName || fallbackName || "匿名").trim() || fallbackName || "匿名";
  return {
    nickName: name,
    avatarUrl: safeProfile.avatarUrl || "",
    initial: name.slice(0, 1)
  };
}

function avatarForDisplay(url) {
  const value = String(url || "");
  return value.indexOf("cloud://") === 0 ? "" : value;
}

function getImageInfo(src) {
  if (!src) return Promise.resolve({ path: "", width: 0, height: 0 });
  const value = String(src || "").trim();
  const read = (imageSrc) => new Promise((resolve) => {
    wx.getImageInfo({
      src: imageSrc,
      success: (res) => resolve({
        path: res.path || imageSrc,
        width: res.width || 0,
        height: res.height || 0,
        src: value
      }),
      fail: (error) => resolve({ path: "", width: 0, height: 0, src: value, errMsg: error && error.errMsg })
    });
  });

  const downloadAndRead = (imageSrc) => new Promise((resolve) => {
    if (!/^https?:\/\//.test(imageSrc) || !wx.downloadFile) {
      resolve({ path: "", width: 0, height: 0, src: value });
      return;
    }
    wx.downloadFile({
      url: imageSrc,
      success: (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          resolve({ path: "", width: 0, height: 0, src: value });
          return;
        }
        read(res.tempFilePath || "").then(resolve);
      },
      fail: (error) => resolve({ path: "", width: 0, height: 0, src: value, errMsg: error && error.errMsg })
    });
  });

  if (value.indexOf("cloud://") === 0 && wx.cloud && wx.cloud.downloadFile) {
    return wx.cloud.downloadFile({ fileID: value })
      .then((res) => read(res.tempFilePath || ""))
      .catch((error) => ({ path: "", width: 0, height: 0, src: value, errMsg: error && error.errMsg }));
  }

  return read(value).then((image) => (image.path ? image : downloadAndRead(value)));
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

function drawFitText(ctx, text, x, y, maxWidth, fontSize, minFontSize) {
  let size = fontSize;
  const value = String(text || "");
  ctx.setFontSize(size);
  while (size > minFontSize && ctx.measureText(value).width > maxWidth) {
    size -= 1;
    ctx.setFontSize(size);
  }
  ctx.fillText(value, x, y);
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
    const text = String(fallbackText || "音").slice(0, 1);
    const textWidth = ctx.measureText(text).width;
    ctx.fillText(text, x + (size - textWidth) / 2, y + size / 2 + 7);
  }
  ctx.restore();
}

function drawTimelineCoverCard(ctx, image, x, y, size, fallbackText) {
  fillRoundRect(ctx, x + 10, y + 12, size, size, 14, "rgba(0,0,0,.14)");

  ctx.save();
  drawRoundRectPath(ctx, x, y, size, size, 12);
  ctx.clip();
  ctx.setFillStyle("#e9e1d7");
  ctx.fillRect(x, y, size, size);
  const didDraw = drawImageCover(ctx, image, x, y, size, size);
  if (!didDraw) {
    ctx.setFillStyle("#dfeee3");
    ctx.fillRect(x, y, size, size);
    ctx.setFillStyle("#1f7a48");
    ctx.setFontSize(28);
    ctx.fillText(String(fallbackText || "Music"), x + 38, y + 106);
  }
  ctx.restore();
  strokeRoundRect(ctx, x, y, size, size, 12, "#efe8dd", 4);
}

function makeTimelineImageKey(data, covers) {
  return [
    data.resultId || data.sharedResultId || "",
    data.mode || "",
    data.score || 0,
    ...(covers || [])
  ].join("|");
}

function getSongArtist(song) {
  return (song && (song.artistName || song.artist || song.singer)) || "";
}

function submitAnswerWithRetry(payload) {
  return submitAnswer(payload).catch((firstError) => (
    new Promise((resolve) => {
      setTimeout(resolve, 700);
    }).then(() => submitAnswer(payload)).catch(() => {
      throw firstError;
    })
  ));
}

Page({
  data: {
    score: 0,
    mode: "artist",
    subjectLabel: "歌手",
    resultCopy: "",
    viewerRole: "friend",
    comparisons: [],
    matched: [],
    missed: [],
    topArtist: {},
    topArtistAvatar: "音",
    creatorTopSongs: [],
    friendTopSongs: [],
    topArtistCover: "",
    top9LeftTitle: "我的排序",
    top9RightTitle: "友的排序",
    top9LeftSongs: [],
    top9RightSongs: [],
    matchedSongs: [],
    topRankMatches: [],
    matchCount: 0,
    matchTotal: 9,
    colorResults: [],
    qaResults: [],
    creatorName: "我",
    creatorAvatar: "",
    creatorInitial: "我",
    friendName: "友",
    friendAvatar: "",
    friendInitial: "友",
    resultId: "",
    sharedResultId: "",
    shareToken: "",
    sharedResultLoading: false,
    sharedResultError: "",
    savingColorResult: false,
    homeQrCodeUrl: "",
    timelineImageUrl: "",
    friendAvatarSubmitStatus: null,
    showPoster: true,
    pairMode: false,
    pairTitle: "",
    mockMultiplayer: false
  },

  onLoad(options) {
    hidePageShareMenu();
    const safeOptions = options || {};
    if (safeOptions.mock === "multiplayer") {
      this.renderMockMultiplayer(safeOptions);
      return;
    }

    if (safeOptions.pair === "1" && safeOptions.challengeId) {
      this.restorePairResult(
        decodeURIComponent(safeOptions.challengeId),
        safeOptions.leftParticipantId ? decodeURIComponent(safeOptions.leftParticipantId) : "",
        safeOptions.rightParticipantId ? decodeURIComponent(safeOptions.rightParticipantId) : ""
      );
      return;
    }

    if (safeOptions.sharedResultId) {
      this.restoreSharedResult(
        decodeURIComponent(safeOptions.sharedResultId),
        safeOptions.shareToken ? decodeURIComponent(safeOptions.shareToken) : ""
      );
      return;
    }

    const app = getApp();
    const challengeId = getChallengeId(safeOptions);
    if (safeOptions.mode === "friend" && !challengeId) {
      wx.showToast({ title: "挑战信息丢失，请重新进入", icon: "none" });
      return;
    }
    if (safeOptions.mode === "friend" && challengeId && needsChallenge(challengeId)) {
      wx.showLoading({ title: "读取挑战" });
      ensureChallenge(challengeId)
        .then(() => this.onLoad({ ...safeOptions, challengeId }))
        .catch(() => {
          wx.showToast({ title: "挑战不存在", icon: "none" });
        })
        .finally(() => wx.hideLoading());
      return;
    }
    if (safeOptions.mode === "friend") restoreFriendDraft(challengeId);
    const currentMode = app.globalData.draftMode || ((app.globalData.challenge || {}).mode) || "artist";
    if (safeOptions.mode === "friend") {
      if (!hasFriendAnswersForMode(currentMode, app)) {
        wx.showToast({ title: "答案丢失，请重新作答", icon: "none" });
        wx.reLaunch({ url: `/pages/friend/friend?challengeId=${encodeURIComponent(challengeId)}` });
        return;
      }
      this.renderCurrentResult(safeOptions, challengeId);
      return;
    }

    if (safeOptions.history === "created" && challengeId && safeOptions.resultId) {
      const created = getCreatedResult(challengeId, safeOptions.resultId);
      if (created) {
        this.applyCreatedHistory(created);
        return;
      }
    }

    if (safeOptions.history === "participated" && challengeId) {
      const participated = getParticipatedResult(challengeId);
      if (participated) {
        this.applyParticipatedHistory(participated);
        return;
      }
    }

    const snapshot = getResultSnapshot(challengeId);
    if (snapshot && snapshot.result) {
      this.applySnapshot(snapshot);
      return;
    }

    if (challengeId) {
      this.restoreCloudResult(challengeId);
      return;
    }

    this.renderCurrentResult(safeOptions, challengeId);
  },

  renderMockMultiplayer(options = {}) {
    const mode = normalizeMode(options.mode);
    const leftParticipantId = options.leftParticipantId ? decodeURIComponent(options.leftParticipantId) : "";
    const rightParticipantId = options.rightParticipantId ? decodeURIComponent(options.rightParticipantId) : "";
    if (options.pair === "1") {
      this.restoreMockPairResult(mode, leftParticipantId, rightParticipantId);
      return;
    }

    this.restoreMockPairResult(mode, "creator", options.viewerParticipantId || "mock-r-001");
  },

  restoreMockPairResult(mode, leftParticipantId, rightParticipantId) {
    const res = getMockPair(mode, leftParticipantId || "mock-r-001", rightParticipantId || "creator");
    const pair = res.pair || {};
    hydrateAppFromChallenge(res.challenge, res.friendChoices, res.friendProfile, res.friendTopSongs);
    this.currentResultId = pair.pairId || "mock-pair";
    this.setData({
      mode: res.mode,
      resultId: "",
      sharedResultId: "",
      shareToken: "",
      subjectLabel: subjectLabelForMode(res.mode),
      viewerRole: "creator",
      showPoster: shouldShowPoster(res.mode),
      pairMode: true,
      pairTitle: `${pair.leftName || "TA"}和${pair.rightName || "TA"}的音乐默契`,
      sharedResultLoading: false,
      sharedResultError: "",
      mockMultiplayer: true
    });
    this.applyResult(res.result, { persist: false });
  },

  restorePairResult(challengeId, leftParticipantId, rightParticipantId) {
    if (!leftParticipantId || !rightParticipantId) {
      this.setData({ sharedResultLoading: false, sharedResultError: "参与者信息缺失" });
      wx.showToast({ title: "参与者信息缺失", icon: "none" });
      return;
    }

    this.setData({
      sharedResultLoading: true,
      sharedResultError: "",
      pairMode: true,
      pairTitle: "",
      showPoster: false,
    });
    wx.showLoading({ title: "读取结果" });
    getChallengeMultiplayer({
      action: "pair",
      challengeId,
      leftParticipantId,
      rightParticipantId
    }).then((res) => {
      if (!res.supported || !res.challenge || !res.result) {
        this.setData({
          sharedResultLoading: false,
          sharedResultError: "这场挑战暂不支持多人对比"
        });
        wx.showToast({ title: "暂不支持多人对比", icon: "none" });
        return;
      }

      const mode = res.mode || (res.challenge || {}).mode || "artist";
      const pair = res.pair || {};
      const leftName = pair.leftName || ((res.challenge.creatorProfile || {}).nickName) || "TA";
      const rightName = pair.rightName || ((res.friendProfile || {}).nickName) || "TA";
      hydrateAppFromChallenge(res.challenge, res.friendChoices, res.friendProfile, res.friendTopSongs);
      this.currentResultId = pair.pairId || `${leftParticipantId}__${rightParticipantId}`;
      this.setData({
        mode,
        resultId: "",
        sharedResultId: "",
        shareToken: "",
        subjectLabel: subjectLabelForMode(mode),
        viewerRole: "creator",
        showPoster: shouldShowPoster(mode),
        pairMode: true,
        pairTitle: `${leftName}和${rightName}的音乐默契`,
        sharedResultLoading: false,
        sharedResultError: "",
      });
      this.applyResult(res.result, { persist: false });
    }).catch(() => {
      this.setData({
        sharedResultLoading: false,
        sharedResultError: "这场挑战暂时读取失败"
      });
      wx.showToast({ title: "结果读取失败", icon: "none" });
    }).finally(() => wx.hideLoading());
  },

  renderCurrentResult(options, challengeId) {
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const mode = app.globalData.draftMode || challenge.mode || "artist";
    const items = mode === "album"
      ? ((app.globalData.draftAlbums || []).length ? app.globalData.draftAlbums : (challenge.albums || app.globalData.draftArtists || []))
      : (mode === "color"
          ? ((app.globalData.draftColors || []).length ? app.globalData.draftColors : (challenge.colors || []))
          : (mode === "qa"
              ? ((app.globalData.draftQaPrompts || []).length ? app.globalData.draftQaPrompts : (challenge.qaPrompts || []))
              : ((app.globalData.draftArtists || []).length ? app.globalData.draftArtists : (challenge.artists || []))));
    this.setData({
      mode,
      subjectLabel: subjectLabelForMode(mode),
      viewerRole: "friend",
      showPoster: shouldShowPoster(mode)
    });

    const localResult = mode === "top9"
      ? compareTopSongs(challenge.topArtist || app.globalData.draftTopArtist, challenge.creatorTopSongs || app.globalData.creatorTopSongs, app.globalData.friendTopSongs)
      : (mode === "qa" ? compareQaAnswers(items || [], app.globalData.creatorChoices || {}, app.globalData.friendChoices || {})
      : compareByItems(items || [], app.globalData.creatorChoices, app.globalData.friendChoices));
    this.applyResult(localResult);

    if (options.mode === "friend" && challengeId) {
      this.prepareFriendProfileForSubmit(challengeId).then((friendProfile) => submitAnswerWithRetry({
        challengeId,
        friendChoices: app.globalData.friendChoices,
        friendTopSongs: app.globalData.friendTopSongs,
        friendProfile
      })).then((res) => {
        if (res.avatarStatus) {
          this.setData({ friendAvatarSubmitStatus: res.avatarStatus });
          const finalType = res.avatarStatus.finalType || res.avatarStatus.after || "empty";
          if (finalType !== "cloud" && finalType !== "remote") {
            console.warn("friend avatar was not saved as a stable URL", res.avatarStatus);
          }
        }
        if (!res.result) return;
        if (mode === "qa" && !(res.result.comparisons || []).length) return;
        if (mode === "top9" && !hasCompleteTop9Result(res.result)) return;
        const resultId = res.resultId || res.submissionId || "";
        this.currentResultId = resultId;
        this.setData({
          resultId,
          shareToken: res.shareToken || ""
        });
        this.prepareCurrentResultForSharing(resultId);
        this.applyResult(res.result);
      }).catch(() => {
        wx.showToast({ title: "结果保存失败", icon: "none" });
      });
    }
  },

  prepareFriendProfileForSubmit(challengeId) {
    const app = getApp();
    const rawProfile = app.globalData.friendProfile || readStoredFriendProfile(challengeId);
    return ensureStableAccountProfile(rawProfile)
      .then(({ profile, avatarStatus }) => {
        app.globalData.friendProfile = profile;
        try {
          wx.setStorageSync(friendProfileKey(challengeId), profile);
        } catch (error) {
          console.warn("cache stable friend profile failed", error);
        }
        this.setData({ friendAvatarSubmitStatus: avatarStatus });
        if (avatarStatus && !avatarStatus.stable && avatarStatus.before === "temporary") {
          console.warn("friend avatar upload failed before submit", avatarStatus);
        }
        return profile;
      });
  },

  restoreCloudResult(challengeId) {
    wx.showLoading({ title: "读取结果" });
    getRecentSubmission(challengeId)
      .then((res) => {
        if (!res.submission || !res.result) {
          wx.showToast({ title: "暂无可恢复结果", icon: "none" });
          return;
        }

        hydrateAppFromChallenge(res.challenge, res.submission.friendChoices, res.submission.friendProfile, res.submission.friendTopSongs);
        const resultId = getResultIdFromSubmission(res.submission);
        this.currentResultId = resultId;
        this.setData({
          mode: (res.challenge || {}).mode || "artist",
          resultId,
          shareToken: (res.submission || {}).shareToken || res.shareToken || "",
          subjectLabel: subjectLabelForMode(((res.challenge || {}).mode) || "artist"),
          viewerRole: "friend",
          showPoster: shouldShowPoster((res.challenge || {}).mode || "artist")
        });
        this.prepareCurrentResultForSharing(resultId);
        this.applyResult(res.result);
      })
      .catch(() => {
        wx.showToast({ title: "结果读取失败", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  },

  restoreSharedResult(sharedResultId, shareToken = "") {
    this.setData({
      sharedResultLoading: true,
      sharedResultError: "",
      sharedResultId,
      shareToken
    });
    wx.showLoading({ title: "读取分享" });
    getSharedResult({ resultId: sharedResultId, shareToken })
      .then((res) => {
        if (!res.challenge || !res.submission || !res.result) {
          wx.showToast({ title: "分享结果不存在", icon: "none" });
          return;
        }

        const mode = (res.challenge || {}).mode || "artist";
        const viewerRole = (res.submission && res.submission.sharedByRole) || "friend";
        hydrateAppFromChallenge(res.challenge, res.submission.friendChoices, res.submission.friendProfile, res.submission.friendTopSongs);
        this.currentResultId = res.resultId || sharedResultId;
        this.setData({
          mode,
          resultId: this.currentResultId,
          sharedResultId: this.currentResultId,
          shareToken: res.shareToken || shareToken || "",
          sharedResultLoading: false,
          sharedResultError: "",
          subjectLabel: subjectLabelForMode(mode),
          viewerRole,
          showPoster: shouldShowPoster(mode)
        });
        this.prepareCurrentResultForSharing(this.currentResultId);
        this.applyResult(res.result, { persist: false });
      })
      .catch(() => {
        this.setData({
          sharedResultLoading: false,
          sharedResultError: "请进入小程序查看分享结果"
        });
        wx.showToast({ title: "分享已失效", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  },

  applySnapshot(snapshot) {
    hydrateAppFromChallenge(snapshot.challenge, snapshot.friendChoices, snapshot.friendProfile, snapshot.friendTopSongs);
    const resultId = snapshot.resultId || ((snapshot.result || {}).resultId) || "";
    this.currentResultId = resultId;
    this.setData({
      mode: snapshot.mode || ((snapshot.challenge || {}).mode) || "artist",
      resultId,
      shareToken: snapshot.shareToken || "",
      subjectLabel: subjectLabelForMode(snapshot.mode || ((snapshot.challenge || {}).mode) || "artist"),
      viewerRole: snapshot.viewerRole || "friend",
      showPoster: shouldShowPoster(snapshot.mode || ((snapshot.challenge || {}).mode) || "artist")
    });
    this.prepareCurrentResultForSharing(resultId);
    this.applyResult(snapshot.result, {
      persist: false,
      resultCopy: snapshot.resultCopy || (snapshot.result || {}).resultCopy
    });
  },

  applyParticipatedHistory(record) {
    hydrateAppFromChallenge(record.challenge, record.friendChoices, record.friendProfile, record.friendTopSongs);
    const resultId = record.resultId || ((record.result || {}).resultId) || "";
    this.currentResultId = resultId;
    this.setData({
      mode: record.mode || "artist",
      resultId,
      shareToken: record.shareToken || "",
      subjectLabel: subjectLabelForMode(record.mode || "artist"),
      viewerRole: "friend",
      showPoster: shouldShowPoster(record.mode || "artist")
    });
    this.prepareCurrentResultForSharing(resultId);
    this.applyResult(record.result, {
      persist: false,
      resultCopy: record.resultCopy || (record.result || {}).resultCopy
    });
  },

  applyCreatedHistory(created) {
    const { challengeRecord, resultRecord } = created;
    hydrateAppFromChallenge(challengeRecord.challenge, resultRecord.friendChoices, resultRecord.friendProfile, resultRecord.friendTopSongs);
    const resultId = resultRecord.resultId || ((resultRecord.result || {}).resultId) || "";
    this.currentResultId = resultId;
    this.setData({
      mode: challengeRecord.mode || "artist",
      resultId,
      shareToken: resultRecord.shareToken || "",
      subjectLabel: subjectLabelForMode(challengeRecord.mode || "artist"),
      viewerRole: "creator",
      showPoster: shouldShowPoster(challengeRecord.mode || "artist")
    });
    this.prepareCurrentResultForSharing(resultId);
    this.applyResult(resultRecord.result, {
      persist: false,
      resultCopy: resultRecord.resultCopy || (resultRecord.result || {}).resultCopy
    });
  },

  applyResult(result, options = {}) {
    if (this.data.mode === "top9" || result.mode === "top9") {
      this.applyTop9Result(result, options);
      return;
    }
    if (this.data.mode === "qa" || result.mode === "qa") {
      this.applyQaResult(result, options);
      return;
    }

    const comparisons = (result.comparisons || []).map((item) => {
      const creatorSongName = (item.creator && (item.creator.name || item.creator.trackName)) || "未选择";
      const friendSongName = (item.friend && (item.friend.name || item.friend.trackName)) || "未选择";
      return {
        ...item,
        cover: item.cover || pickSongCover(item.friend) || pickSongCover(item.creator),
        creatorSongName,
        friendSongName,
        viewerSongName: this.data.viewerRole === "creator" ? creatorSongName : friendSongName,
        otherSongName: this.data.viewerRole === "creator" ? friendSongName : creatorSongName
      };
    });
    const colorResults = this.data.mode === "color"
      ? comparisons.map((item) => ({
          ...item,
          color: (item.subject && item.subject.color) || "#fffdf8",
          textColor: (item.subject && item.subject.textColor) || "#171512",
          borderColor: (item.subject && item.subject.borderColor) || "rgba(23,21,18,.12)",
          colorName: (item.subject && item.subject.name) || "",
          cardStyle: `background:${(item.subject && item.subject.color) || "#fffdf8"};color:${(item.subject && item.subject.textColor) || "#171512"};border-color:${(item.subject && item.subject.borderColor) || "rgba(23,21,18,.12)"};`,
          matchedClass: item.matched ? "matched" : "",
          creatorCover: pickSongCover(item.creator),
          creatorSongName: (item.creator && (item.creator.name || item.creator.trackName)) || "未选择",
          creatorArtistName: (item.creator && item.creator.artistName) || "",
          friendCover: pickSongCover(item.friend),
          friendSongName: (item.friend && (item.friend.name || item.friend.trackName)) || "未选择",
          friendArtistName: (item.friend && item.friend.artistName) || ""
        }))
      : [];
    const matched = comparisons.filter((item) => item.matched);
    const missed = comparisons.filter((item) => !item.matched);
    const totalCount = Number(result.totalCount) || comparisons.length || 0;
    const copyStorageKey = `resultCopy:${Math.max(0, Math.min(9, Number(result.matchCount) || 0))}`;
    const copyHistoryKey = `${copyStorageKey}:history`;
    let copyHistory = [];
    try {
      copyHistory = wx.getStorageSync(copyHistoryKey) || [];
    } catch (error) {
      copyHistory = [];
    }
    const resultCopy = options.resultCopy || result.resultCopy || pickResultCopy(result.matchCount, copyHistory);
    const copyPoolSize = getResultCopyPool(result.matchCount).length;
    const nextHistory = Array.from(new Set([...(Array.isArray(copyHistory) ? copyHistory : []), resultCopy]));
    try {
      wx.setStorageSync(copyHistoryKey, nextHistory.length >= copyPoolSize ? [resultCopy] : nextHistory);
      wx.setStorageSync(copyStorageKey, resultCopy);
    } catch (error) {
      console.warn("save result copy failed", error);
    }

    const finalResult = { ...result, totalCount, resultCopy, comparisons, matched, missed };
    getApp().globalData.lastResult = finalResult;
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const creatorProfile = normalizeProfile(challenge.creatorProfile || app.globalData.creatorProfile, "我");
    const friendProfile = normalizeProfile(app.globalData.friendProfile || readStoredFriendProfile(challenge.challengeId), "友");
    this.setData({
      score: result.score,
      matchCount: result.matchCount || matched.length,
      matchTotal: totalCount,
      mode: this.data.mode,
      resultCopy,
      comparisons,
      colorResults,
      matched,
      missed,
      creatorName: creatorProfile.nickName,
      creatorAvatar: avatarForDisplay(creatorProfile.avatarUrl),
      creatorInitial: creatorProfile.initial,
      friendName: friendProfile.nickName,
      friendAvatar: avatarForDisplay(friendProfile.avatarUrl),
      friendInitial: friendProfile.initial
    }, () => this.prepareResultTimelineImage());
    this.resolveProfileAvatars(creatorProfile.avatarUrl, friendProfile.avatarUrl);

    if (options.persist !== false) this.saveSnapshot(finalResult);
  },

  applyQaResult(result, options = {}) {
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const prompts = (challenge.qaPrompts || []).length ? challenge.qaPrompts : (app.globalData.draftQaPrompts || []);
    const fallbackResult = result && (result.comparisons || []).length
      ? result
      : compareQaAnswers(prompts, app.globalData.creatorChoices || {}, app.globalData.friendChoices || {});
    const comparisons = (fallbackResult.comparisons || []).map((item) => ({
      ...item,
      promptText: (item.subject && item.subject.prompt) || "",
      creatorCover: pickSongCover(item.creator),
      creatorSongName: (item.creator && (item.creator.name || item.creator.trackName)) || "未填写",
      creatorArtistName: (item.creator && item.creator.artistName) || "",
      friendCover: pickSongCover(item.friend),
      friendSongName: (item.friend && (item.friend.name || item.friend.trackName)) || "未填写",
      friendArtistName: (item.friend && item.friend.artistName) || ""
    }));
    const creatorProfile = normalizeProfile(challenge.creatorProfile || app.globalData.creatorProfile, "我");
    const friendProfile = normalizeProfile(app.globalData.friendProfile || readStoredFriendProfile(challenge.challengeId), "友");
    const finalResult = {
      ...fallbackResult,
      mode: "qa",
      comparisons,
      qaResults: comparisons,
      resultCopy: ""
    };
    getApp().globalData.lastResult = finalResult;
    this.setData({
      score: 0,
      mode: "qa",
      subjectLabel: "题目",
      resultCopy: "",
      comparisons,
      qaResults: comparisons,
      matchCount: fallbackResult.matchCount || 0,
      matchTotal: Number(fallbackResult.totalCount) || comparisons.length || 0,
      creatorName: creatorProfile.nickName,
      creatorAvatar: avatarForDisplay(creatorProfile.avatarUrl),
      creatorInitial: creatorProfile.initial,
      friendName: friendProfile.nickName,
      friendAvatar: avatarForDisplay(friendProfile.avatarUrl),
      friendInitial: friendProfile.initial,
      showPoster: false
    }, () => this.prepareResultTimelineImage());
    this.resolveProfileAvatars(creatorProfile.avatarUrl, friendProfile.avatarUrl);

    if (options.persist !== false) this.saveSnapshot(finalResult);
  },

  resolveProfileAvatars(creatorAvatar, friendAvatar) {
    Promise.all([
      resolveCloudFileUrl(creatorAvatar || ""),
      resolveCloudFileUrl(friendAvatar || "")
    ]).then(([creatorTempUrl, friendTempUrl]) => {
      const nextData = {};
      const creatorDisplayUrl = avatarForDisplay(creatorTempUrl);
      const friendDisplayUrl = avatarForDisplay(friendTempUrl);
      const waitingForCreatorCloud = String(creatorAvatar || "").indexOf("cloud://") === 0 && !this.data.creatorAvatar;
      const waitingForFriendCloud = String(friendAvatar || "").indexOf("cloud://") === 0 && !this.data.friendAvatar;
      if (creatorDisplayUrl && (this.data.creatorAvatar === creatorAvatar || waitingForCreatorCloud)) nextData.creatorAvatar = creatorDisplayUrl;
      if (friendDisplayUrl && (this.data.friendAvatar === friendAvatar || waitingForFriendCloud)) nextData.friendAvatar = friendDisplayUrl;
      if (Object.keys(nextData).length) this.setData(nextData);
    }).catch(() => {});
  },

  applyTop9Result(result, options = {}) {
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const fallbackResult = hasCompleteTop9Result(result)
      ? result
      : compareTopSongs(
          result.topArtist || challenge.topArtist || app.globalData.draftTopArtist,
          result.creatorTopSongs || challenge.creatorTopSongs || app.globalData.creatorTopSongs,
          result.friendTopSongs || app.globalData.friendTopSongs
        );
    result = {
      ...fallbackResult,
      resultCopy: result.resultCopy || fallbackResult.resultCopy
    };

    const copyStorageKey = `resultCopy:${Math.max(0, Math.min(9, Number(result.matchCount) || 0))}`;
    const copyHistoryKey = `${copyStorageKey}:history`;
    let copyHistory = [];
    try {
      copyHistory = wx.getStorageSync(copyHistoryKey) || [];
    } catch (error) {
      copyHistory = [];
    }
    const resultCopy = options.resultCopy || result.resultCopy || pickResultCopy(result.matchCount, copyHistory);
    const copyPoolSize = getResultCopyPool(result.matchCount).length;
    const nextHistory = Array.from(new Set([...(Array.isArray(copyHistory) ? copyHistory : []), resultCopy]));
    try {
      wx.setStorageSync(copyHistoryKey, nextHistory.length >= copyPoolSize ? [resultCopy] : nextHistory);
      wx.setStorageSync(copyStorageKey, resultCopy);
    } catch (error) {
      console.warn("save result copy failed", error);
    }

    const isCreatorViewer = this.data.viewerRole === "creator";
    const creatorTopSongs = result.creatorTopSongs || [];
    const friendTopSongs = result.friendTopSongs || [];
    const totalCount = Number(result.totalCount) || Math.max(creatorTopSongs.length, friendTopSongs.length, 1);
    const matchedSongs = (result.matchedSongs || []).map((item) => ({
      ...item,
      viewerRank: isCreatorViewer ? item.creatorRank : item.friendRank,
      otherRank: isCreatorViewer ? item.friendRank : item.creatorRank,
      rankHitText: item.creatorRank <= 3 && item.creatorRank === item.friendRank
        ? `你们都把这首歌排在了第${rankLabel(item.creatorRank)}位`
        : ""
    }));
    const top9LeftSongs = isCreatorViewer ? creatorTopSongs : friendTopSongs;
    const top9RightSongs = isCreatorViewer ? friendTopSongs : creatorTopSongs;
    const topArtist = result.topArtist || challenge.topArtist || app.globalData.draftTopArtist || {};
    const topArtistCover = pickTopArtistCover(topArtist, creatorTopSongs, friendTopSongs, matchedSongs);
    const creatorProfile = normalizeProfile(challenge.creatorProfile || app.globalData.creatorProfile, "我");
    const friendProfile = normalizeProfile(app.globalData.friendProfile || readStoredFriendProfile(challenge.challengeId), "友");
    const leftTitle = this.data.pairMode
      ? formatTopLabel(`${creatorProfile.nickName}的`, creatorTopSongs)
      : formatTopLabel("我的", creatorTopSongs);
    const rightTitle = this.data.pairMode
      ? formatTopLabel(`${friendProfile.nickName}的`, friendTopSongs)
      : formatTopLabel("友的", friendTopSongs);
    const finalResult = {
      ...result,
      totalCount,
      topArtist,
      topArtistCover,
      resultCopy,
      viewerRole: this.data.viewerRole,
      matchedSongs,
      top9LeftTitle: leftTitle,
      top9RightTitle: rightTitle,
      top9LeftSongs,
      top9RightSongs
    };
    getApp().globalData.lastResult = finalResult;
    this.setData({
      score: result.score,
      mode: "top9",
      resultCopy,
      topArtist,
      topArtistAvatar: topArtist.name ? topArtist.name.slice(0, 1) : "音",
      topArtistCover,
      creatorTopSongs,
      friendTopSongs,
      top9LeftSongs,
      top9RightSongs,
      matchedSongs,
      topRankMatches: result.topRankMatches || [],
      matchCount: result.matchCount || 0,
      matchTotal: totalCount,
      creatorName: creatorProfile.nickName,
      creatorAvatar: avatarForDisplay(creatorProfile.avatarUrl),
      creatorInitial: creatorProfile.initial,
      friendName: friendProfile.nickName,
      friendAvatar: avatarForDisplay(friendProfile.avatarUrl),
      friendInitial: friendProfile.initial,
      top9LeftTitle: leftTitle,
      top9RightTitle: rightTitle,
      showPoster: shouldShowPoster("top9")
    }, () => this.prepareResultTimelineImage());
    this.resolveProfileAvatars(creatorProfile.avatarUrl, friendProfile.avatarUrl);

    if (options.persist !== false) this.saveSnapshot(finalResult);
  },

  saveSnapshot(result) {
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    if (!challenge.challengeId) return;
    const resultId = this.data.resultId || this.currentResultId || result.resultId || "";

    saveResultSnapshot(challenge.challengeId, {
      mode: this.data.mode,
      resultId,
      shareToken: this.data.shareToken || "",
      result,
      resultCopy: result.resultCopy,
      viewerRole: this.data.viewerRole || "friend",
      challenge,
      friendChoices: app.globalData.friendChoices || {},
      friendTopSongs: app.globalData.friendTopSongs || [],
      friendProfile: app.globalData.friendProfile || readStoredFriendProfile(challenge.challengeId),
      creatorProfile: challenge.creatorProfile || {}
    });
    saveParticipatedResult({
      challengeId: challenge.challengeId,
      mode: this.data.mode,
      resultId,
      shareToken: this.data.shareToken || "",
      result,
      resultCopy: result.resultCopy,
      challenge,
      friendChoices: app.globalData.friendChoices || {},
      friendTopSongs: app.globalData.friendTopSongs || [],
      friendProfile: app.globalData.friendProfile || readStoredFriendProfile(challenge.challengeId),
      creatorProfile: challenge.creatorProfile || {},
      savedAt: Date.now()
    });
  },

  toPoster() {
    if (this.data.mode === "qa") return;
    wx.navigateTo({ url: "/pages/poster/poster" });
  },

  getHomeQrCodeUrl() {
    if (this.data.homeQrCodeUrl) return Promise.resolve(this.data.homeQrCodeUrl);
    return getMiniProgramCode({
      page: "pages/home/home"
    }).then((res) => {
      const url = res.tempFileURL || res.fileID || "";
      if (url) this.setData({ homeQrCodeUrl: url });
      return url;
    }).catch(() => "");
  },

  saveColorResultImage() {
    if (this.data.mode !== "color" || this.data.savingColorResult) return;
    if (!this.data.colorResults.length) {
      wx.showToast({ title: "暂无可保存结果", icon: "none" });
      return;
    }

    this.setData({ savingColorResult: true });
    wx.showLoading({ title: "生成中" });
    this.drawColorResultCanvas()
      .then((filePath) => new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: resolve,
          fail: reject
        });
      }))
      .then(() => {
        wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch(() => {
        wx.showToast({ title: "保存失败，请检查相册权限", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ savingColorResult: false });
      });
  },

  drawColorResultCanvas() {
    const width = 750;
    const margin = 42;
    const cardGap = 16;
    const headerHeight = 126;
    const cardWidth = width - margin * 2;
    const cardHeight = 364;
    const cardPadding = 22;
    const columnGap = 22;
    const columnWidth = (cardWidth - cardPadding * 2 - columnGap) / 2;
    const coverSize = 230;
    const colors = this.data.colorResults;
    const footerTop = headerHeight + colors.length * cardHeight + Math.max(0, colors.length - 1) * cardGap + 46;
    const qrSize = 132;
    const height = footerTop + qrSize + 74;
    const ctx = wx.createCanvasContext("colorResultCanvas", this);
    const creatorName = this.data.creatorName || "我";
    const friendName = this.data.friendName || "友";

    return Promise.all([
      Promise.all(colors.map((item) => Promise.all([
        getImageInfo(item.creatorCover),
        getImageInfo(item.friendCover)
      ]))),
      getImageInfo(this.data.creatorAvatar),
      getImageInfo(this.data.friendAvatar),
      this.getHomeQrCodeUrl().then((url) => getImageInfo(url))
    ]).then(([coverImages, creatorAvatar, friendAvatar, qrImage]) => new Promise((resolve, reject) => {
      ctx.setFillStyle("#f6f0e7");
      ctx.fillRect(0, 0, width, height);

      ctx.setFillStyle("#171512");
      ctx.setFontSize(44);
      ctx.fillText("颜色推歌结果", margin, 74);

      colors.forEach((item, index) => {
        const x = margin;
        const y = headerHeight + index * (cardHeight + cardGap);
        const textColor = item.textColor || "#171512";
        const firstColumnX = x + cardPadding;
        const secondColumnX = firstColumnX + columnWidth + columnGap;
        const personY = y + cardPadding;
        const coverY = personY + 42;
        const coverXOffset = (columnWidth - coverSize) / 2;
        const copyY = coverY + coverSize + 30;
        const images = coverImages[index] || [];

        ctx.save();
        if (ctx.setShadow) ctx.setShadow(0, 10, 18, "rgba(23,21,18,.12)");
        fillRoundRect(ctx, x, y, cardWidth, cardHeight, 4, item.color || "#fffdf8");
        ctx.restore();

        [
          {
            x: firstColumnX,
            avatar: creatorAvatar,
            name: creatorName,
            initial: this.data.creatorInitial,
            cover: images[0],
            songName: item.creatorSongName,
            artistName: item.creatorArtistName || getSongArtist(item.creator)
          },
          {
            x: secondColumnX,
            avatar: friendAvatar,
            name: friendName,
            initial: this.data.friendInitial,
            cover: images[1],
            songName: item.friendSongName,
            artistName: item.friendArtistName || getSongArtist(item.friend)
          }
        ].forEach((pick) => {
          ctx.setFillStyle(textColor);
          drawCircleImage(ctx, pick.avatar, pick.x, personY, 32, pick.initial || pick.name);
          ctx.setFillStyle(textColor);
          drawFitText(ctx, pick.name, pick.x + 42, personY + 23, columnWidth - 42, 22, 15);

          ctx.save();
          drawRoundRectPath(ctx, pick.x + coverXOffset, coverY, coverSize, coverSize, 2);
          ctx.clip();
          ctx.setFillStyle("#fffdfa");
          ctx.fillRect(pick.x + coverXOffset, coverY, coverSize, coverSize);
          drawImageCover(ctx, pick.cover, pick.x + coverXOffset, coverY, coverSize, coverSize);
          ctx.restore();

          ctx.setFillStyle(textColor);
          drawFitText(ctx, pick.songName || "未选择", pick.x, copyY, columnWidth, 24, 16);
          drawFitText(ctx, pick.artistName || "", pick.x, copyY + 30, columnWidth, 20, 14);
        });
      });

      ctx.setFillStyle("#171512");
      drawFitText(ctx, "在这个混乱的世代感谢还有音乐", margin, footerTop + 78, width - margin * 3 - qrSize, 25, 18);
      fillRoundRect(ctx, width - margin - qrSize, footerTop, qrSize, qrSize, 8, "#fffdfa");
      if (qrImage && qrImage.path) {
        ctx.drawImage(qrImage.path, width - margin - qrSize + 8, footerTop + 8, qrSize - 16, qrSize - 16);
      }

      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "colorResultCanvas",
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

  createNew() {
    if (this.data.mode === "color") {
      resetColorDraft();
      wx.reLaunch({ url: "/pages/colors/colors?role=creator" });
      return;
    }
    wx.reLaunch({ url: "/pages/home/home" });
  },

  goHome() {
    wx.reLaunch({ url: "/pages/home/home" });
  },

  prepareCurrentResultForSharing(resultId) {
    const currentResultId = resultId || this.data.resultId || this.currentResultId || "";
    if (!currentResultId) {
      hidePageShareMenu();
      return;
    }
    if (this.preparedSharedResultId === currentResultId && this.data.shareToken) return;
    if (this.data.shareToken) {
      this.preparedSharedResultId = currentResultId;
      showPageShareMenu();
      return;
    }
    hidePageShareMenu();
    this.preparedSharedResultId = currentResultId;
    publishSharedResult({
      resultId: currentResultId,
      channel: "prepare"
    }).then((res) => {
      if (this.preparedSharedResultId === currentResultId && res.shareToken) {
        this.setData({ shareToken: res.shareToken });
        showPageShareMenu();
      }
    }).catch(() => {
      if (this.preparedSharedResultId === currentResultId) {
        this.preparedSharedResultId = "";
        hidePageShareMenu();
      }
    });
  },

  publishCurrentSharedResult(channel) {
    const resultId = this.data.resultId || this.currentResultId || "";
    if (!resultId || !this.data.shareToken) {
      wx.showToast({ title: "结果分享准备中", icon: "none" });
      return "";
    }
    publishSharedResult({
      resultId,
      channel
    }).then((res) => {
      if ((this.data.resultId || this.currentResultId || "") === resultId && res.shareToken) {
        this.setData({ shareToken: res.shareToken });
      }
    }).catch(() => {});
    return resultId;
  },

  getSharingUserName() {
    const name = this.data.viewerRole === "creator"
      ? (this.data.creatorName || "我")
      : (this.data.friendName || "我");
    if (!isPlaceholderName(name)) return name;

    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const profile = this.data.viewerRole === "creator"
      ? (challenge.creatorProfile || app.globalData.creatorProfile || {})
      : (app.globalData.friendProfile || readStoredFriendProfile(challenge.challengeId));
    const profileName = String((profile || {}).nickName || "").trim();
    if (!isPlaceholderName(profileName)) return profileName;

    const cachedName = String((readCachedProfile() || {}).nickName || "").trim();
    return isPlaceholderName(cachedName) ? name : cachedName;
  },

  collectTimelineCovers() {
    const colorCovers = (this.data.colorResults || []).reduce((list, item) => (
      list.concat([item.friendCover, item.creatorCover])
    ), []);
    const qaCovers = (this.data.qaResults || []).reduce((list, item) => (
      list.concat([item.friendCover, item.creatorCover])
    ), []);
    if (this.data.mode === "top9") {
      return pickTimelineImages([
        ...((this.data.matchedSongs || []).map(pickSongCover)),
        ...((this.data.top9LeftSongs || []).map(pickSongCover)),
        ...((this.data.top9RightSongs || []).map(pickSongCover)),
        this.data.topArtistCover
      ]);
    }
    if (this.data.mode === "color") return pickTimelineImages(colorCovers);
    if (this.data.mode === "qa") return pickTimelineImages(qaCovers);
    return pickTimelineImages((this.data.comparisons || []).reduce((list, item) => (
      list.concat([item.cover, pickSongCover(item.friend), pickSongCover(item.creator)])
    ), []));
  },

  prepareResultTimelineImage() {
    const covers = this.collectTimelineCovers();
    const imageKey = makeTimelineImageKey(this.data, covers);
    if (!covers.length) {
      this.timelineImageKey = imageKey;
      if (this.data.timelineImageUrl) this.setData({ timelineImageUrl: "" });
      return;
    }
    if (this.timelineImageKey === imageKey && this.data.timelineImageUrl) return;
    this.timelineImageKey = imageKey;
    this.setData({ timelineImageUrl: "" });
    Promise.all(covers.map((cover) => getImageInfo(cover))).then((coverImages) => {
      if (this.timelineImageKey !== imageKey) return;
      if (!coverImages.some((image) => image && image.path)) return;
      this.drawResultTimelineCanvas(coverImages, imageKey);
    }).catch(() => {});
  },

  drawResultTimelineCanvas(coverImages, imageKey) {
    const ctx = wx.createCanvasContext("resultTimelineCanvas", this);
    const width = 1000;
    const height = 1000;
    const cardSize = 420;
    const labels = ["Music", "Pick", "Album"];
    const cards = [
      { x: 222, y: 352, image: coverImages[0], label: labels[0], rotate: -7 },
      { x: 340, y: 282, image: coverImages[1], label: labels[1], rotate: 0 },
      { x: 458, y: 352, image: coverImages[2], label: labels[2], rotate: 7 }
    ];

    ctx.setFillStyle("#fbfaf7");
    ctx.fillRect(0, 0, width, height);
    fillRoundRect(ctx, 74, 74, 852, 852, 28, "#f7f2eb");
    strokeRoundRect(ctx, 74, 74, 852, 852, 28, "#efe8dd", 12);

    cards.forEach((card) => {
      ctx.save();
      ctx.translate(card.x + cardSize / 2, card.y + cardSize / 2);
      ctx.rotate((card.rotate * Math.PI) / 180);
      drawTimelineCoverCard(ctx, card.image, -cardSize / 2, -cardSize / 2, cardSize, card.label);
      ctx.restore();
    });

    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: "resultTimelineCanvas",
        width,
        height,
        destWidth: width,
        destHeight: height,
        success: (res) => {
          if (this.timelineImageKey === imageKey) this.setData({ timelineImageUrl: res.tempFilePath });
        }
      }, this);
    });
  },

  getTimelineImageUrl() {
    return this.data.timelineImageUrl || "";
  },

  onShareAppMessage() {
    const resultId = this.publishCurrentSharedResult("chat");
    if (resultId) {
      return {
        title: getShareTitle(this.data.mode, this.data.score, this.getSharingUserName()),
        path: `/pages/result/result?${makeSharedResultQuery(resultId, this.data.shareToken)}`
      };
    }

    return {
      title: "来测测你和朋友的音乐默契",
      path: "/pages/home/home"
    };
  },

  onShareTimeline() {
    const resultId = this.publishCurrentSharedResult("timeline");
    const imageUrl = this.getTimelineImageUrl();
    if (resultId) {
      const payload = {
        title: getTimelineShareTitle(this.data.mode, this.data.score, this.getSharingUserName()),
        query: makeSharedResultQuery(resultId, this.data.shareToken)
      };
      if (imageUrl) payload.imageUrl = imageUrl;
      return payload;
    }

    return {
      title: "来测测你和朋友的音乐默契",
      query: ""
    };
  }
});
