const { createChallenge, getChallenge } = require("../../utils/api");
const { saveCreatedChallenge } = require("../../utils/history");
const { readCachedProfile, saveAccountProfile } = require("../../utils/profile");

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

function hydrateQaChallenge(challenge) {
  if (!challenge || !challenge.challengeId) return;
  const app = getApp();
  app.globalData.challenge = challenge;
  app.globalData.draftMode = challenge.mode || "qa";
  app.globalData.draftThemeTemplate = "qa";
  app.globalData.draftQaPrompts = challenge.qaPrompts || [];
  app.globalData.creatorProfile = challenge.creatorProfile || {};
}

function prepareCreatorProfile() {
  const app = getApp();
  const profile = app.globalData.creatorProfile || readCachedProfile();
  return saveAccountProfile(profile);
}

function normalizePrompt(prompt = {}, index = 0) {
  const promptText = String(prompt.prompt || prompt.title || "").trim();
  const title = String(prompt.title || promptText || `题目 ${index + 1}`).trim();
  return {
    id: String(prompt.id || `qa-${index + 1}`).trim(),
    title,
    prompt: promptText || title
  };
}

Page({
  data: {
    prompts: [],
    creating: false,
    shareChallengeId: "",
    shareReady: false,
    isInviteLanding: false,
    creatorProfile: {},
    creatorInitial: "音",
    creatorAvatarUrl: ""
  },

  onLoad(options = {}) {
    const challengeId = options.challengeId ? decodeURIComponent(options.challengeId) : "";
    if (options.timelineInvite && challengeId) {
      this.loadTimelineInvite(challengeId);
      return;
    }
    hidePageShareMenu();
    this.renderPrompts();
  },

  onShow() {
    if (this.data.isInviteLanding) return;
    this.renderPrompts();
  },

  loadTimelineInvite(challengeId) {
    showPageShareMenu();
    this.setData({
      isInviteLanding: true,
      shareChallengeId: challengeId,
      shareReady: true,
      creating: false
    });
    wx.showLoading({ title: "读取题目" });
    getChallenge(challengeId)
      .then((res) => {
        const challenge = res.challenge || {};
        const prompts = (challenge.qaPrompts || []).slice(0, 9).map(normalizePrompt);
        const creatorProfile = challenge.creatorProfile || {};
        hydrateQaChallenge(challenge);
        this.setData({
          prompts,
          creatorProfile,
          creatorInitial: getProfileInitial(creatorProfile),
          creatorAvatarUrl: ""
        }, () => this.resolveCreatorAvatar());
      })
      .catch(() => {
        wx.showToast({ title: "题目不存在", icon: "none" });
      })
      .finally(() => wx.hideLoading());
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

  renderPrompts() {
    const prompts = (getApp().globalData.draftQaPrompts || [])
      .slice(0, 9)
      .map(normalizePrompt);
    const promptsKey = this.getPromptsKey(prompts);
    if (this.promptsKey !== promptsKey) {
      this.promptsKey = promptsKey;
      this.qaSharePromise = null;
      this.setData({ shareChallengeId: "", shareReady: false });
      hidePageShareMenu();
    }
    this.setData({ prompts });
    if (prompts.length !== 9) {
      wx.showToast({ title: "先选择 9 个问题", icon: "none" });
      hidePageShareMenu();
      return;
    }
    this.ensureQaShareChallenge().catch(() => {});
  },

  selfFill() {
    if (this.data.prompts.length !== 9) return;
    wx.navigateTo({ url: "/pages/theme-qa-board/theme-qa-board?role=creator" });
  },

  inviteFill() {
    if (this.data.prompts.length !== 9 || this.data.creating) return;
    this.setData({ creating: true });
    wx.showLoading({ title: "创建中" });
    this.ensureQaShareChallenge()
      .then((challenge) => {
        wx.navigateTo({ url: `/pages/share/share?challengeId=${challenge.challengeId}` });
      })
      .catch((error) => {
        wx.showToast({ title: (error && error.message) || "创建失败", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ creating: false });
      });
  },

  startAnswer() {
    if (!this.data.shareChallengeId) {
      wx.showToast({ title: "题目不存在", icon: "none" });
      return;
    }
    wx.navigateTo({
      url: `/pages/friend/friend?challengeId=${encodeURIComponent(this.data.shareChallengeId)}`
    });
  },

  getPromptsKey(prompts = this.data.prompts) {
    return (prompts || []).map((prompt) => `${prompt.id}:${prompt.prompt}`).join("|");
  },

  ensureQaShareChallenge() {
    const prompts = this.data.prompts;
    if (prompts.length !== 9) return Promise.reject(new Error("先选择 9 个问题"));
    const promptsKey = this.getPromptsKey(prompts);
    if (this.data.shareChallengeId && this.createdSharePromptsKey === promptsKey) {
      return Promise.resolve(getApp().globalData.challenge || { challengeId: this.data.shareChallengeId });
    }
    if (this.qaSharePromise && this.creatingSharePromptsKey === promptsKey) return this.qaSharePromise;

    const app = getApp();
    app.globalData.draftMode = "qa";
    app.globalData.draftThemeTemplate = "qa";
    app.globalData.draftQaPrompts = prompts;
    app.globalData.draftArtists = [];
    app.globalData.draftAlbums = [];
    this.creatingSharePromptsKey = promptsKey;
    this.qaSharePromise = prepareCreatorProfile()
      .then((creatorProfile) => createChallenge({
        mode: "qa",
        qaOnly: true,
        qaSolo: true,
        qaPrompts: prompts,
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
          qaPrompts: prompts,
          creatorChoices: {},
          creatorProfile: app.globalData.creatorProfile || wx.getStorageSync("creatorProfile") || {},
          createdAt: Date.now()
        };
        app.globalData.challenge = challenge;
        this.createdSharePromptsKey = promptsKey;
        this.setData({
          shareChallengeId: res.challengeId,
          shareReady: true
        });
        saveCreatedChallenge(challenge);
        showPageShareMenu();
        return challenge;
      })
      .finally(() => {
        this.qaSharePromise = null;
      });
    return this.qaSharePromise;
  },

  onShareAppMessage() {
    const challengeId = this.data.shareChallengeId;
    const title = getQaInviteShareTitle(getApp().globalData.creatorProfile || readCachedProfile());
    if (!challengeId) {
      wx.showToast({ title: "分享还在准备中", icon: "none" });
      return {
        title,
        path: "/pages/home/home"
      };
    }
    return {
      title,
      path: `/pages/friend/friend?challengeId=${challengeId}`
    };
  },

  onShareTimeline() {
    const challengeId = this.data.shareChallengeId;
    const title = getQaInviteShareTitle(getApp().globalData.creatorProfile || readCachedProfile());
    if (!challengeId) {
      wx.showToast({ title: "分享还在准备中", icon: "none" });
      return {
        title,
        query: ""
      };
    }
    return {
      title,
      query: `timelineInvite=1&challengeId=${encodeURIComponent(challengeId)}`
    };
  }
});
