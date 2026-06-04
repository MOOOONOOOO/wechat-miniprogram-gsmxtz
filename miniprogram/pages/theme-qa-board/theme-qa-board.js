const { createChallenge, getMiniProgramCode, getSharedResult, publishSharedResult, submitAnswer } = require("../../utils/api");
const { ensureChallenge, needsChallenge } = require("../../utils/challengeState");
const { readFriendDraft } = require("../../utils/friendDraft");
const { compareQaAnswers } = require("../../utils/result");
const {
  getCreatedResult,
  getParticipatedResult,
  saveCreatedChallenge,
  saveParticipatedResult
} = require("../../utils/history");
const { ensureStableAccountProfile, readCachedProfile, resolveCloudFileUrl, saveAccountProfile } = require("../../utils/profile");

function readChoices(role) {
  const app = getApp();
  return role === "friend" || role === "result" ? (app.globalData.friendChoices || {}) : (app.globalData.creatorChoices || {});
}

function countFilled(prompts, choices) {
  return (prompts || []).filter((prompt) => {
    const song = choices[prompt.id] || {};
    return song.trackId;
  }).length;
}

function areAllFilled(prompts, choices) {
  return Array.isArray(prompts) && prompts.length === 9 && countFilled(prompts, choices) === prompts.length;
}

function hasQaCreatorAnswers(challenge = {}) {
  const prompts = challenge.qaPrompts || [];
  const choices = challenge.creatorChoices || {};
  return Array.isArray(prompts) && prompts.length === 9 && prompts.some((prompt) => {
    const song = choices[prompt.id] || {};
    return Boolean(song.trackId);
  });
}

function getSongName(song) {
  return song.name || song.trackName || "选一首歌";
}

function getSongAlbumName(song) {
  return song.album || song.collectionName || "";
}

function getSongCover(song) {
  return (song && (song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || song.avatarUrl)) || "";
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

function prepareCreatorProfile() {
  const app = getApp();
  const profile = app.globalData.creatorProfile || readCachedProfile();
  return saveAccountProfile(profile);
}

function friendProfileKey(challengeId) {
  return challengeId ? `friendProfile:${challengeId}` : "friendProfile";
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

function getQaInviteShareTitle(profile) {
  const nickName = String((profile || {}).nickName || "我").trim() || "我";
  return `来填${nickName}的歌单问答`;
}

function makeSharedResultQuery(resultId, shareToken) {
  const query = `sharedResultId=${encodeURIComponent(resultId || "")}`;
  return shareToken ? `${query}&shareToken=${encodeURIComponent(shareToken)}` : query;
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
    data.resultId || data.sharedResultId || data.inviteChallengeId || "",
    data.role || "",
    ...(covers || [])
  ].join("|");
}

Page({
  data: {
    role: "creator",
    prompts: [],
    selectedCount: 0,
    isComplete: false,
    actionClass: "",
    primaryLabel: "邀请填写",
    creating: false,
    savingImage: false,
    readonly: false,
    showSaveButton: true,
    displayProfile: {},
    challengeId: "",
    resultId: "",
    sharedResultId: "",
    shareToken: "",
    inviteChallengeId: "",
    inviteShareReady: false,
    homeQrCodeUrl: "",
    timelineImageUrl: ""
  },

  onLoad(options) {
    if (options.timelineInvite && options.challengeId) {
      wx.redirectTo({
        url: `/pages/friend/friend?challengeId=${encodeURIComponent(options.challengeId)}`
      });
      return;
    }

    if (options.sharedResultId) {
      showPageShareMenu();
      this.loadSharedResult(
        decodeURIComponent(options.sharedResultId),
        options.shareToken ? decodeURIComponent(options.shareToken) : ""
      );
      return;
    }

    if (options.history === "created" && options.challengeId && options.resultId) {
      showPageShareMenu();
      this.loadCreatedResult(options.challengeId, options.resultId);
      return;
    }
    if (options.history === "participated" && options.challengeId) {
      showPageShareMenu();
      this.loadParticipatedResult(options.challengeId);
      return;
    }

    const role = options.role || "creator";
    const challengeId = options.challengeId
      ? decodeURIComponent(options.challengeId)
      : ((getApp().globalData.challenge || {}).challengeId || "");
    if (role === "friend" && challengeId && needsChallenge(challengeId)) {
      wx.showLoading({ title: "读取挑战" });
      ensureChallenge(challengeId)
        .then(() => this.initQaBoard({ ...options, challengeId }))
        .catch(() => {
          wx.showToast({ title: "挑战不存在", icon: "none" });
        })
        .finally(() => wx.hideLoading());
      return;
    }

    this.initQaBoard({ ...options, challengeId });
  },

  initQaBoard(options) {
    const role = options.role || "creator";
    const challengeId = options.challengeId || ((getApp().globalData.challenge || {}).challengeId || "");
    if (role === "creator") hidePageShareMenu();
    else showPageShareMenu();
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    if (role === "friend" && challengeId) {
      const draft = readFriendDraft(challengeId);
      if (!Object.keys(app.globalData.friendChoices || {}).length && Object.keys(draft.friendChoices || {}).length) {
        app.globalData.friendChoices = draft.friendChoices;
      }
      if (draft.friendProfile && (draft.friendProfile.nickName || draft.friendProfile.avatarUrl)) {
        app.globalData.friendProfile = draft.friendProfile;
      }
    }
    const prompts = (app.globalData.draftQaPrompts || []).length
      ? app.globalData.draftQaPrompts
      : (challenge.qaPrompts || []);
    app.globalData.draftMode = "qa";
    app.globalData.draftQaPrompts = prompts;
    app.globalData.draftQaArtists = app.globalData.draftQaArtists || {};
    if (role === "friend") app.globalData.friendChoices = app.globalData.friendChoices || {};
    else app.globalData.creatorChoices = app.globalData.creatorChoices || {};
    this.setData({
      role,
      challengeId,
      actionClass: role === "friend" ? "single" : "",
      primaryLabel: role === "friend" ? "生成结果" : "邀请填写",
      readonly: false,
      showSaveButton: role !== "friend",
      displayProfile: role === "friend"
        ? (app.globalData.friendProfile || readCachedProfile())
        : (app.globalData.creatorProfile || readCachedProfile())
    }, () => this.renderPrompts());
  },

  onShow() {
    this.renderPrompts();
  },

  renderPrompts() {
    const app = getApp();
    const choices = readChoices(this.data.role);
    const basePrompts = (app.globalData.draftQaPrompts || []).length
      ? app.globalData.draftQaPrompts
      : (((app.globalData.challenge || {}).qaPrompts) || []);
    const prompts = basePrompts.map((prompt) => {
      const song = choices[prompt.id] || {};
      return {
        ...prompt,
        song,
        songName: getSongName(song),
        songArtistName: song.artistName || " ",
        songAlbumName: getSongAlbumName(song),
        doneClass: song.trackId ? "done" : ""
      };
    });
    const selectedCount = countFilled(basePrompts, choices);
    this.setData({
      prompts,
      selectedCount,
      isComplete: areAllFilled(basePrompts, choices)
    }, () => {
      if (this.data.role === "creator" && !this.data.readonly && basePrompts.length === 9) {
        this.ensureInviteChallenge(basePrompts).catch(() => {});
      }
      this.prepareTimelineImage();
    });
  },

  choosePrompt(event) {
    if (this.data.readonly) return;
    const slotId = event.currentTarget.dataset.id;
    if (!slotId) return;
    const app = getApp();
    app.globalData.currentQaSlotId = slotId;
    app.globalData.draftMode = "qa";
    wx.navigateTo({
      url: `/pages/artists/artists?mode=qa&role=${this.data.role}&slotId=${slotId}&challengeId=${encodeURIComponent(this.data.challengeId || "")}`
    });
  },

  primaryAction() {
    if (this.data.readonly) {
      wx.reLaunch({ url: "/pages/home/home" });
      return;
    }
    const prompts = (getApp().globalData.draftQaPrompts || []).length
      ? getApp().globalData.draftQaPrompts
      : (((getApp().globalData.challenge || {}).qaPrompts) || []);
    const choices = readChoices(this.data.role);
    if (!areAllFilled(prompts, choices)) {
      wx.showToast({ title: "先填满 9 个问答格", icon: "none" });
      this.renderPrompts();
      return;
    }
    if (this.data.role === "friend") {
      this.submitFriendQaResult(prompts, choices);
      return;
    }
    this.createQaChallenge();
  },

  submitFriendQaResult(prompts, choices) {
    if (this.data.creating) return;
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const challengeId = this.data.challengeId || challenge.challengeId || "";
    if (!challengeId) {
      wx.showToast({ title: "挑战信息丢失，请重新进入", icon: "none" });
      return;
    }
    this.setData({ creating: true });
    wx.showLoading({ title: "生成中" });
    this.prepareFriendProfileForSubmit(challengeId)
      .then((friendProfile) => submitAnswerWithRetry({
        challengeId,
        friendChoices: choices,
        friendTopSongs: app.globalData.friendTopSongs,
        friendProfile
      }).then((res) => ({ res, friendProfile })))
      .then(({ res, friendProfile }) => {
        if (res.avatarStatus) {
          this.setData({ friendAvatarSubmitStatus: res.avatarStatus });
          const finalType = res.avatarStatus.finalType || res.avatarStatus.after || "empty";
          if (finalType !== "cloud" && finalType !== "remote") {
            console.warn("friend avatar was not saved as a stable URL", res.avatarStatus);
          }
        }
        const result = res.result || compareQaAnswers(prompts, challenge.creatorChoices || {}, choices);
        const resultId = res.resultId || res.submissionId || "";
        const isPairedQa = challenge.qaSolo !== true && hasQaCreatorAnswers(challenge);
        saveParticipatedResult({
          challengeId,
          mode: "qa",
          resultId,
          shareToken: res.shareToken || "",
          result,
          resultCopy: "",
          challenge,
          friendChoices: choices,
          friendTopSongs: [],
          friendProfile,
          creatorProfile: challenge.creatorProfile || {},
          savedAt: Date.now()
        });
        if (isPairedQa) {
          wx.redirectTo({ url: `/pages/result/result?restore=1&challengeId=${encodeURIComponent(challengeId)}` });
          return;
        }
        this.setData({
          resultId,
          shareToken: res.shareToken || "",
          readonly: true,
          actionClass: "",
          primaryLabel: "回到首页",
          showSaveButton: true,
          displayProfile: friendProfile || readCachedProfile()
        }, () => this.renderPrompts());
        this.prepareCurrentResultForSharing(resultId);
      }).catch(() => {
        wx.showToast({ title: "结果保存失败", icon: "none" });
      }).finally(() => {
        wx.hideLoading();
        this.setData({ creating: false });
      });
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

  createQaChallenge() {
    if (this.data.creating) return;
    const prompts = (getApp().globalData.draftQaPrompts || []).slice(0, 9);
    const choices = getApp().globalData.creatorChoices || {};
    if (!areAllFilled(prompts, choices)) {
      wx.showToast({ title: "先填满 9 个问答格", icon: "none" });
      this.renderPrompts();
      return;
    }
    this.setData({ creating: true });
    wx.showLoading({ title: "创建中" });
    const app = getApp();
    prepareCreatorProfile()
      .then((creatorProfile) => createChallenge({
        mode: "qa",
        qaOnly: true,
        qaPrompts: prompts,
        creatorChoices: choices,
        creatorProfile
      }))
      .then((res) => {
        app.globalData.challenge = {
          challengeId: res.challengeId,
          mode: "qa",
          qaPrompts: prompts,
          creatorChoices: choices,
          creatorProfile: app.globalData.creatorProfile || wx.getStorageSync("creatorProfile") || {},
          createdAt: Date.now()
        };
        this.setData({
          inviteChallengeId: res.challengeId,
          inviteShareReady: true
        });
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

  getPromptKey(prompts) {
    return (prompts || []).map((prompt) => `${prompt.id}:${prompt.prompt || prompt.title || ""}`).join("|");
  },

  ensureInviteChallenge(prompts) {
    const safePrompts = (prompts || []).slice(0, 9);
    if (safePrompts.length !== 9) return Promise.reject(new Error("先选择 9 个问题"));
    const promptKey = this.getPromptKey(safePrompts);
    const app = getApp();
    const currentChallenge = app.globalData.challenge || {};

    if (currentChallenge.challengeId && this.getPromptKey(currentChallenge.qaPrompts || []) === promptKey) {
      this.setData({
        inviteChallengeId: currentChallenge.challengeId,
        inviteShareReady: true
      });
      showPageShareMenu();
      return Promise.resolve(currentChallenge);
    }

    if (this.inviteChallengePromise && this.invitePromptKey === promptKey) return this.inviteChallengePromise;
    this.invitePromptKey = promptKey;
    this.inviteChallengePromise = prepareCreatorProfile()
      .then((creatorProfile) => createChallenge({
        mode: "qa",
        qaOnly: true,
        qaSolo: true,
        qaPrompts: safePrompts,
        artists: [],
        albums: [],
        colors: [],
        creatorChoices: {},
        creatorProfile
      }))
      .then((res) => {
        const challenge = {
          challengeId: res.challengeId,
          mode: "qa",
          qaSolo: true,
          qaPrompts: safePrompts,
          creatorChoices: {},
          creatorProfile: app.globalData.creatorProfile || wx.getStorageSync("creatorProfile") || {},
          createdAt: Date.now()
        };
        app.globalData.challenge = challenge;
        app.globalData.draftQaPrompts = safePrompts;
        this.setData({
          inviteChallengeId: res.challengeId,
          inviteShareReady: true
        });
        saveCreatedChallenge(challenge);
        showPageShareMenu();
        return challenge;
      })
      .finally(() => {
        this.inviteChallengePromise = null;
      });
    return this.inviteChallengePromise;
  },

  loadCreatedResult(challengeId, resultId) {
    const created = getCreatedResult(challengeId, resultId);
    if (!created) {
      wx.showToast({ title: "记录不存在", icon: "none" });
      return;
    }
    const { challengeRecord, resultRecord } = created;
    const app = getApp();
    const challenge = challengeRecord.challenge || {};
    app.globalData.challenge = challenge;
    app.globalData.draftMode = "qa";
    app.globalData.draftThemeTemplate = "qa";
    app.globalData.draftQaPrompts = challenge.qaPrompts || [];
    app.globalData.friendChoices = resultRecord.friendChoices || {};
    app.globalData.friendProfile = resultRecord.friendProfile || {};
    this.setData({
      role: "result",
      readonly: true,
      actionClass: "",
      primaryLabel: "回到首页",
      showSaveButton: true,
      resultId: resultRecord.resultId || "",
      shareToken: resultRecord.shareToken || "",
      displayProfile: resultRecord.friendProfile || {},
      prompts: [],
      selectedCount: 0,
      isComplete: false
    }, () => this.renderPrompts());
    this.prepareCurrentResultForSharing(resultRecord.resultId || "");
  },

  loadParticipatedResult(challengeId) {
    const record = getParticipatedResult(challengeId);
    if (!record) {
      wx.showToast({ title: "记录不存在", icon: "none" });
      return;
    }
    const app = getApp();
    const challenge = record.challenge || {};
    app.globalData.challenge = challenge;
    app.globalData.draftMode = "qa";
    app.globalData.draftThemeTemplate = "qa";
    app.globalData.draftQaPrompts = challenge.qaPrompts || [];
    app.globalData.friendChoices = record.friendChoices || {};
    app.globalData.friendProfile = record.friendProfile || {};
    this.setData({
      role: "result",
      readonly: true,
      actionClass: "",
      primaryLabel: "回到首页",
      showSaveButton: true,
      resultId: record.resultId || "",
      shareToken: record.shareToken || "",
      displayProfile: record.friendProfile || {},
      prompts: [],
      selectedCount: 0,
      isComplete: false
    }, () => this.renderPrompts());
    this.prepareCurrentResultForSharing(record.resultId || "");
  },

  loadSharedResult(sharedResultId, shareToken = "") {
    wx.showLoading({ title: "读取分享" });
    getSharedResult({ resultId: sharedResultId, shareToken })
      .then((res) => {
        if (!res.challenge || !res.submission || (res.challenge || {}).mode !== "qa") {
          wx.showToast({ title: "分享结果不存在", icon: "none" });
          return;
        }
        const app = getApp();
        const challenge = res.challenge || {};
        app.globalData.challenge = challenge;
        app.globalData.draftMode = "qa";
        app.globalData.draftThemeTemplate = "qa";
        app.globalData.draftQaPrompts = challenge.qaPrompts || [];
        app.globalData.friendChoices = (res.submission || {}).friendChoices || {};
        app.globalData.friendProfile = (res.submission || {}).friendProfile || {};
        this.setData({
          role: "result",
          readonly: true,
          actionClass: "",
          primaryLabel: "回到首页",
          showSaveButton: true,
          resultId: res.resultId || sharedResultId,
          sharedResultId: res.resultId || sharedResultId,
          shareToken: res.shareToken || shareToken || "",
          displayProfile: (res.submission || {}).friendProfile || {},
          prompts: [],
          selectedCount: 0,
          isComplete: false
        }, () => this.renderPrompts());
        this.prepareCurrentResultForSharing(res.resultId || sharedResultId);
      })
      .catch(() => {
        wx.showToast({ title: "分享已失效", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  },

  saveImage() {
    if (!this.data.isComplete || this.data.savingImage) return;
    this.setData({ savingImage: true });
    wx.showLoading({ title: "绘制中..." });
    this.drawQaCanvas()
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

  drawQaCanvas() {
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
    const ctx = wx.createCanvasContext("qaCanvas", this);
    const prompts = this.data.prompts;
    const profile = this.data.displayProfile || getApp().globalData.creatorProfile || readCachedProfile();
    const nickName = profile.nickName || "匿名挑战者";
    const avatarPromise = resolveCloudFileUrl(profile.avatarUrl || "").then((avatarUrl) => getImageInfo(avatarUrl));

    return Promise.all([
      Promise.all(prompts.map((item) => getImageInfo((item.song || {}).cover))),
      avatarPromise,
      this.getHomeQrCodeUrl().then((url) => getImageInfoWithRetry(url))
    ]).then(([images, avatarImage, qrImage]) => new Promise((resolve, reject) => {
      ctx.setFillStyle("#f6f0e7");
      ctx.fillRect(0, 0, width, height);
      ctx.setFillStyle("#171512");
      ctx.setFontSize(44);
      ctx.fillText("歌单问答", margin, 76);
      drawCircleImage(ctx, avatarImage, width - margin - 52, 38, 52, nickName);
      drawRightFitText(ctx, nickName, width - margin - 66, 72, 220, 24, 16, "#171512");

      prompts.forEach((item, index) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const x = margin + col * (cardWidth + gap);
        const y = 126 + row * (cardHeight + gap);
        const song = item.song || {};
        const image = images[index];
        const infoX = x + cardPadding;
        const coverTop = y + cardPadding + 42;
        const infoTop = coverTop + coverSize + 28;
        const textWidth = cardWidth - cardPadding * 2;

        ctx.save();
        if (ctx.setShadow) ctx.setShadow(0, 8, 14, "rgba(23,21,18,.15)");
        fillRoundRect(ctx, x, y, cardWidth, cardHeight, 4, "#fffdfa");
        ctx.restore();
        drawEllipsizedText(ctx, item.prompt || item.title, infoX, y + cardPadding + 23, textWidth, 22, "#171512");

        ctx.save();
        drawRoundRectPath(ctx, x + cardPadding, coverTop, coverSize, coverSize, 2);
        ctx.clip();
        ctx.setFillStyle("#f1ebe2");
        ctx.fillRect(x + cardPadding, coverTop, coverSize, coverSize);
        drawImageCover(ctx, image, x + cardPadding, coverTop, coverSize, coverSize);
        ctx.restore();

        drawEllipsizedText(ctx, getSongName(song), infoX, infoTop, textWidth, 22, "#171512");
        drawEllipsizedText(ctx, song.artistName || "", infoX, infoTop + 24, textWidth, 18, "#171512");
        drawEllipsizedText(ctx, getSongAlbumName(song), infoX, infoTop + 46, textWidth, 17, "#171512");
      });

      drawFitText(ctx, "在这个混乱的世代感谢还有音乐。", margin, footerTop + 70, width - margin * 3 - qrSize, 25, 18, "#171512");
      fillRoundRect(ctx, width - margin - qrSize, footerTop, qrSize, qrSize, 8, "#fffdfa");
      if (qrImage && qrImage.path) {
        ctx.drawImage(qrImage.path, width - margin - qrSize + 8, footerTop + 8, qrSize - 16, qrSize - 16);
      }

      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "qaCanvas",
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

  prepareTimelineImage() {
    const covers = pickTimelineImages((this.data.prompts || []).map((item) => getSongCover((item || {}).song || {})));
    const imageKey = makeTimelineImageKey(this.data, covers);
    if (!covers.length || !this.data.resultId) {
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
      this.drawTimelineCanvas(coverImages, imageKey);
    }).catch(() => {});
  },

  drawTimelineCanvas(coverImages, imageKey) {
    const ctx = wx.createCanvasContext("qaTimelineCanvas", this);
    const width = 1000;
    const height = 1000;
    const cardSize = 420;
    const cards = [
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
      drawTimelineCoverCard(ctx, card.image, -cardSize / 2, -cardSize / 2, cardSize, card.label);
      ctx.restore();
    });

    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: "qaTimelineCanvas",
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

  publishCurrentSharedResult(channel) {
    const resultId = this.data.resultId || "";
    if (!resultId || !this.data.shareToken) {
      if (resultId) wx.showToast({ title: "结果分享准备中", icon: "none" });
      return "";
    }
    publishSharedResult({
      resultId,
      channel
    }).then((res) => {
      if (this.data.resultId === resultId && res.shareToken) {
        this.setData({ shareToken: res.shareToken });
      }
    }).catch(() => {});
    return resultId;
  },

  prepareCurrentResultForSharing(resultId) {
    const currentResultId = resultId || this.data.resultId || "";
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

  onShareAppMessage() {
    const resultId = this.publishCurrentSharedResult("chat");
    const nickName = (this.data.displayProfile || {}).nickName || "我";
    if (resultId) {
      return {
        title: `${nickName}的歌单问答结果`,
        path: `/pages/theme-qa-board/theme-qa-board?${makeSharedResultQuery(resultId, this.data.shareToken)}`
      };
    }
    if (this.data.inviteChallengeId) {
      return {
        title: getQaInviteShareTitle(this.data.displayProfile || readCachedProfile()),
        path: `/pages/friend/friend?challengeId=${this.data.inviteChallengeId}`
      };
    }
    return {
      title: `来填${nickName}的歌单问答`,
      path: "/pages/home/home"
    };
  },

  onShareTimeline() {
    const resultId = this.publishCurrentSharedResult("timeline");
    const nickName = (this.data.displayProfile || {}).nickName || "我";
    if (resultId) {
      const imageUrl = this.data.timelineImageUrl || "";
      const payload = {
        title: `你好，人，${nickName}的歌单问答结果，点进来看看吧。`,
        query: makeSharedResultQuery(resultId, this.data.shareToken)
      };
      if (imageUrl) payload.imageUrl = imageUrl;
      return payload;
    }
    if (this.data.inviteChallengeId) {
      return {
        title: getQaInviteShareTitle(this.data.displayProfile || readCachedProfile()),
        query: `timelineInvite=1&challengeId=${encodeURIComponent(this.data.inviteChallengeId)}`
      };
    }
    return {
      title: `来填${nickName}的歌单问答`,
      query: ""
    };
  }
});
