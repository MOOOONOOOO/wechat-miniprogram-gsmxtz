const {
  cacheAccountProfile,
  getAccountProfile,
  isCompleteProfile,
  readCachedProfile,
  saveAccountProfile
} = require("../../utils/profile");
const { syncCreatorInbox } = require("../../utils/historySync");

function showPageShareMenu() {
  if (!wx.showShareMenu) return;
  wx.showShareMenu({
    menus: ["shareAppMessage", "shareTimeline"]
  });
}

const HOME_SHARE_TITLE = "来测测你和朋友的音乐默契";
const POPUP_SEEN_PREFIX = "announcementPopupSeen:";

function callNoticeHub(data) {
  if (!wx.cloud) return Promise.resolve({});
  return wx.cloud.callFunction({
    name: "noticeHub",
    data
  }).then((res) => res.result || {}).catch(() => ({}));
}

function splitContentLines(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .split("\n");
}

function hashText(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function popupSeenKey(popup) {
  const safePopup = popup || {};
  const version = [
    safePopup.title || "",
    safePopup.content || "",
    safePopup.version || "",
    safePopup.buttonText || ""
  ].join("\n");
  return `${POPUP_SEEN_PREFIX}${safePopup.id}:${hashText(version)}`;
}

function normalizePopup(popup) {
  if (!popup || (!popup.title && !popup.content)) return null;
  const id = String(popup.popupId || popup.id || "").trim();
  if (!id) return null;
  return {
    ...popup,
    id,
    seenKey: popupSeenKey({
      ...popup,
      id,
      buttonText: popup.buttonText || "知道了"
    }),
    title: popup.title || "更新公告",
    buttonText: popup.buttonText || "知道了",
    contentLines: splitContentLines(popup.content)
  };
}

Page({
  data: {
    profile: {
      nickName: "",
      avatarUrl: ""
    },
    showProfileModal: false,
    showAnnouncementPopup: false,
    announcementPopup: null
  },

  onLoad() {
    showPageShareMenu();
    const profile = readCachedProfile();
    getApp().globalData.creatorProfile = profile;
    this.setData({
      profile,
      showProfileModal: false
    });
    getAccountProfile().then((accountProfile) => {
      this.setData({
        profile: accountProfile,
        showProfileModal: !isCompleteProfile(accountProfile)
      }, () => {
        if (isCompleteProfile(accountProfile)) this.tryShowAnnouncementPopup();
      });
    });
    this.loadAnnouncementPopup();
  },

  onShow() {
    syncCreatorInbox({ minInterval: 60 * 1000 }).catch(() => {});
  },

  onChooseAvatar(event) {
    const profile = {
      ...this.data.profile,
      avatarUrl: event.detail.avatarUrl
    };
    this.setData({ profile }, () => this.saveProfile());
  },

  onNicknameInput(event) {
    this.setData({
      profile: {
        ...this.data.profile,
        nickName: event.detail.value
      }
    });
  },

  saveProfile() {
    const profile = this.data.profile || {};
    const savedProfile = cacheAccountProfile(profile);
    this.setData({ profile: savedProfile });
  },

  ensureProfile() {
    const profile = this.data.profile || {};
    if (isCompleteProfile(profile)) return true;
    this.setData({ showProfileModal: true });
    wx.showToast({
      title: profile.avatarUrl ? "请先填写昵称" : "请先选择头像",
      icon: "none"
    });
    return false;
  },

  confirmProfileModal() {
    if (!this.ensureProfile()) return;
    wx.showLoading({ title: "保存中" });
    this.persistProfile()
      .then(() => {
        this.setData({ showProfileModal: false }, () => this.tryShowAnnouncementPopup());
      })
      .finally(() => wx.hideLoading());
  },

  start(event) {
    if (!this.ensureProfile()) return;
    wx.showLoading({ title: "准备中" });
    this.persistProfile()
      .then(() => {
        const mode = (event && event.currentTarget.dataset.mode) || "artist";
        const app = getApp();
        app.globalData.draftMode = mode;
        app.globalData.draftArtists = [];
        app.globalData.draftAlbums = [];
        app.globalData.draftColors = [];
        app.globalData.draftColorArtists = {};
        app.globalData.draftThemeTemplate = "";
        app.globalData.draftThemePrompts = [];
        app.globalData.draftThemeChoices = {};
        app.globalData.draftThemeArtists = {};
        app.globalData.draftQaPrompts = [];
        app.globalData.draftQaArtists = {};
        app.globalData.currentThemeSlotId = "";
        app.globalData.currentThemeSlotArtist = null;
        app.globalData.currentQaSlotId = "";
        app.globalData.currentQaSlotArtist = null;
        app.globalData.currentColorId = "";
        app.globalData.currentColorArtist = null;
        app.globalData.draftTopArtist = null;
        app.globalData.creatorChoices = {};
        app.globalData.friendChoices = {};
        app.globalData.creatorTopSongs = [];
        app.globalData.friendTopSongs = [];
        if (mode === "color") {
          wx.navigateTo({ url: "/pages/colors/colors?role=creator" });
          return;
        }
        wx.navigateTo({ url: `/pages/artists/artists?mode=${mode}` });
      })
      .finally(() => wx.hideLoading());
  },

  startTheme() {
    if (!this.ensureProfile()) return;
    wx.showLoading({ title: "准备中" });
    this.persistProfile()
      .then(() => {
        const app = getApp();
        app.globalData.draftMode = "theme";
        app.globalData.draftThemeTemplate = "";
        app.globalData.draftThemePrompts = [];
        app.globalData.draftThemeChoices = {};
        app.globalData.draftThemeArtists = {};
        app.globalData.draftQaPrompts = [];
        app.globalData.draftQaArtists = {};
        app.globalData.currentThemeSlotId = "";
        app.globalData.currentThemeSlotArtist = null;
        app.globalData.currentQaSlotId = "";
        app.globalData.currentQaSlotArtist = null;
        wx.navigateTo({ url: "/pages/theme/theme" });
      })
      .finally(() => wx.hideLoading());
  },

  persistProfile() {
    const profile = this.data.profile || {};
    return saveAccountProfile(profile)
      .then((savedProfile) => {
        this.setData({ profile: savedProfile });
        return savedProfile;
      });
  },

  loadAnnouncementPopup() {
    callNoticeHub({ action: "getPopupAnnouncement" })
      .then((res) => {
        const popup = normalizePopup(res.popup);
        this.pendingAnnouncementPopup = popup;
        this.tryShowAnnouncementPopup();
      });
  },

  tryShowAnnouncementPopup() {
    const popup = this.pendingAnnouncementPopup;
    if (!popup || this.data.showProfileModal || this.data.showAnnouncementPopup) return;
    if (!isCompleteProfile(this.data.profile)) return;
    if (wx.getStorageSync(popup.seenKey)) return;
    this.setData({
      announcementPopup: popup,
      showAnnouncementPopup: true
    });
  },

  closeAnnouncementPopup() {
    const popup = this.data.announcementPopup || {};
    if (popup.seenKey) wx.setStorageSync(popup.seenKey, true);
    this.setData({
      showAnnouncementPopup: false
    });
  },

  comingSoon() {
    wx.navigateTo({ url: "/pages/history/history" });
  },

  openNotice() {
    wx.navigateTo({ url: "/pages/notice/notice" });
  },

  onShareAppMessage() {
    return {
      title: HOME_SHARE_TITLE,
      path: "/pages/home/home"
    };
  },

  onShareTimeline() {
    return {
      title: HOME_SHARE_TITLE,
      query: ""
    };
  }
});
