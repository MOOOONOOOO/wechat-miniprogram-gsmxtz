const { getChallenge, getRecentSubmission } = require("../../utils/api");
const { hydrateChallenge } = require("../../utils/challengeState");
const { resetFriendDraft } = require("../../utils/friendDraft");
const {
  cacheAccountProfile,
  emptyProfile,
  ensureStableAccountProfile,
  getAccountProfile,
  isCloudFileUrl,
  isCompleteProfile,
  readCachedProfile,
  resolveCloudFileUrl
} = require("../../utils/profile");
const { getResultSnapshot } = require("../../utils/resultSnapshot");

function friendProfileKey(challengeId) {
  return challengeId ? `friendProfile:${challengeId}` : "friendProfile";
}

function pickInitialProfile(accountProfile, challengeProfile) {
  if (isCompleteProfile(accountProfile)) return accountProfile;
  if (isCompleteProfile(challengeProfile)) return challengeProfile;
  return (accountProfile.avatarUrl || accountProfile.nickName) ? accountProfile : challengeProfile;
}

Page({
  data: {
    challengeId: "",
    mode: "artist",
    inviteTitle: "好友邀请你完成同一组歌手选择。",
    inviteCopy: "每位歌手选 1 首最喜欢的歌。提交后会看到你们两个人的音乐品味契合度。",
    loading: true,
    creatorAvatar: "",
    creatorName: "",
    friendAvatar: "",
    friendProfile: emptyProfile(),
    showProfileModal: false,
    hasSavedResult: false
  },

  onLoad(options) {
    const app = getApp();
    const challengeId = options.challengeId || (options.scene ? decodeURIComponent(options.scene) : "");
    const friendProfile = pickInitialProfile(readCachedProfile(), wx.getStorageSync(friendProfileKey(challengeId)) || emptyProfile());
    app.globalData.friendProfile = friendProfile;
    this.setData({
      challengeId,
      friendProfile,
      friendAvatar: friendProfile.avatarUrl || "",
      showProfileModal: false
    }, () => this.resolveFriendAvatar(friendProfile.avatarUrl || ""));
    getAccountProfile().then((accountProfile) => {
      const nextProfile = isCompleteProfile(accountProfile) ? accountProfile : friendProfile;
      app.globalData.friendProfile = nextProfile;
      this.setData({
        friendProfile: nextProfile,
        friendAvatar: nextProfile.avatarUrl || "",
        showProfileModal: !isCompleteProfile(nextProfile)
      }, () => this.resolveFriendAvatar(nextProfile.avatarUrl || ""));
    });
    this.loadChallenge(challengeId);
  },

  loadChallenge(challengeId) {
    getChallenge(challengeId)
      .then((res) => {
        hydrateChallenge(res.challenge, { resetFriendAnswers: true });
        const creatorProfile = res.challenge.creatorProfile || {};
        const creatorAvatar = creatorProfile.avatarUrl || "";
        this.setData({
          mode: res.challenge.mode || "artist",
          inviteTitle: (res.challenge.mode || "artist") === "album" ? "好友邀请你完成同一组专辑选择。" : ((res.challenge.mode || "artist") === "top9" ? "好友邀请你完成同担 Top9 挑战。" : ((res.challenge.mode || "artist") === "color" ? "好友邀请你完成颜色推歌挑战。" : ((res.challenge.mode || "artist") === "qa" ? "好友邀请你填写一张歌单问答。" : "好友邀请你完成同一组歌手选择。"))),
          inviteCopy: (res.challenge.mode || "artist") === "album" ? "每张专辑选 1 首最喜欢的歌。提交后会看到你们两个人的音乐品味契合度。" : ((res.challenge.mode || "artist") === "top9" ? "选出这位歌手你最爱的 9 首歌，拖动排出你的 Top9。" : ((res.challenge.mode || "artist") === "color" ? "按 9 个颜色各推荐 1 首歌，提交后看看你们的封面颜色默契。" : ((res.challenge.mode || "artist") === "qa" ? "回答同一组 9 个音乐问题，只看彼此的答案，不算默契分。" : "每位歌手选 1 首最喜欢的歌。提交后会看到你们两个人的音乐品味契合度。"))),
          creatorAvatar,
          creatorName: creatorProfile.nickName || ""
        }, () => {
          this.resolveCreatorAvatar(creatorAvatar);
          this.detectSavedResult(challengeId);
        });
      })
      .catch(() => {
        wx.showToast({ title: "挑战不存在", icon: "none" });
      })
      .finally(() => this.setData({ loading: false }));
  },

  detectSavedResult(challengeId) {
    if (!challengeId) return;
    if (getResultSnapshot(challengeId)) {
      this.setData({ hasSavedResult: true });
      return;
    }

    getRecentSubmission(challengeId)
      .then((res) => {
        this.setData({ hasSavedResult: Boolean(res.submission && res.result) });
      })
      .catch(() => {});
  },

  resolveCreatorAvatar(avatarUrl) {
    if (!isCloudFileUrl(avatarUrl)) return;

    resolveCloudFileUrl(avatarUrl).then((tempUrl) => {
      if (tempUrl && this.data.creatorAvatar === avatarUrl) {
        this.setData({ creatorAvatar: tempUrl });
      }
    });
  },

  resolveFriendAvatar(avatarUrl) {
    if (!isCloudFileUrl(avatarUrl)) return;

    resolveCloudFileUrl(avatarUrl).then((tempUrl) => {
      const friendProfile = this.data.friendProfile || {};
      if (tempUrl && friendProfile.avatarUrl === avatarUrl) {
        this.setData({ friendAvatar: tempUrl });
      }
    });
  },

  start() {
    if (!this.ensureProfile()) return;
    wx.showLoading({ title: "准备中" });
    this.persistFriendProfile()
      .then((savedProfile) => {
        const mode = (getApp().globalData.challenge || {}).mode || "artist";
        const challengeId = this.data.challengeId || (getApp().globalData.challenge || {}).challengeId || "";
        if (!challengeId) {
          wx.showToast({ title: "挑战信息丢失，请重新进入", icon: "none" });
          return;
        }
        resetFriendDraft(challengeId, savedProfile);
        if (mode === "color") {
          wx.navigateTo({ url: `/pages/colors/colors?role=friend&challengeId=${encodeURIComponent(challengeId)}` });
          return;
        }
        if (mode === "qa") {
          wx.navigateTo({ url: `/pages/theme-qa-board/theme-qa-board?role=friend&challengeId=${encodeURIComponent(challengeId)}` });
          return;
        }
        wx.navigateTo({ url: `/pages/songs/songs?role=friend&mode=${mode}&challengeId=${encodeURIComponent(challengeId)}` });
      })
      .finally(() => wx.hideLoading());
  },

  viewSavedResult() {
    if (!this.data.challengeId) return;
    const challenge = getApp().globalData.challenge || {};
    const creatorChoices = challenge.creatorChoices || {};
    if ((challenge.mode || "") === "qa" && (challenge.qaSolo === true || !Object.keys(creatorChoices).length)) {
      wx.navigateTo({ url: `/pages/theme-qa-board/theme-qa-board?history=participated&challengeId=${this.data.challengeId}` });
      return;
    }
    wx.navigateTo({ url: `/pages/result/result?restore=1&challengeId=${this.data.challengeId}` });
  },

  ensureProfile() {
    const friendProfile = this.data.friendProfile || {};
    if (isCompleteProfile(friendProfile)) return true;
    this.setData({ showProfileModal: true });
    wx.showToast({
      title: friendProfile.avatarUrl ? "请先填写昵称" : "请先选择头像",
      icon: "none"
    });
    return false;
  },

  confirmProfileModal() {
    if (!this.ensureProfile()) return;
    wx.showLoading({ title: "保存中" });
    this.persistFriendProfile()
      .then(() => {
        this.setData({ showProfileModal: false });
      })
      .finally(() => wx.hideLoading());
  },

  onChooseAvatar(event) {
    const friendProfile = {
      ...this.data.friendProfile,
      avatarUrl: event.detail.avatarUrl
    };
    this.setData({
      friendProfile,
      friendAvatar: event.detail.avatarUrl
    }, () => this.saveFriendProfile());
  },

  onNicknameInput(event) {
    this.setData({
      friendProfile: {
        ...this.data.friendProfile,
        nickName: event.detail.value
      }
    });
  },

  saveFriendProfile() {
    const friendProfile = this.data.friendProfile || {};
    const savedProfile = cacheAccountProfile(friendProfile);
    getApp().globalData.friendProfile = savedProfile;
    wx.setStorageSync(friendProfileKey(this.data.challengeId), savedProfile);
  },

  persistFriendProfile() {
    const friendProfile = this.data.friendProfile || emptyProfile();
    return ensureStableAccountProfile(friendProfile)
      .then(({ profile: savedProfile, avatarStatus }) => {
        if (avatarStatus && !avatarStatus.stable && avatarStatus.hadInputAvatar) {
          console.warn("friend entry avatar was not saved as a stable URL", avatarStatus);
        }
        getApp().globalData.friendProfile = savedProfile;
        wx.setStorageSync(friendProfileKey(this.data.challengeId), savedProfile);
        this.setData({
          friendProfile: savedProfile,
          friendAvatar: savedProfile.avatarUrl || ""
        }, () => this.resolveFriendAvatar(savedProfile.avatarUrl || ""));
        return savedProfile;
      });
  }
});
