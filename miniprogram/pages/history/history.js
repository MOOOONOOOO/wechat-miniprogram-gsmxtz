const {
  deleteHistoryRecord,
  getCreatedChallenge,
  getParticipatedResult,
  listHistory
} = require("../../utils/history");
const { syncCreatorInbox } = require("../../utils/historySync");
const { deleteTournamentRecord } = require("../../utils/songTournament");

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

Page({
  data: {
    filter: "all",
    filterItems: [],
    items: [],
    loading: false
  },

  onLoad() {
    this.render();
  },

  onShow() {
    this.syncInbox();
  },

  setFilter(event) {
    const filter = event.currentTarget.dataset.filter || "all";
    this.setData({ filter }, () => this.render());
  },

  syncInbox(options = {}) {
    this.setData({ loading: true });
    return syncCreatorInbox({
      throwOnError: Boolean(options.showFeedback)
    })
      .then((res) => {
        this.render();
        return res;
      })
      .catch((error) => {
        this.render();
        if (options.showFeedback) throw error;
      })
      .finally(() => this.setData({ loading: false }));
  },

  refreshInbox() {
    if (this.data.loading) return;
    wx.showLoading({ title: "刷新中" });
    this.syncInbox({ showFeedback: true })
      .then((res) => {
        wx.hideLoading();
        const count = Number((res || {}).count) || 0;
        const hasWarnings = Boolean(((res || {}).warnings || []).length);
        wx.showToast({
          title: count ? `已同步 ${count} 条` : (hasWarnings ? "同步异常，请重试" : "暂无新结果"),
          icon: "none"
        });
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({
          title: (error && error.message) || "同步失败",
          icon: "none"
        });
      });
  },

  render() {
    const filterItems = [
      { key: "all", text: "全部", activeClass: this.data.filter === "all" ? "active" : "" },
      { key: "created", text: "我发起", activeClass: this.data.filter === "created" ? "active" : "" },
      { key: "participated", text: "我参与", activeClass: this.data.filter === "participated" ? "active" : "" }
    ];
    const items = listHistory(this.data.filter);
    const renderToken = (this.historyRenderToken || 0) + 1;
    this.historyRenderToken = renderToken;
    this.setData({
      filterItems,
      items
    }, () => this.resolveAvatarUrls(renderToken));
  },

  resolveAvatarUrls(renderToken) {
    if (!wx.cloud || !wx.cloud.getTempFileURL) return;

    const fileList = Array.from(new Set(
      (this.data.items || [])
        .map((item) => item.avatarUrl)
        .filter(isCloudFileUrl)
    ));
    if (!fileList.length) return;

    wx.cloud.getTempFileURL({ fileList })
      .then((res) => {
        if (this.historyRenderToken !== renderToken) return;
        const tempUrlMap = (res.fileList || []).reduce((map, item) => {
          if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
          return map;
        }, {});
        this.setData({
          items: (this.data.items || []).map((item) => ({
            ...item,
            avatarUrl: tempUrlMap[item.avatarUrl] || item.avatarUrl
          }))
        });
      })
      .catch(() => {});
  },

  viewRecord(event) {
    const { type, challengeId, recordKind, tournamentId } = event.currentTarget.dataset;
    if (recordKind === "tournament") {
      wx.navigateTo({
        url: `/pages/tournament-result/tournament-result?id=${encodeURIComponent(tournamentId || challengeId)}`
      });
      return;
    }
    if (type === "created") {
      const record = getCreatedChallenge(challengeId);
      if (!record || !record.results || !record.results.length) {
        wx.showToast({ title: "还没有朋友作答", icon: "none" });
        return;
      }
      wx.navigateTo({ url: `/pages/challenge-results/challenge-results?challengeId=${challengeId}` });
      return;
    }

    const record = getParticipatedResult(challengeId);
    if (!record) {
      wx.showToast({ title: "记录不存在", icon: "none" });
      return;
    }
    const creatorChoices = ((record.challenge || {}).creatorChoices) || {};
    const isSoloQa = record.mode === "qa" && (!creatorChoices || !Object.keys(creatorChoices).length || ((record.challenge || {}).qaSolo === true));
    if (isSoloQa) {
      wx.navigateTo({ url: `/pages/theme-qa-board/theme-qa-board?history=participated&challengeId=${challengeId}` });
      return;
    }
    if (record.mode === "tree") {
      wx.navigateTo({ url: `/pages/theme-tree/theme-tree?role=friend&restore=1&challengeId=${encodeURIComponent(challengeId)}` });
      return;
    }
    wx.navigateTo({ url: `/pages/result/result?history=participated&challengeId=${challengeId}` });
  },

  shareRecord(event) {
    const challengeId = event.currentTarget.dataset.challengeId;
    const record = getCreatedChallenge(challengeId);
    if (!record || !record.challenge) {
      wx.showToast({ title: "记录不存在", icon: "none" });
      return;
    }

    const app = getApp();
    const challenge = record.challenge;
    app.globalData.challenge = challenge;
    app.globalData.draftMode = challenge.mode || "artist";
    app.globalData.draftArtists = (challenge.mode || "artist") === "album" ? [] : ((challenge.mode || "artist") === "color" ? (challenge.colors || []) : ((challenge.mode || "artist") === "qa" ? (challenge.qaPrompts || []) : ((challenge.mode || "artist") === "tree" ? (challenge.treePrompts || []) : (challenge.artists || []))));
    app.globalData.draftAlbums = challenge.albums || [];
    app.globalData.draftColors = challenge.colors || [];
    app.globalData.draftQaPrompts = challenge.qaPrompts || [];
    app.globalData.draftThemeTemplate = challenge.mode === "tree" ? "tree" : "";
    app.globalData.draftThemePrompts = challenge.treePrompts || [];
    app.globalData.draftThemeChoices = challenge.mode === "tree" ? (challenge.creatorChoices || {}) : {};
    app.globalData.draftQaArtists = {};
    app.globalData.creatorChoices = challenge.creatorChoices || {};
    app.globalData.creatorProfile = challenge.creatorProfile || record.creatorProfile || {};
    wx.navigateTo({ url: `/pages/share/share?challengeId=${challengeId}` });
  },

  deleteRecord(event) {
    const { type, challengeId, recordKind, tournamentId } = event.currentTarget.dataset;
    wx.showModal({
      title: "删除记录",
      content: "删除记录后无法找回。",
      confirmText: "删除",
      success: (res) => {
        if (!res.confirm) return;
        if (recordKind === "tournament") {
          deleteTournamentRecord(tournamentId || challengeId);
        } else {
          deleteHistoryRecord(type, challengeId);
        }
        this.render();
      }
    });
  }
});
