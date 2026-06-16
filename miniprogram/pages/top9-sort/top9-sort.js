const { createChallenge } = require("../../utils/api");
const { ensureChallenge, needsChallenge } = require("../../utils/challengeState");
const { readFriendDraft, saveFriendDraft } = require("../../utils/friendDraft");
const { saveCreatedChallenge } = require("../../utils/history");
const {
  getNextValidTargetCount,
  getTargetCountFromChallenge,
  isValidTargetCount,
  normalizeTargetCount
} = require("../../utils/targetCount");
const {
  creatorProfileGateData,
  creatorProfileGateMethods,
  prepareCreatorProfileForCreate
} = require("../../utils/creatorProfileGate");

function cleanTopSong(song, index) {
  const {
    selectedClass,
    dragClass,
    dragStyle,
    ...rest
  } = song || {};
  return {
    ...rest,
    rank: index + 1
  };
}

function getTopSongs(role) {
  const app = getApp();
  return role === "friend" ? (app.globalData.friendTopSongs || []) : (app.globalData.creatorTopSongs || []);
}

Page({
  data: {
    ...creatorProfileGateData,
    role: "creator",
    challengeId: "",
    topArtist: {},
    topArtistAvatar: "?",
    topSongs: [],
    targetCount: 9,
    canProceed: false,
    nextLabel: "创建挑战"
  },

  onLoad(options) {
    const safeOptions = options || {};
    const role = safeOptions.role || "creator";
    const challengeId = safeOptions.challengeId
      ? decodeURIComponent(safeOptions.challengeId)
      : ((getApp().globalData.challenge || {}).challengeId || "");

    if (role === "friend" && challengeId && needsChallenge(challengeId)) {
      wx.showLoading({ title: "读取挑战" });
      ensureChallenge(challengeId)
        .then(() => this.initPage({ ...safeOptions, challengeId }))
        .catch(() => {
          wx.showToast({ title: "挑战不存在", icon: "none" });
        })
        .finally(() => wx.hideLoading());
      return;
    }

    this.initPage({ ...safeOptions, challengeId });
  },

  initPage(options) {
    const app = getApp();
    const role = options.role || "creator";
    const challengeId = options.challengeId || ((app.globalData.challenge || {}).challengeId || "");
    if (role === "friend" && challengeId) {
      const draft = readFriendDraft(challengeId);
      if (!getTopSongs(role).length && Array.isArray(draft.friendTopSongs) && draft.friendTopSongs.length) {
        app.globalData.friendTopSongs = draft.friendTopSongs;
      }
      if (draft.friendProfile && (draft.friendProfile.nickName || draft.friendProfile.avatarUrl)) {
        app.globalData.friendProfile = draft.friendProfile;
      }
    }
    const topSongs = getTopSongs(role).map(cleanTopSong);
    const topArtist = app.globalData.draftTopArtist || (app.globalData.challenge || {}).topArtist || {};
    const targetCount = this.getTopTargetCount(topSongs.length, role);
    if (role === "creator") this.initCreatorProfileGate();
    this.setData({
      role,
      challengeId,
      topArtist,
      topArtistAvatar: topArtist.name ? topArtist.name.slice(0, 1) : "?",
      targetCount,
      topSongs: this.decorateTopSongs(topSongs),
      canProceed: this.canUseTopSongs(topSongs.length, role, targetCount),
      nextLabel: role === "friend" ? "查看结果" : "创建挑战"
    });
    this.persistTopSongs(topSongs);
  },

  ...creatorProfileGateMethods,

  decorateTopSongs(topSongs, dragState = null) {
    return (topSongs || []).map((song, index) => {
      const trackId = song && song.trackId;
      const classes = [];
      const style = [];
      if (dragState && dragState.active) {
        const { trackId: activeTrackId, startIndex, hoverIndex, offsetY, rowHeight } = dragState;
        if (trackId === activeTrackId) {
          classes.push("dragging");
          style.push(`transform: translate3d(0, ${offsetY}px, 0) scale(1.025)`);
          style.push("z-index: 5");
          style.push("transition: none");
        } else if (hoverIndex > startIndex && index > startIndex && index <= hoverIndex) {
          classes.push("shifting");
          style.push(`transform: translate3d(0, -${rowHeight}px, 0)`);
        } else if (hoverIndex < startIndex && index >= hoverIndex && index < startIndex) {
          classes.push("shifting");
          style.push(`transform: translate3d(0, ${rowHeight}px, 0)`);
        }
      }
      return {
        ...song,
        rank: index + 1,
        dragClass: classes.join(" "),
        dragStyle: style.join(";")
      };
    });
  },

  persistTopSongs(topSongs) {
    const cleanSongs = (topSongs || []).map(cleanTopSong);
    const app = getApp();
    if (this.data.role === "friend") {
      app.globalData.friendTopSongs = cleanSongs;
      saveFriendDraft(this.data.challengeId || (app.globalData.challenge || {}).challengeId || "", {
        friendTopSongs: cleanSongs,
        friendProfile: app.globalData.friendProfile || wx.getStorageSync(`friendProfile:${this.data.challengeId}`) || {}
      });
    } else app.globalData.creatorTopSongs = cleanSongs;

    const targetCount = this.getTopTargetCount(cleanSongs.length);
    this.setData({
      topSongs: this.decorateTopSongs(cleanSongs),
      targetCount,
      canProceed: this.canUseTopSongs(cleanSongs.length, this.data.role, targetCount)
    });
  },

  getTopTargetCount(count = this.data.topSongs.length, role = this.data.role) {
    if (role === "friend") {
      return normalizeTargetCount(this.data.targetCount || getTargetCountFromChallenge(getApp().globalData.challenge || {}, 9));
    }
    return isValidTargetCount(count)
      ? Number(count)
      : getNextValidTargetCount(count);
  },

  canUseTopSongs(count = this.data.topSongs.length, role = this.data.role, targetCount = this.data.targetCount) {
    if (role === "friend") return Number(count || 0) === Number(targetCount || 0);
    return isValidTargetCount(count);
  },

  removeTopSong(event) {
    const trackId = event.currentTarget.dataset.trackId;
    const topSongs = this.data.topSongs
      .filter((item) => item.trackId !== trackId)
      .map(cleanTopSong);
    this.persistTopSongs(topSongs);
  },

  onTopSongDragStart(event) {
    const index = Number(event.currentTarget.dataset.index);
    const touch = (event.touches || [])[0];
    if (Number.isNaN(index) || !touch) return;
    const song = this.data.topSongs[index];
    if (!song || !song.trackId) return;
    const info = wx.getSystemInfoSync();
    clearTimeout(this.dragActivateTimer);
    this.dragState = {
      active: false,
      startIndex: index,
      hoverIndex: index,
      trackId: song.trackId,
      startY: touch.clientY,
      offsetY: 0,
      rowHeight: 146 * (info.windowWidth || 375) / 750
    };
    this.dragActivateTimer = setTimeout(() => this.activateTopSongDrag(), 80);
  },

  activateTopSongDrag() {
    if (!this.dragState || this.dragState.active) return;
    this.dragState.active = true;
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    this.setData({
      topSongs: this.decorateTopSongs(this.data.topSongs.map(cleanTopSong), this.dragState)
    });
  },

  onTopSongDragMove(event) {
    if (!this.dragState) return;
    const touch = (event.touches || [])[0];
    if (!touch) return;
    const delta = touch.clientY - this.dragState.startY;

    if (!this.dragState.active) {
      if (Math.abs(delta) > 6) this.activateTopSongDrag();
      return;
    }

    const maxOffset = (this.data.topSongs.length - 1 - this.dragState.startIndex) * this.dragState.rowHeight;
    const minOffset = -this.dragState.startIndex * this.dragState.rowHeight;
    const offsetY = Math.max(minOffset, Math.min(maxOffset, delta));
    const hoverIndex = Math.max(
      0,
      Math.min(
        this.data.topSongs.length - 1,
        this.dragState.startIndex + Math.round(offsetY / this.dragState.rowHeight)
      )
    );
    this.dragState.offsetY = offsetY;
    this.dragState.hoverIndex = hoverIndex;
    this.setData({
      topSongs: this.decorateTopSongs(this.data.topSongs.map(cleanTopSong), this.dragState)
    });
  },

  onTopSongDragEnd() {
    clearTimeout(this.dragActivateTimer);
    const state = this.dragState;
    this.dragState = null;
    if (state && state.active) {
      const topSongs = this.data.topSongs.map(cleanTopSong);
      const [moved] = topSongs.splice(state.startIndex, 1);
      topSongs.splice(state.hoverIndex, 0, moved);
      this.persistTopSongs(topSongs.map(cleanTopSong));
    }
  },

  backToPick() {
    wx.navigateBack();
  },

  next() {
    if (!this.canUseTopSongs(this.data.topSongs.length)) {
      wx.showToast({ title: `请补满 ${this.getTopTargetCount(this.data.topSongs.length)} 首歌`, icon: "none" });
      return;
    }
    this.persistTopSongs(this.data.topSongs.map(cleanTopSong));

    if (this.data.role === "friend") {
      const challengeId = this.data.challengeId || (getApp().globalData.challenge || {}).challengeId || "";
      if (!challengeId) {
        wx.showToast({ title: "挑战信息丢失，请重新进入", icon: "none" });
        return;
      }
      wx.navigateTo({ url: `/pages/result/result?mode=friend&challengeId=${encodeURIComponent(challengeId)}` });
      return;
    }

    this.create();
  },

  create() {
    if (!this.ensureCreatorProfileForCreate("create")) return;
    wx.showLoading({ title: "创建中" });
    const app = getApp();
    const topArtist = app.globalData.draftTopArtist || this.data.topArtist;
    const creatorTopSongs = this.data.topSongs.map(cleanTopSong);
    app.globalData.draftMode = "top9";
    app.globalData.draftTopArtist = topArtist;
    app.globalData.creatorTopSongs = creatorTopSongs;
    app.globalData.draftTargetCount = creatorTopSongs.length;

    prepareCreatorProfileForCreate(this)
      .then((creatorProfile) => createChallenge({
        mode: "top9",
        artists: app.globalData.draftArtists,
        albums: app.globalData.draftAlbums,
        topArtist,
        creatorChoices: app.globalData.creatorChoices,
        creatorTopSongs,
        targetCount: creatorTopSongs.length,
        creatorProfile
      }))
      .then((res) => {
        app.globalData.challenge = {
          challengeId: res.challengeId,
          mode: "top9",
          artists: app.globalData.draftArtists,
          albums: app.globalData.draftAlbums,
          topArtist,
          creatorChoices: app.globalData.creatorChoices,
          creatorTopSongs,
          targetCount: creatorTopSongs.length,
          creatorProfile: app.globalData.creatorProfile || wx.getStorageSync("creatorProfile") || {},
          createdAt: Date.now()
        };
        saveCreatedChallenge(app.globalData.challenge);
        wx.navigateTo({ url: `/pages/share/share?challengeId=${res.challengeId}` });
      })
      .catch((error) => {
        wx.showToast({ title: (error && error.message) || "创建失败", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  }
});
