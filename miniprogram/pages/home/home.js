const {
  cacheAccountProfile,
  getAccountProfile,
  isCompleteProfile,
  readCachedProfile,
  saveAccountProfile
} = require("../../utils/profile");
const { syncCreatorInbox } = require("../../utils/historySync");
const { clearActiveTournament, getActiveTournament } = require("../../utils/songTournament");
const { getThemeTemplate } = require("../../data/themeTemplates");
const { buildModeCatalog } = require("../../config/modeCatalog");

function showPageShareMenu() {
  if (!wx.showShareMenu) return;
  wx.showShareMenu({
    menus: ["shareAppMessage", "shareTimeline"]
  });
}

const HOME_SHARE_TITLE = "来测测你和朋友的音乐默契";
const POPUP_SEEN_PREFIX = "announcementPopupSeen:";
const HOME_INBOX_SYNC_AT_KEY = "homeInboxSyncAt:v1";
const HOME_INBOX_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const MODE_CONTENT_CACHE_KEY = "modeContentCache:v1";
const MODE_CONTENT_REFRESH_INTERVAL_MS = 60 * 1000;

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
    announcementPopup: null,
    homeModes: buildModeCatalog()
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
        showProfileModal: false
      }, () => this.tryShowAnnouncementPopup());
    });
    this.loadAnnouncementPopup();
    this.loadModeContent();
  },

  onShow() {
    this.syncInboxOccasionally();
    this.loadModeContent();
  },

  readCachedModeContent() {
    try {
      const cache = wx.getStorageSync(MODE_CONTENT_CACHE_KEY);
      return cache && Array.isArray(cache.modes) ? cache : null;
    } catch (error) {
      return null;
    }
  },

  loadModeContent() {
    const cached = this.readCachedModeContent();
    if (cached && cached.modes) {
      this.setData({ homeModes: buildModeCatalog(cached.modes) });
    }

    const now = Date.now();
    if (
      this.modeContentRequest
      || (
        this.modeContentFetchedAt
        && now - this.modeContentFetchedAt < MODE_CONTENT_REFRESH_INTERVAL_MS
      )
    ) {
      return this.modeContentRequest || Promise.resolve();
    }
    if (!wx.cloud) return Promise.resolve();

    this.modeContentFetchedAt = now;
    this.modeContentRequest = wx.cloud.callFunction({
      name: "modeCatalog",
      data: {}
    }).then((res) => {
      const result = (res && res.result) || {};
      const modes = Array.isArray(result.modes) ? result.modes : [];
      if (!modes.length) return;
      this.setData({ homeModes: buildModeCatalog(modes) });
      try {
        wx.setStorageSync(MODE_CONTENT_CACHE_KEY, {
          modes,
          updatedAt: Date.now()
        });
      } catch (error) {}
    }).catch((error) => {
      console.warn("load mode content failed", error);
    }).finally(() => {
      this.modeContentRequest = null;
    });
    return this.modeContentRequest;
  },

  openMode(event) {
    const modeKey = String(
      (event && event.currentTarget && event.currentTarget.dataset.modeKey) || ""
    );
    if (modeKey === "artist" || modeKey === "album" || modeKey === "top9") {
      this.start({
        currentTarget: {
          dataset: { mode: modeKey }
        }
      });
      return;
    }
    if (modeKey === "songTournament") {
      this.startTournament();
      return;
    }
    if (modeKey === "introQuiz") {
      this.startIntroQuiz();
      return;
    }
    if (modeKey === "tree") {
      this.startTree();
      return;
    }
    if (modeKey === "theme") {
      this.startTheme();
      return;
    }
    if (modeKey === "rainBox") {
      this.startRainBox();
      return;
    }
    if (modeKey === "lyrics") {
      this.startLyricsShare();
    }
  },

  syncInboxOccasionally() {
    const now = Date.now();
    try {
      const lastSyncAt = Number(wx.getStorageSync(HOME_INBOX_SYNC_AT_KEY) || 0);
      if (lastSyncAt && now - lastSyncAt < HOME_INBOX_SYNC_INTERVAL_MS) return;
      wx.setStorageSync(HOME_INBOX_SYNC_AT_KEY, now);
    } catch (error) {}
    syncCreatorInbox({ minInterval: HOME_INBOX_SYNC_INTERVAL_MS }).catch(() => {});
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
    this.saveProfile();
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
  },

  startTheme() {
    this.saveProfile();
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
  },

  startTree() {
    this.saveProfile();
    const app = getApp();
    const template = getThemeTemplate("tree") || {};
    app.globalData.draftMode = "theme";
    app.globalData.draftThemeTemplate = "tree";
    app.globalData.draftThemePrompts = template.prompts || [];
    app.globalData.draftThemeChoices = {};
    app.globalData.draftThemeArtists = {};
    app.globalData.currentThemeSlotId = "";
    app.globalData.currentThemeSlotArtist = null;
    wx.navigateTo({ url: "/pages/theme-tree/theme-tree" });
  },

  startRainBox() {
    this.saveProfile();
    wx.navigateTo({ url: "/pages/rain-box/rain-box" });
  },

  startIntroQuiz() {
    this.saveProfile();
    const app = getApp();
    app.globalData.draftMode = "introQuiz";
    app.globalData.introQuizArtist = null;
    wx.navigateTo({ url: "/pages/artists/artists?mode=introQuiz" });
  },

  startLyricsShare() {
    this.saveProfile();
    const app = getApp();
    app.globalData.draftMode = "lyrics";
    app.globalData.draftArtists = [];
    app.globalData.lyricsShareArtist = null;
    app.globalData.lyricsShareSong = null;
    app.globalData.lyricsShareSelectedLyrics = [];
    wx.navigateTo({ url: "/pages/artists/artists?mode=lyrics" });
  },

  startTournament() {
    const active = getActiveTournament();
    if (!active) {
      this.beginNewTournament();
      return;
    }
    wx.showActionSheet({
      itemList: ["继续上次决选", "重新开始"],
      success: (res) => {
        if (res.tapIndex === 0) {
          const page = active.status === "setup" ? "tournament-setup" : "tournament-match";
          wx.navigateTo({ url: `/pages/${page}/${page}` });
          return;
        }
        if (res.tapIndex === 1) {
          wx.showModal({
            title: "重新开始？",
            content: "当前未完成的决选进度会被删除，已完成的历史记录不受影响。",
            confirmText: "重新开始",
            success: (modalRes) => {
              if (!modalRes.confirm) return;
              clearActiveTournament();
              this.beginNewTournament();
            }
          });
        }
      }
    });
  },

  beginNewTournament() {
    const app = getApp();
    app.globalData.draftMode = "songTournament";
    app.globalData.songTournamentArtist = null;
    wx.navigateTo({ url: "/pages/artists/artists?mode=songTournament" });
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
