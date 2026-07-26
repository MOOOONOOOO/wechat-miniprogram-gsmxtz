const { getThemeTemplate } = require("../../data/themeTemplates");
const {
  createChallenge,
  getMiniProgramCode,
  getRecentSubmission,
  getSharedResult,
  publishSharedResult,
  renderTreeVideo,
  submitAnswer
} = require("../../utils/api");
const { ensureChallenge, needsChallenge } = require("../../utils/challengeState");
const { saveFriendDraft } = require("../../utils/friendDraft");
const { getCreatedResult, saveCreatedChallenge, saveParticipatedResult } = require("../../utils/history");
const { getResultSnapshot, saveResultSnapshot } = require("../../utils/resultSnapshot");
const { imageShareMethods } = require("../../utils/imageShare");
const { getSongName } = require("../../utils/songIdentity");
const { ensureStableAccountProfile, readCachedProfile, resolveCloudFileUrl } = require("../../utils/profile");
const {
  creatorProfileGateData,
  creatorProfileGateMethods,
  prepareCreatorProfileForCreate
} = require("../../utils/creatorProfileGate");

const GROWTH_STEP_MS = 150;
const GROWTH_START_DELAY_MS = 260;
const PEOPLE_REVEAL_DURATION_MS = 560;
const TREE_START_AFTER_PEOPLE_MS = 120;
const TREE_SHARE_WIDTH = 1000;
const TREE_SHARE_HEIGHT = 800;
const TREE_VIDEO_WIDTH = 720;
const TREE_VIDEO_HEIGHT = 1382;
const TREE_PREVIEW_LEFT = [
  "飞", "青火", "胆小鬼", "下个日出", "与世界和解", "到不了的季节", "想把我唱给你听",
  "要去有你在的地方", "这个世界不能没有你", "我的人生是有趣的剧本", "我要把你丢到后海里喂鱼",
  "我要你", "和你", "靠近"
];
const TREE_PREVIEW_RIGHT = [
  "蓝", "心墙", "猜不透", "普通的歌", "遗失的心跳", "你要的全拿走", "From The Start",
  "那些你很冒险的梦", "用尽我的一切奔向你", "Be what you wanna be", "如果有一天我变得很有钱",
  "半点心", "心动", "虚拟"
];
const TREE_BRANCH_GUIDE = {
  "tree-04": "你先填左边",
  "tree-06": "填好再分享给朋友",
  "tree-08": "点击绿色开始",
  "tree-10": "最后看结果"
};

function buildSnowflakes(count = 72) {
  return Array.from({ length: count }, (_, index) => {
    const size = 7 + (index * 7) % 11;
    const duration = 5.2 + ((index * 13) % 42) / 10;
    const delay = -((index * 17) % 90) / 10;
    const opacity = 0.56 + ((index * 11) % 38) / 100;
    return {
      id: `snow-${index + 1}`,
      driftClass: ["drift-left", "drift-center", "drift-right"][index % 3],
      style: [
        `left:${(index * 37 + 9) % 100}%`,
        `width:${size}rpx`,
        `height:${size}rpx`,
        `opacity:${opacity}`,
        `animation-duration:${duration}s`,
        `animation-delay:${delay}s`
      ].join(";")
    };
  });
}

function readTreePrompts() {
  const template = getThemeTemplate("tree") || {};
  return (template.prompts || []).map((prompt) => ({ ...prompt }));
}

function isLatinTitle(value) {
  return /[A-Za-z]/.test(String(value || ""));
}

function getRowWidth(row) {
  return row.part === "trunk" ? (row.count === 3 ? 120 : 94) : 42 + row.count * 26;
}

function getRevealMap(rows) {
  return (rows || []).reduce((map, row) => {
    map[row.id] = row.revealClass || "";
    return map;
  }, {});
}

function decorateRows(prompts, ownChoices, creatorChoices, activeSlotId, started, viewRole, viewerRole, revealMap = {}) {
  return (prompts || []).map((row, index) => {
    const ownSong = (ownChoices || {})[row.id] || null;
    const creatorSong = (creatorChoices || {})[row.id] || null;
    const leftSong = viewRole === "creator" ? ownSong : creatorSong;
    const rightSong = viewRole === "creator" ? null : ownSong;
    const leftText = getSongName(leftSong);
    const rightText = getSongName(rightSong);
    const activeLeft = Boolean(started && viewRole === "creator" && !leftText && row.id === activeSlotId);
    const activeRight = Boolean(started && viewRole === "friend" && !rightText && row.id === activeSlotId);
    const branchGuide = !started && viewRole === "creator" ? (TREE_BRANCH_GUIDE[row.id] || "") : "";
    const rightGuide = row.id === "tree-08" && !rightText
      ? (viewRole === "friend" && !started ? "点击绿色部分填写" : "")
      : "";
    const friendView = viewerRole === "friend";
    const leftBubbleClass = friendView ? "yours" : "mine";
    const rightBubbleClass = friendView ? "mine" : "yours";
    return {
      ...row,
      part: row.part || "crown",
      firstTrunkClass: index === 11 ? "first-trunk" : "",
      width: getRowWidth(row),
      leftText,
      rightText,
      branchGuide,
      rightGuide,
      leftClass: [leftBubbleClass, leftText ? "filled" : "empty", activeLeft ? "active" : "", isLatinTitle(leftText) ? "latin" : ""].filter(Boolean).join(" "),
      rightClass: [rightBubbleClass, rightText ? "filled" : "waiting", activeRight ? "active" : "", isLatinTitle(rightText) ? "latin" : ""].filter(Boolean).join(" "),
      leftPlaceholder: activeLeft ? "+" : "",
      rightPlaceholder: activeRight ? "+" : "",
      revealClass: revealMap[row.id] || ""
    };
  });
}

function findNextEmptySlot(prompts, choices) {
  return (prompts || []).find((prompt) => !getSongName((choices || {})[prompt.id])) || null;
}

function buildPreviewChoices(prompts, names, side, covers = []) {
  return (prompts || []).reduce((choices, prompt, index) => {
    const cover = covers.length ? covers[index % covers.length] : "";
    choices[prompt.id] = {
      trackId: `tree-preview-${side}-${index + 1}`,
      name: names[index] || "",
      cover,
      coverUrl: cover,
      artworkUrl600: cover
    };
    return choices;
  }, {});
}

function decorateProfile(profile, fallbackName) {
  const safeProfile = profile || {};
  const nickName = String(safeProfile.nickName || fallbackName || "朋友").trim();
  return {
    nickName,
    avatarUrl: safeProfile.avatarUrl || "",
    initial: nickName.slice(0, 1) || "友"
  };
}

function fillRoundRect(ctx, x, y, width, height, radius, color) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.setFillStyle(color);
  ctx.fill();
}

function drawPosterBubble(ctx, x, y, width, text, side, isMine = side === "left") {
  const height = 85;
  const tailHalfHeight = 13;
  const tailWidth = 16;
  const color = isMine ? "#95ec69" : "#ffffff";
  fillRoundRect(ctx, x, y, width, height, 11, color);
  ctx.beginPath();
  if (side === "left") {
    ctx.moveTo(x + width, y + height / 2 - tailHalfHeight);
    ctx.lineTo(x + width + tailWidth, y + height / 2);
    ctx.lineTo(x + width, y + height / 2 + tailHalfHeight);
  } else {
    ctx.moveTo(x, y + height / 2 - tailHalfHeight);
    ctx.lineTo(x - tailWidth, y + height / 2);
    ctx.lineTo(x, y + height / 2 + tailHalfHeight);
  }
  ctx.closePath();
  ctx.setFillStyle(color);
  ctx.fill();

  const horizontalPadding = 19;
  let fontSize = /[A-Za-z]/.test(text) ? 32 : 35;
  ctx.setFontSize(fontSize);
  while (fontSize > 18 && ctx.measureText(text).width > width - horizontalPadding * 2) {
    fontSize -= 1;
    ctx.setFontSize(fontSize);
  }
  ctx.setFillStyle("#111111");
  ctx.setTextAlign(side === "left" ? "right" : "left");
  ctx.setTextBaseline("middle");
  ctx.fillText(
    text,
    side === "left" ? x + width - horizontalPadding : x + horizontalPadding,
    y + height / 2 + 1
  );
}

function drawShareBubble(ctx, x, y, width, text, side, isMine = side === "left") {
  const height = 26;
  const color = isMine ? "#95ec69" : "#ffffff";
  fillRoundRect(ctx, x, y, width, height, 5, color);
  ctx.beginPath();
  if (side === "left") {
    ctx.moveTo(x + width, y + 8);
    ctx.lineTo(x + width + 6, y + 13);
    ctx.lineTo(x + width, y + 18);
  } else {
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x - 6, y + 13);
    ctx.lineTo(x, y + 18);
  }
  ctx.closePath();
  ctx.setFillStyle(color);
  ctx.fill();

  let fontSize = /[A-Za-z]/.test(text) ? 12 : 14;
  ctx.setFontSize(fontSize);
  while (fontSize > 8 && ctx.measureText(text).width > width - 12) {
    fontSize -= 1;
    ctx.setFontSize(fontSize);
  }
  ctx.setFillStyle("#111111");
  ctx.setTextAlign("center");
  ctx.setTextBaseline("middle");
  ctx.fillText(text, x + width / 2, y + height / 2 + 1);
}

function getSongCover(song) {
  return (song && (
    song.cover
    || song.coverUrl
    || song.artworkUrl600
    || song.artworkUrl100
  )) || "";
}

function pickRandomTreeCovers(choiceGroups, count = 3) {
  const seen = {};
  const covers = (choiceGroups || [])
    .reduce((songs, choices) => songs.concat(Object.values(choices || {})), [])
    .map(getSongCover)
    .filter((cover) => {
      if (!cover || seen[cover]) return false;
      seen[cover] = true;
      return true;
    });
  for (let index = covers.length - 1; index > 0; index -= 1) {
    const pickedIndex = Math.floor(Math.random() * (index + 1));
    const pickedCover = covers[pickedIndex];
    covers[pickedIndex] = covers[index];
    covers[index] = pickedCover;
  }
  return covers.slice(0, count);
}

function drawShareCover(ctx, imagePath, x, y, size) {
  ctx.save();
  fillRoundRect(ctx, x - 5, y - 5, size + 10, size + 10, 9, "rgba(255,255,255,.86)");
  ctx.beginPath();
  ctx.moveTo(x + 7, y);
  ctx.arcTo(x + size, y, x + size, y + size, 7);
  ctx.arcTo(x + size, y + size, x, y + size, 7);
  ctx.arcTo(x, y + size, x, y, 7);
  ctx.arcTo(x, y, x + size, y, 7);
  ctx.closePath();
  ctx.clip();
  if (imagePath) {
    ctx.drawImage(imagePath, x, y, size, size);
  } else {
    ctx.setFillStyle("#d9d3ca");
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function readCanvasImage(src) {
  if (!src) return Promise.resolve(null);
  return resolveCloudFileUrl(src)
    .then((resolvedUrl) => new Promise((resolve) => {
      wx.getImageInfo({
        src: resolvedUrl,
        success: (res) => resolve(res.path || resolvedUrl),
        fail: () => resolve(null)
      });
    }))
    .catch(() => null);
}

function drawCenteredResultFooter(ctx, text, qrPath, centerX, centerY, options = {}) {
  const fontSize = Number(options.fontSize || 24);
  const qrSize = Number(options.qrSize || 64);
  const gap = Number(options.gap || 12);
  const separator = "丨";
  const safeText = String(text || "两颗歌单没有撞歌，但刚好拼成了同一棵树");

  ctx.setFontSize(fontSize);
  const textWidth = ctx.measureText(safeText).width;
  const separatorWidth = ctx.measureText(separator).width;
  const groupWidth = textWidth + gap + separatorWidth + gap + qrSize;
  const groupX = centerX - groupWidth / 2;
  const separatorX = groupX + textWidth + gap;
  const qrX = separatorX + separatorWidth + gap;
  const qrY = centerY - qrSize / 2;

  ctx.setFillStyle("#4b4b4b");
  ctx.setTextAlign("left");
  ctx.setTextBaseline("middle");
  ctx.fillText(safeText, groupX, centerY);
  ctx.fillText(separator, separatorX, centerY);
  fillRoundRect(ctx, qrX, qrY, qrSize, qrSize, 5, "#ffffff");
  if (qrPath) {
    const inset = Math.max(3, Math.round(qrSize * 0.06));
    ctx.drawImage(qrPath, qrX + inset, qrY + inset, qrSize - inset * 2, qrSize - inset * 2);
  }
}

function drawPosterSnow(ctx, width, height, count = 72) {
  ctx.save();
  for (let index = 0; index < count; index += 1) {
    const x = (index * 137 + 53) % width;
    const y = (index * 211 + 89) % height;
    const radius = 2 + (index * 7) % 6;
    const opacity = 0.42 + ((index * 11) % 38) / 100;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.setFillStyle(`rgba(255,255,255,${opacity})`);
    ctx.fill();
  }
  ctx.restore();
}

function drawPosterProfile(ctx, profile, imagePath, centerX, centerY, color, side, options = {}) {
  const radius = Number(options.radius || 35);
  const fontSize = Number(options.fontSize || 22);
  const strokeWidth = Number(options.strokeWidth || 4);
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (imagePath) {
    ctx.drawImage(imagePath, centerX - radius, centerY - radius, radius * 2, radius * 2);
  } else {
    ctx.setFillStyle(color);
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.setFillStyle("#173f27");
    ctx.setFontSize(28);
    ctx.setTextAlign("center");
    ctx.setTextBaseline("middle");
    ctx.fillText(profile.initial || "友", centerX, centerY + 1);
  }
  ctx.restore();
  ctx.setStrokeStyle("#ffffff");
  ctx.setLineWidth(strokeWidth);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setFillStyle("#262626");
  ctx.setFontSize(fontSize);
  ctx.setTextAlign(side === "left" ? "right" : "left");
  ctx.setTextBaseline("middle");
  const rawName = String(profile.nickName || "朋友");
  const nickName = rawName.length > 7 ? `${rawName.slice(0, 7)}…` : rawName;
  const nameX = side === "left" ? centerX - radius - 12 : centerX + radius + 12;
  ctx.fillText(nickName, nameX, centerY);
}

Page({
  data: {
    ...creatorProfileGateData,
    rows: [],
    role: "creator",
    viewerRole: "creator",
    challengeId: "",
    resultId: "",
    shareToken: "",
    shareReady: false,
    shareImageLoading: false,
    shareImageUrl: "",
    homeQrCodeUrl: "",
    started: false,
    resultMode: false,
    previewMode: false,
    resultCopy: "",
    activeSlotId: "",
    filledCount: 0,
    isComplete: false,
    creating: false,
    savingImage: false,
    savingVideo: false,
    snowClass: "",
    snowflakes: buildSnowflakes(),
    creatorProfile: decorateProfile({}, "左边朋友"),
    friendProfile: decorateProfile({}, "右边朋友"),
    primaryLabel: "继续选择下一首",
    starClass: "",
    peopleClass: ""
  },

  onLoad(options = {}) {
    if (options.mock === "tree-left") {
      this.loadMockTreeCreator();
      return;
    }
    if (options.preview === "1" || options.mock === "tree") {
      this.loadMockTreeResult();
      return;
    }
    if (options.history === "created" && options.challengeId && options.resultId) {
      this.loadCreatedHistoryResult(
        decodeURIComponent(options.challengeId),
        decodeURIComponent(options.resultId)
      );
      return;
    }
    const sharedResultId = options.sharedResultId ? decodeURIComponent(options.sharedResultId) : "";
    if (sharedResultId) {
      this.loadSharedResult(sharedResultId, options.shareToken ? decodeURIComponent(options.shareToken) : "");
      return;
    }
    const role = options.role === "friend" ? "friend" : "creator";
    const challengeId = options.challengeId ? decodeURIComponent(options.challengeId) : "";
    if (role === "friend" && challengeId && options.restore === "1") {
      const snapshot = getResultSnapshot(challengeId);
      if (snapshot && snapshot.challenge) {
        const app = getApp();
        app.globalData.challenge = snapshot.challenge;
        app.globalData.friendChoices = snapshot.friendChoices || {};
        app.globalData.friendProfile = snapshot.friendProfile || {};
        const matched = Number(((snapshot || {}).result || {}).matchCount || 0);
        this.initTree({
          role,
          viewerRole: "friend",
          challengeId,
          resultMode: true,
          resultId: snapshot.resultId || "",
          shareToken: snapshot.shareToken || "",
          resultCopy: matched ? `你们撞中了 ${matched} 首歌` : "两颗歌单没有撞歌，但刚好拼成了同一棵树"
        });
        return;
      }
      this.loadRecentResult(challengeId);
      return;
    }
    if (role === "friend" && challengeId && needsChallenge(challengeId)) {
      wx.showLoading({ title: "读取挑战" });
      ensureChallenge(challengeId, { resetFriendAnswers: true })
        .then(() => this.initTree({ role, challengeId }))
        .catch(() => wx.showToast({ title: "挑战不存在", icon: "none" }))
        .finally(() => wx.hideLoading());
      return;
    }
    this.initTree({ role, challengeId });
  },

  initTree({ role, viewerRole = role, challengeId, resultMode = false, resultId = "", shareToken = "", resultCopy = "" }) {
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const prompts = role === "friend" && (challenge.treePrompts || []).length
      ? challenge.treePrompts
      : readTreePrompts();
    if (role === "creator" && app.globalData.draftThemeTemplate !== "tree") {
      app.globalData.draftThemeChoices = {};
      app.globalData.draftThemeArtists = {};
    }
    app.globalData.draftMode = "theme";
    app.globalData.draftThemeTemplate = "tree";
    app.globalData.draftThemePrompts = prompts;
    app.globalData.draftThemeChoices = role === "friend"
      ? (challenge.creatorChoices || {})
      : (app.globalData.draftThemeChoices || {});
    app.globalData.draftThemeArtists = app.globalData.draftThemeArtists || {};
    if (role === "friend") app.globalData.friendChoices = app.globalData.friendChoices || {};
    const ownChoices = this.readOwnChoices(role);
    const nextSlot = findNextEmptySlot(prompts, ownChoices);
    const started = Object.keys(ownChoices).length > 0;
    this.setData({
      role,
      viewerRole,
      challengeId: challengeId || challenge.challengeId || "",
      resultId,
      shareToken,
      started: started || resultMode,
      resultMode,
      resultCopy,
      activeSlotId: nextSlot ? nextSlot.id : "",
      rows: decorateRows(
        prompts,
        ownChoices,
        challenge.creatorChoices || app.globalData.draftThemeChoices || {},
        nextSlot ? nextSlot.id : "",
        started || resultMode,
        resultMode ? "result" : role,
        viewerRole
      )
    }, () => this.renderTree(() => {
      if (resultMode && resultId) this.prepareResultSharing();
      if (this.pageReady) this.playGrowthAnimation();
    }));
    if (role === "creator") this.initCreatorProfileGate();
  },

  ...creatorProfileGateMethods,
  ...imageShareMethods,

  readOwnChoices(role = this.data.role) {
    const app = getApp();
    return role === "friend" ? (app.globalData.friendChoices || {}) : (app.globalData.draftThemeChoices || {});
  },

  onReady() {
    this.pageReady = true;
    if (this.data.rows.length) this.playGrowthAnimation();
  },

  onShow() {
    if (!this.data.rows.length) return;
    this.renderTree(() => {
      if (!this.pageReady || this.data.snowClass === "active") return;
      if (this.data.resultMode) this.playGrowthAnimation();
      else this.startSnowEffect();
    });
  },

  onUnload() {
    this.clearGrowthTimers();
    this.stopSnowEffect(false);
  },

  onHide() {
    this.stopSnowEffect();
  },

  loadMockTreeResult() {
    const prompts = readTreePrompts();
    const app = getApp();
    app.globalData.challenge = {
      challengeId: "mock-tree-result",
      mode: "tree",
      treePrompts: prompts,
      creatorChoices: buildPreviewChoices(prompts, TREE_PREVIEW_LEFT, "left"),
      creatorProfile: { nickName: "左边朋友", avatarUrl: "" }
    };
    app.globalData.friendChoices = buildPreviewChoices(prompts, TREE_PREVIEW_RIGHT, "right");
    app.globalData.friendProfile = { nickName: "右边朋友", avatarUrl: "" };
    this.setData({ previewMode: true });
    this.initTree({
      role: "friend",
      viewerRole: "other",
      challengeId: "mock-tree-result",
      resultMode: true,
      resultCopy: ""
    });
  },

  loadMockTreeCreator() {
    const prompts = readTreePrompts();
    const app = getApp();
    app.globalData.challenge = {};
    app.globalData.draftMode = "theme";
    app.globalData.draftThemeTemplate = "tree";
    app.globalData.draftThemePrompts = prompts;
    app.globalData.draftThemeChoices = buildPreviewChoices(
      prompts,
      TREE_PREVIEW_LEFT,
      "left",
      app.globalData.treeMockCovers || []
    );
    app.globalData.draftThemeArtists = {};
    app.globalData.friendChoices = {};
    app.globalData.friendProfile = {};
    this.initTree({ role: "creator", challengeId: "" });
  },

  loadSharedResult(resultId, shareToken) {
    wx.showLoading({ title: "读取结果" });
    getSharedResult({ resultId, shareToken })
      .then((res) => {
        const challenge = res.challenge || {};
        if (challenge.mode !== "tree") throw new Error("不是圣诞树结果");
        const app = getApp();
        app.globalData.challenge = challenge;
        app.globalData.friendChoices = ((res || {}).submission || {}).friendChoices || {};
        app.globalData.friendProfile = ((res || {}).submission || {}).friendProfile || {};
        const matched = Number(((res || {}).result || {}).matchCount || 0);
        this.initTree({
          role: "friend",
          viewerRole: "other",
          challengeId: challenge.challengeId || "",
          resultMode: true,
          resultId: res.resultId || resultId,
          shareToken: res.shareToken || shareToken,
          resultCopy: matched ? `他们撞中了 ${matched} 首歌` : "两颗歌单没有撞歌，但刚好拼成了同一棵树"
        });
      })
      .catch((error) => wx.showToast({ title: (error && error.message) || "结果读取失败", icon: "none" }))
      .finally(() => wx.hideLoading());
  },

  loadRecentResult(challengeId) {
    wx.showLoading({ title: "读取结果" });
    getRecentSubmission(challengeId)
      .then((res) => {
        if (!res.challenge || !res.submission || !res.result || res.challenge.mode !== "tree") {
          throw new Error("暂无可恢复结果");
        }
        const app = getApp();
        app.globalData.challenge = res.challenge;
        app.globalData.friendChoices = res.submission.friendChoices || {};
        app.globalData.friendProfile = res.submission.friendProfile || {};
        const matched = Number((res.result || {}).matchCount || 0);
        this.initTree({
          role: "friend",
          viewerRole: "friend",
          challengeId,
          resultMode: true,
          resultId: res.submission.resultId || res.submission.submissionId || "",
          shareToken: res.submission.shareToken || res.shareToken || "",
          resultCopy: matched ? `你们撞中了 ${matched} 首歌` : "两颗歌单没有撞歌，但刚好拼成了同一棵树"
        });
      })
      .catch((error) => wx.showToast({ title: (error && error.message) || "结果读取失败", icon: "none" }))
      .finally(() => wx.hideLoading());
  },

  loadCreatedHistoryResult(challengeId, resultId) {
    const saved = getCreatedResult(challengeId, resultId);
    if (!saved || !saved.challengeRecord || !saved.resultRecord) {
      wx.showToast({ title: "结果记录不存在", icon: "none" });
      return;
    }
    const challenge = saved.challengeRecord.challenge || {};
    const resultRecord = saved.resultRecord || {};
    const app = getApp();
    app.globalData.challenge = challenge;
    app.globalData.friendChoices = resultRecord.friendChoices || {};
    app.globalData.friendProfile = resultRecord.friendProfile || {};
    const matched = Number(((resultRecord || {}).result || {}).matchCount || 0);
    this.initTree({
      role: "friend",
      viewerRole: "creator",
      challengeId,
      resultMode: true,
      resultId: resultRecord.resultId || resultId,
      shareToken: resultRecord.shareToken || "",
      resultCopy: matched ? `你们撞中了 ${matched} 首歌` : "两颗歌单没有撞歌，但刚好拼成了同一棵树"
    });
  },

  renderTree(callback) {
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const prompts = (app.globalData.draftThemePrompts || []).length ? app.globalData.draftThemePrompts : readTreePrompts();
    const ownChoices = this.readOwnChoices();
    const creatorChoices = this.data.role === "creator"
      ? ownChoices
      : (challenge.creatorChoices || app.globalData.draftThemeChoices || {});
    const nextSlot = findNextEmptySlot(prompts, ownChoices);
    const activeSlotId = this.data.activeSlotId && !ownChoices[this.data.activeSlotId]
      ? this.data.activeSlotId
      : (nextSlot ? nextSlot.id : "");
    const filledCount = prompts.filter((prompt) => getSongName(ownChoices[prompt.id])).length;
    const isComplete = Boolean(prompts.length && filledCount === prompts.length);
    const revealMap = getRevealMap(this.data.rows);
    const started = this.data.started || filledCount > 0 || this.data.resultMode;
    const viewRole = this.data.resultMode ? "result" : this.data.role;
    const creatorProfile = decorateProfile(
      challenge.creatorProfile || app.globalData.creatorProfile || readCachedProfile(),
      "左边朋友"
    );
    const friendProfile = decorateProfile(app.globalData.friendProfile || {}, "右边朋友");
    this.setData({
      started,
      activeSlotId,
      filledCount,
      isComplete,
      creatorProfile,
      friendProfile,
      primaryLabel: this.data.resultMode
        ? "重播动画"
        : (isComplete ? (this.data.role === "friend" ? "完成并揭晓" : "邀请朋友填写右边") : "继续选择下一首"),
      rows: decorateRows(prompts, ownChoices, creatorChoices, activeSlotId, started, viewRole, this.data.viewerRole, revealMap)
    }, callback);
  },

  onTreeCreatorAvatarError() {
    this.setData({ "creatorProfile.avatarUrl": "" });
  },

  onTreeFriendAvatarError() {
    this.setData({ "friendProfile.avatarUrl": "" });
  },

  startFromTree() {
    if (this.data.resultMode || this.data.started) return;
    this.setData({ started: true }, () => {
      this.renderTree();
      this.chooseNextSlot();
    });
  },

  chooseRow(event) {
    if (this.data.resultMode) return;
    const slotId = event.currentTarget.dataset.id;
    const side = event.currentTarget.dataset.side;
    if (!this.data.started) {
      const isStartSide = (this.data.role === "creator" && side === "left")
        || (this.data.role === "friend" && side === "right");
      if (isStartSide) this.startFromTree();
      return;
    }
    if ((this.data.role === "creator" && side !== "left") || (this.data.role === "friend" && side !== "right")) return;
    if (slotId) this.openArtistPicker(slotId);
  },

  chooseNextSlot() {
    const app = getApp();
    const prompts = app.globalData.draftThemePrompts || [];
    const slot = findNextEmptySlot(prompts, this.readOwnChoices());
    if (!slot) {
      this.renderTree();
      return;
    }
    this.openArtistPicker(slot.id);
  },

  openArtistPicker(slotId) {
    const app = getApp();
    app.globalData.draftMode = "theme";
    app.globalData.draftThemeTemplate = "tree";
    app.globalData.currentThemeSlotId = slotId;
    app.globalData.currentThemeSlotArtist = (app.globalData.draftThemeArtists || {})[slotId] || null;
    this.setData({ activeSlotId: slotId });
    wx.navigateTo({
      url: `/pages/artists/artists?mode=theme&role=${this.data.role}&slotId=${encodeURIComponent(slotId)}&challengeId=${encodeURIComponent(this.data.challengeId || "")}`
    });
  },

  primaryAction() {
    if (this.data.resultMode) {
      this.playGrowthAnimation();
      return;
    }
    const app = getApp();
    const prompts = app.globalData.draftThemePrompts || [];
    const nextSlot = findNextEmptySlot(prompts, this.readOwnChoices());
    if (nextSlot) {
      this.openArtistPicker(nextSlot.id);
      return;
    }
    if (this.data.role === "friend") this.submitFriendTree();
    else this.createTreeChallenge();
  },

  createTreeChallenge() {
    if (this.data.creating || !this.ensureCreatorProfileForCreate("createTreeChallenge")) return;
    const app = getApp();
    const prompts = app.globalData.draftThemePrompts || [];
    const creatorChoices = app.globalData.draftThemeChoices || {};
    this.setData({ creating: true });
    wx.showLoading({ title: "创建中" });
    prepareCreatorProfileForCreate(this)
      .then((creatorProfile) => createChallenge({
        mode: "tree",
        targetCount: prompts.length,
        treePrompts: prompts,
        creatorChoices,
        creatorProfile
      }))
      .then((res) => {
        const challenge = {
          challengeId: res.challengeId,
          mode: "tree",
          targetCount: prompts.length,
          treePrompts: prompts,
          creatorChoices,
          creatorProfile: app.globalData.creatorProfile || readCachedProfile(),
          createdAt: Date.now()
        };
        app.globalData.challenge = challenge;
        saveCreatedChallenge(challenge);
        wx.navigateTo({ url: `/pages/share/share?challengeId=${encodeURIComponent(res.challengeId)}` });
      })
      .catch((error) => wx.showToast({ title: (error && error.message) || "创建失败", icon: "none" }))
      .finally(() => {
        wx.hideLoading();
        this.setData({ creating: false });
      });
  },

  submitFriendTree() {
    if (this.data.creating) return;
    const app = getApp();
    const challengeId = this.data.challengeId || (app.globalData.challenge || {}).challengeId || "";
    if (!challengeId) {
      wx.showToast({ title: "挑战信息丢失，请重新进入", icon: "none" });
      return;
    }
    const friendChoices = app.globalData.friendChoices || {};
    this.setData({ creating: true });
    wx.showLoading({ title: "生成中" });
    ensureStableAccountProfile(app.globalData.friendProfile || readCachedProfile())
      .then(({ profile }) => {
        app.globalData.friendProfile = profile;
        saveFriendDraft(challengeId, { friendChoices, friendProfile: profile });
        return submitAnswer({ challengeId, friendChoices, friendProfile: profile });
      })
      .then((res) => {
        const matched = Number(((res || {}).result || {}).matchCount || 0);
        const resultCopy = matched ? `你们撞中了 ${matched} 首歌` : "两颗歌单没有撞歌，但刚好拼成了同一棵树";
        const challenge = app.globalData.challenge || {};
        const snapshot = {
          challengeId,
          mode: "tree",
          resultId: res.resultId || "",
          shareToken: res.shareToken || "",
          result: res.result || {},
          resultCopy,
          viewerRole: "friend",
          challenge,
          friendChoices,
          friendProfile: app.globalData.friendProfile || {},
          creatorProfile: challenge.creatorProfile || {}
        };
        saveResultSnapshot(challengeId, snapshot);
        saveParticipatedResult({ ...snapshot, savedAt: Date.now() });
        this.setData({
          resultMode: true,
          resultId: res.resultId || "",
          shareToken: res.shareToken || "",
          resultCopy
        }, () => this.renderTree(() => {
          this.prepareResultSharing();
          this.playGrowthAnimation();
        }));
      })
      .catch((error) => wx.showToast({ title: (error && error.message) || "生成失败", icon: "none" }))
      .finally(() => {
        wx.hideLoading();
        this.setData({ creating: false });
      });
  },

  clearGrowthTimers() {
    (this.growthTimers || []).forEach((timer) => clearTimeout(timer));
    this.growthTimers = [];
  },

  playGrowthAnimation() {
    this.clearGrowthTimers();
    this.stopSnowEffect();
    this.setData({
      rows: this.data.rows.map((row) => ({ ...row, revealClass: "" })),
      starClass: "",
      peopleClass: ""
    }, () => {
      this.startSnowEffect();
    });
    let treeStartDelay = GROWTH_START_DELAY_MS;
    if (this.data.resultMode) {
      const peopleTimer = setTimeout(() => {
        this.setData({ peopleClass: "revealed" });
      }, GROWTH_START_DELAY_MS);
      this.growthTimers.push(peopleTimer);
      treeStartDelay += PEOPLE_REVEAL_DURATION_MS + TREE_START_AFTER_PEOPLE_MS;
    }
    const revealOrder = this.data.rows.slice().reverse().map((row) => row.id);
    revealOrder.forEach((id, index) => {
      const timer = setTimeout(() => {
        this.setData({
          rows: this.data.rows.map((row) => ({ ...row, revealClass: row.id === id ? "revealed" : row.revealClass }))
        });
      }, treeStartDelay + index * GROWTH_STEP_MS);
      this.growthTimers.push(timer);
    });
    const starTimer = setTimeout(
      () => this.setData({ starClass: "revealed" }),
      treeStartDelay + revealOrder.length * GROWTH_STEP_MS + 80
    );
    this.growthTimers.push(starTimer);
  },

  startSnowEffect() {
    this.setData({ snowClass: "active" });
  },

  stopSnowEffect(resetClass = true) {
    if (resetClass && this.data && this.data.snowClass) this.setData({ snowClass: "" });
  },

  replayGrowth() {
    this.playGrowthAnimation();
  },

  prepareResultSharing() {
    const resultId = this.data.resultId || "";
    const shareToken = this.data.shareToken || "";
    if (!resultId) return;
    this.setData({ shareReady: false, shareImageLoading: true });
    const tokenPromise = shareToken
      ? Promise.resolve(shareToken)
      : publishSharedResult({ resultId, channel: "prepare" })
          .then((res) => res.shareToken || "");
    if (shareToken) {
      publishSharedResult({ resultId, channel: "prepare" }).catch(() => {});
    }
    Promise.all([tokenPromise, this.prepareResultShareImage()])
      .then(([nextShareToken, shareImageUrl]) => {
        if (!nextShareToken || !shareImageUrl) return;
        this.setData({
          shareToken: nextShareToken,
          shareImageUrl,
          shareImageLoading: false,
          shareReady: true
        });
        if (wx.showShareMenu) wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
      })
      .catch(() => this.setData({ shareImageLoading: false }));
  },

  prepareResultShareImage() {
    if (this.resultShareImagePromise) return this.resultShareImagePromise;
    this.resultShareImagePromise = this.drawResultShareImage()
      .catch(() => this.drawResultImage());
    return this.resultShareImagePromise;
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

  drawResultShareImage() {
    const app = getApp();
    const challenge = app.globalData.challenge || {};
    const coverSources = pickRandomTreeCovers([
      challenge.creatorChoices || app.globalData.draftThemeChoices || {},
      app.globalData.friendChoices || {}
    ]);
    return Promise.all([
      readCanvasImage((this.data.creatorProfile || {}).avatarUrl),
      readCanvasImage((this.data.friendProfile || {}).avatarUrl),
      ...coverSources.map(readCanvasImage),
      this.getHomeQrCodeUrl().then(readCanvasImage)
    ]).then((images) => new Promise((resolve, reject) => {
      const creatorAvatar = images[0];
      const friendAvatar = images[1];
      const coverImages = images.slice(2, 2 + coverSources.length);
      const qrImage = images[images.length - 1];
      const ctx = wx.createCanvasContext("treeShareCanvas", this);
      const center = TREE_SHARE_WIDTH / 2;
      const gap = 16;
      const rowStartY = 132;
      const rowStep = 32;

      ctx.setFillStyle("#ededed");
      ctx.fillRect(0, 0, TREE_SHARE_WIDTH, TREE_SHARE_HEIGHT);
      ctx.setFillStyle("#262626");
      ctx.setTextAlign("center");
      ctx.setTextBaseline("middle");
      ctx.setFontSize(34);
      ctx.fillText("圣诞树推歌", center, 42);
      ctx.setFillStyle("#f4bf37");
      ctx.setFontSize(48);
      ctx.fillText("★", center, 88);

      this.data.rows.forEach((row, index) => {
        const bubbleWidth = row.part === "trunk"
          ? (row.count === 3 ? 100 : 82)
          : 34 + row.count * 16;
        const y = rowStartY + index * rowStep + (index >= 11 ? 10 : 0);
        const friendView = this.data.viewerRole === "friend";
        drawShareBubble(ctx, center - gap / 2 - bubbleWidth, y, bubbleWidth, row.leftText || "", "left", !friendView);
        drawShareBubble(ctx, center + gap / 2, y, bubbleWidth, row.rightText || "", "right", friendView);
      });

      coverImages.forEach((imagePath, index) => {
        drawShareCover(ctx, imagePath, 762 + index * 30, 150 + index * 78, 92);
      });

      const friendView = this.data.viewerRole === "friend";
      drawPosterProfile(ctx, this.data.creatorProfile || {}, creatorAvatar, center - 58, 666, friendView ? "#ffffff" : "#95ec69", "left");
      drawPosterProfile(ctx, this.data.friendProfile || {}, friendAvatar, center + 58, 666, friendView ? "#95ec69" : "#ffffff", "right");

      drawCenteredResultFooter(
        ctx,
        this.data.resultCopy || "两颗歌单没有撞歌，但刚好拼成了同一棵树",
        qrImage,
        center,
        748,
        { fontSize: 22, qrSize: 52, gap: 10 }
      );

      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "treeShareCanvas",
          width: TREE_SHARE_WIDTH,
          height: TREE_SHARE_HEIGHT,
          destWidth: TREE_SHARE_WIDTH,
          destHeight: TREE_SHARE_HEIGHT,
          fileType: "jpg",
          quality: 0.92,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this);
      });
    }));
  },

  drawResultImage(options = {}) {
    const videoMaster = options.videoMaster === true;
    return Promise.all([
      readCanvasImage((this.data.creatorProfile || {}).avatarUrl),
      readCanvasImage((this.data.friendProfile || {}).avatarUrl),
      this.getHomeQrCodeUrl().then(readCanvasImage)
    ]).then(([creatorAvatar, friendAvatar, qrImage]) => new Promise((resolve, reject) => {
      const ctx = wx.createCanvasContext("treeResultCanvas", this);
      const width = 1000;
      const height = 1920;
      const center = width / 2;
      const pageScale = width / 750;
      const gap = 22 * pageScale;
      const rowStartY = 164;
      const rowStep = 78 * pageScale;

      ctx.setFillStyle("#ededed");
      ctx.fillRect(0, 0, width, height);
      if (!videoMaster) {
        drawPosterSnow(ctx, width, height, 82);
        ctx.setFillStyle("#f4bf37");
        ctx.setTextAlign("center");
        ctx.setTextBaseline("middle");
        ctx.setFontSize(116);
        ctx.fillText("★", center, 74);
      }

      this.data.rows.forEach((row, index) => {
        const bubbleWidth = row.part === "trunk"
          ? (row.count === 3 ? 120 : 94) * pageScale
          : (42 + row.count * 26) * pageScale;
        const y = rowStartY + index * rowStep + (index >= 11 ? 24 * pageScale : 0);
        const friendView = this.data.viewerRole === "friend";
        drawPosterBubble(ctx, center - gap / 2 - bubbleWidth, y, bubbleWidth, row.leftText || "", "left", !friendView);
        drawPosterBubble(ctx, center + gap / 2, y, bubbleWidth, row.rightText || "", "right", friendView);
      });

      const friendView = this.data.viewerRole === "friend";
      const profileOptions = { radius: 50, fontSize: 29, strokeWidth: 5 };
      drawPosterProfile(ctx, this.data.creatorProfile || {}, creatorAvatar, center - 52, 1710, friendView ? "#ffffff" : "#95ec69", "left", profileOptions);
      drawPosterProfile(ctx, this.data.friendProfile || {}, friendAvatar, center + 52, 1710, friendView ? "#95ec69" : "#ffffff", "right", profileOptions);

      if (this.data.resultCopy) {
        drawCenteredResultFooter(
          ctx,
          this.data.resultCopy,
          qrImage,
          center,
          1840,
          { fontSize: 27, qrSize: 76, gap: 14 }
        );
      }
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "treeResultCanvas",
          width,
          height,
          destWidth: videoMaster ? TREE_VIDEO_WIDTH : 2000,
          destHeight: videoMaster ? TREE_VIDEO_HEIGHT : 3840,
          fileType: videoMaster ? "jpg" : "png",
          quality: videoMaster ? 0.9 : 1,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this);
      });
    }));
  },

  saveResultImage() {
    if (!this.data.resultMode || this.data.savingImage || this.data.savingVideo) return;
    this.setData({ savingImage: true });
    wx.showLoading({ title: "生成图片" });
    this.drawResultImage()
      .then((filePath) => this.shareOrSaveImage(filePath))
      .then(() => {
        if (!this.usedImageShareMenu) wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch(() => wx.showToast({ title: "保存失败，请允许访问相册", icon: "none" }))
      .finally(() => {
        wx.hideLoading();
        this.setData({ savingImage: false });
      });
  },

  getTreeVideoRegions() {
    const scale = TREE_VIDEO_WIDTH / 1000;
    const rowStartY = 164;
    const rowStep = 78 * (1000 / 750);
    const rows = this.data.rows.map((row, index) => {
      const y = rowStartY + index * rowStep + (index >= 11 ? 24 * (1000 / 750) : 0);
      return {
        x: 0,
        y: Math.max(0, Math.floor((y - 5) * scale)),
        width: TREE_VIDEO_WIDTH,
        height: Math.ceil(95 * scale)
      };
    }).reverse();
    return {
      people: {
        x: 0,
        y: Math.floor(1648 * scale),
        width: TREE_VIDEO_WIDTH,
        height: Math.ceil(124 * scale)
      },
      rows,
      footer: {
        x: 0,
        y: Math.floor(1794 * scale),
        width: TREE_VIDEO_WIDTH,
        height: TREE_VIDEO_HEIGHT - Math.floor(1794 * scale)
      },
      star: {
        centerX: TREE_VIDEO_WIDTH / 2,
        centerY: 74 * scale,
        outerRadius: 52 * scale,
        innerRadius: 23 * scale
      }
    };
  },

  uploadTreeVideoMaster(filePath) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return wx.cloud.uploadFile({
      cloudPath: `tree-video-sources/${suffix}.jpg`,
      filePath
    }).then((res) => res.fileID || "");
  },

  saveVideoFile(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveVideoToPhotosAlbum({
        filePath,
        success: resolve,
        fail: reject
      });
    });
  },

  cleanupTreeVideo(fileID) {
    if (!fileID) return Promise.resolve();
    return renderTreeVideo({ action: "cleanup", fileID }).catch(() => {});
  },

  cleanupTreeVideoSource(fileID) {
    if (!fileID || !wx.cloud || !wx.cloud.deleteFile) return Promise.resolve();
    return wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
  },

  saveResultVideo() {
    if (!this.data.resultMode || this.data.savingVideo || this.data.savingImage) return;
    if (!wx.cloud || !wx.saveVideoToPhotosAlbum) {
      wx.showToast({ title: "当前微信版本暂不支持保存视频", icon: "none" });
      return;
    }
    let sourceFileID = "";
    let videoFileID = "";
    this.setData({ savingVideo: true });
    wx.showLoading({ title: "生成动态视频" });
    this.drawResultImage({ videoMaster: true })
      .then((masterPath) => this.uploadTreeVideoMaster(masterPath))
      .then((fileID) => {
        if (!fileID) throw new Error("动画母版上传失败");
        sourceFileID = fileID;
        return renderTreeVideo({
          sourceFileID,
          regions: this.getTreeVideoRegions(),
          frameRate: 12
        });
      })
      .then((res) => {
        videoFileID = res.fileID || "";
        if (!videoFileID) throw new Error("视频生成失败");
        return wx.cloud.downloadFile({ fileID: videoFileID });
      })
      .then((res) => this.saveVideoFile(res.tempFilePath))
      .then(() => wx.showToast({ title: "视频已保存", icon: "success" }))
      .catch((error) => {
        const message = String((error && (error.message || error.errMsg)) || "");
        wx.showToast({
          title: message.includes("cancel") ? "已取消保存" : (message || "视频生成失败，请稍后重试"),
          icon: "none"
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ savingVideo: false });
        if (sourceFileID) this.cleanupTreeVideoSource(sourceFileID);
        if (videoFileID) this.cleanupTreeVideo(videoFileID);
      });
  },

  onShareAppMessage() {
    if (!this.data.resultMode || !this.data.resultId || !this.data.shareToken) {
      return { title: "来一起完成一棵圣诞歌名树", path: "/pages/theme/theme" };
    }
    publishSharedResult({ resultId: this.data.resultId, channel: "chat" }).catch(() => {});
    return {
      title: this.data.resultCopy || "我们完成了一棵圣诞歌名树",
      path: `/pages/theme-tree/theme-tree?sharedResultId=${encodeURIComponent(this.data.resultId)}&shareToken=${encodeURIComponent(this.data.shareToken)}`,
      imageUrl: this.data.shareImageUrl || ""
    };
  },

  onShareTimeline() {
    if (!this.data.resultMode || !this.data.resultId || !this.data.shareToken) {
      return { title: "来一起完成一棵圣诞歌名树", query: "" };
    }
    publishSharedResult({ resultId: this.data.resultId, channel: "timeline" }).catch(() => {});
    return {
      title: this.data.resultCopy || "我们完成了一棵圣诞歌名树",
      query: `sharedResultId=${encodeURIComponent(this.data.resultId)}&shareToken=${encodeURIComponent(this.data.shareToken)}`,
      imageUrl: this.data.shareImageUrl || ""
    };
  }
});
