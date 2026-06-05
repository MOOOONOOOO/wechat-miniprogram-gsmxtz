const {
  cacheAccountProfile,
  emptyProfile,
  getAccountProfile,
  isCompleteProfile,
  normalizeProfile,
  readCachedProfile,
  saveAccountProfile
} = require("./profile");

const creatorProfileGateData = {
  creatorProfileDraft: emptyProfile(),
  showCreatorProfileModal: false,
  creatorProfileModalCopy: "创建挑战前需要头像昵称，朋友会在邀请卡和结果页里看到。",
  creatorProfileModalConfirmText: "保存并创建"
};

function modalTextForAction(actionName) {
  if (actionName === "saveImage") {
    return {
      copy: "生成图片前需要头像昵称，会展示在保存图片里。",
      confirmText: "保存并生成"
    };
  }
  return {
    copy: "创建挑战前需要头像昵称，朋友会在邀请卡和结果页里看到。",
    confirmText: "保存并创建"
  };
}

function readCreatorProfile(page) {
  const draft = normalizeProfile((page.data || {}).creatorProfileDraft || {});
  if (draft.avatarUrl || draft.nickName) return draft;
  const app = getApp();
  return normalizeProfile((app.globalData || {}).creatorProfile || readCachedProfile());
}

function toastProfileMissing(profile) {
  wx.showToast({
    title: profile.avatarUrl ? "请先填写昵称" : "请先选择头像",
    icon: "none"
  });
}

const creatorProfileGateMethods = {
  initCreatorProfileGate() {
    const profile = readCreatorProfile(this);
    this.setData({
      creatorProfileDraft: profile,
      showCreatorProfileModal: false
    });
    getAccountProfile()
      .then((accountProfile) => {
        const currentProfile = readCreatorProfile(this);
        this.setData({
          creatorProfileDraft: isCompleteProfile(accountProfile) ? accountProfile : currentProfile
        });
      })
      .catch(() => {});
  },

  onChooseCreatorAvatar(event) {
    const profile = {
      ...readCreatorProfile(this),
      avatarUrl: (event.detail || {}).avatarUrl || ""
    };
    this.setData({ creatorProfileDraft: profile });
    cacheAccountProfile(profile);
  },

  onCreatorNicknameInput(event) {
    this.setData({
      creatorProfileDraft: {
        ...readCreatorProfile(this),
        nickName: (event.detail || {}).value || ""
      }
    });
  },

  ensureCreatorProfileForCreate(actionName) {
    const profile = readCreatorProfile(this);
    if (isCompleteProfile(profile)) {
      this.setData({ creatorProfileDraft: profile });
      return true;
    }
    const modalText = modalTextForAction(actionName);
    this.creatorProfileGateAction = actionName || "";
    this.setData({
      creatorProfileDraft: profile,
      showCreatorProfileModal: true,
      creatorProfileModalCopy: modalText.copy,
      creatorProfileModalConfirmText: modalText.confirmText
    });
    toastProfileMissing(profile);
    return false;
  },

  confirmCreatorProfileModal() {
    const profile = readCreatorProfile(this);
    if (!isCompleteProfile(profile)) {
      toastProfileMissing(profile);
      return;
    }
    let nextActionName = "";
    wx.showLoading({ title: "保存中" });
    saveAccountProfile(profile)
      .then((savedProfile) => {
        this.setData({
          creatorProfileDraft: savedProfile,
          showCreatorProfileModal: false
        });
        nextActionName = this.creatorProfileGateAction || "";
        this.creatorProfileGateAction = "";
      })
      .catch((error) => {
        wx.showToast({ title: (error && error.message) || "保存失败", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        if (nextActionName && typeof this[nextActionName] === "function") {
          setTimeout(() => this[nextActionName](), 0);
        }
      });
  }
};

function prepareCreatorProfileForCreate(page) {
  const profile = readCreatorProfile(page);
  if (!isCompleteProfile(profile)) {
    return Promise.reject(new Error("请先设置头像昵称"));
  }
  return saveAccountProfile(profile)
    .then((savedProfile) => {
      if (!isCompleteProfile(savedProfile)) {
        return Promise.reject(new Error("请先设置头像昵称"));
      }
      if (page && page.setData) {
        page.setData({ creatorProfileDraft: savedProfile });
      }
      return savedProfile;
    });
}

module.exports = {
  creatorProfileGateData,
  creatorProfileGateMethods,
  prepareCreatorProfileForCreate
};
