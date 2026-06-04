const {
  deleteCreatedResult,
  getCreatedChallenge
} = require("../../utils/history");
const { syncCreatorInbox } = require("../../utils/historySync");

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

function isUsableAvatarUrl(url) {
  const value = String(url || "").trim();
  return value.indexOf("cloud://") === 0
    || value.indexOf("wxfile://") === 0
    || /^https?:\/\//i.test(value);
}

function modeTitle(mode) {
  if (mode === "top9") return "同担 Top9 挑战";
  if (mode === "color") return "颜色推歌挑战";
  if (mode === "qa") return "歌单问答";
  return mode === "album" ? "专辑默契挑战" : "歌手默契挑战";
}

function formatTime(timestamp) {
  const date = new Date(timestamp || Date.now());
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

Page({
  data: {
    challengeId: "",
    title: "歌手默契挑战",
    countText: "0 位朋友已作答",
    bestText: "最高 0%",
    avgText: "平均 0%",
    showStats: true,
    results: []
  },

  onLoad(options) {
    this.setData({ challengeId: options.challengeId || "" }, () => this.render());
  },

  onShow() {
    this.render();
    this.syncCurrentChallenge();
  },

  syncCurrentChallenge() {
    const challengeId = this.data.challengeId;
    if (!challengeId) return;
    const now = Date.now();
    const record = getCreatedChallenge(challengeId);
    const needsAvatarRepair = Boolean(record && (record.results || []).some((item) => (
      (item.friendOpenId || ((item.friendProfile || {}).nickName)) && !((item.friendProfile || {}).avatarUrl)
    )));
    if (!needsAvatarRepair && this.detailSyncAt && now - this.detailSyncAt < 60 * 1000) return;
    this.detailSyncAt = now;
    syncCreatorInbox({
      challengeId,
      challengeOnly: true
    }).then(() => {
      this.render();
    }).catch(() => {});
  },

  render() {
    const record = getCreatedChallenge(this.data.challengeId);
    if (!record) {
      this.setData({ results: [] });
      return;
    }
    const isColorMode = record.mode === "color";
    const isQaMode = record.mode === "qa";
    const results = (record.results || []).map((item) => ({
      resultId: item.resultId,
      friendName: (item.friendProfile || {}).nickName || "匿名朋友",
      avatarUrl: isUsableAvatarUrl((item.friendProfile || {}).avatarUrl) ? (item.friendProfile || {}).avatarUrl : "",
      avatarText: ((item.friendProfile || {}).nickName || "友").slice(0, 1),
      scoreText: (isColorMode || isQaMode) ? "" : `${item.score || 0}%`,
      matchText: isColorMode ? "颜色推歌结果" : (isQaMode ? "歌单问答结果" : `${item.matchCount || 0}/9 契合`),
      timeText: formatTime(item.createdAt),
      metaText: (isColorMode || isQaMode) ? formatTime(item.createdAt) : `${item.matchCount || 0}/9 契合 · ${formatTime(item.createdAt)}`
    }));
    const scores = (record.results || []).map((item) => Number(item.score) || 0);
    const best = scores.reduce((max, score) => Math.max(max, score), 0);
    const avg = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
    this.setData({
      title: modeTitle(record.mode),
      countText: `${results.length} 位朋友已作答`,
      bestText: `最高 ${best}%`,
      avgText: `平均 ${avg}%`,
      showStats: !isColorMode && !isQaMode,
      results
    }, () => this.resolveAvatarUrls());
  },

  resolveAvatarUrls() {
    if (!wx.cloud || !wx.cloud.getTempFileURL) return;

    const fileList = Array.from(new Set(
      (this.data.results || [])
        .map((item) => item.avatarUrl)
        .filter(isCloudFileUrl)
    ));
    if (!fileList.length) return;

    wx.cloud.getTempFileURL({ fileList })
      .then((res) => {
        const tempUrlMap = (res.fileList || []).reduce((map, item) => {
          if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
          return map;
        }, {});
        this.setData({
          results: (this.data.results || []).map((item) => ({
            ...item,
            avatarUrl: isUsableAvatarUrl(tempUrlMap[item.avatarUrl] || item.avatarUrl)
              ? (tempUrlMap[item.avatarUrl] || item.avatarUrl)
              : ""
          }))
        });
      })
      .catch(() => {});
  },

  onAvatarError(event) {
    const index = Number((event.currentTarget || {}).dataset.index);
    if (Number.isNaN(index)) return;
    const failedUrl = ((this.data.results || [])[index] || {}).avatarUrl || "";
    console.warn("challenge result avatar load failed", {
      index,
      avatarType: isCloudFileUrl(failedUrl) ? "cloud" : (/^https?:\/\//i.test(failedUrl) ? "remote" : "invalid")
    });
    const results = (this.data.results || []).map((item, itemIndex) => (
      itemIndex === index ? { ...item, avatarUrl: "" } : item
    ));
    this.setData({ results });
  },

  viewResult(event) {
    const resultId = event.currentTarget.dataset.resultId;
    if (!resultId) return;
    const record = getCreatedChallenge(this.data.challengeId);
    const creatorChoices = (((record || {}).challenge || {}).creatorChoices) || {};
    const isSoloQa = (record || {}).mode === "qa" && (!creatorChoices || !Object.keys(creatorChoices).length || (((record || {}).challenge || {}).qaSolo === true));
    if (isSoloQa) {
      wx.navigateTo({ url: `/pages/theme-qa-board/theme-qa-board?history=created&challengeId=${this.data.challengeId}&resultId=${resultId}` });
      return;
    }
    wx.navigateTo({ url: `/pages/result/result?history=created&challengeId=${this.data.challengeId}&resultId=${resultId}&viewer=creator` });
  },

  shareAgain() {
    const record = getCreatedChallenge(this.data.challengeId);
    if (!record || !record.challenge) return;
    const app = getApp();
    const challenge = record.challenge;
    app.globalData.challenge = challenge;
    app.globalData.draftMode = challenge.mode || "artist";
    app.globalData.draftArtists = (challenge.mode || "artist") === "album" ? [] : ((challenge.mode || "artist") === "color" ? (challenge.colors || []) : ((challenge.mode || "artist") === "qa" ? (challenge.qaPrompts || []) : (challenge.artists || [])));
    app.globalData.draftAlbums = challenge.albums || [];
    app.globalData.draftColors = challenge.colors || [];
    app.globalData.draftQaPrompts = challenge.qaPrompts || [];
    app.globalData.draftQaArtists = {};
    app.globalData.draftTopArtist = challenge.topArtist || null;
    app.globalData.creatorChoices = challenge.creatorChoices || {};
    app.globalData.creatorTopSongs = challenge.creatorTopSongs || [];
    app.globalData.creatorProfile = challenge.creatorProfile || record.creatorProfile || {};
    wx.navigateTo({ url: `/pages/share/share?challengeId=${this.data.challengeId}` });
  },

  deleteResult(event) {
    const resultId = event.currentTarget.dataset.resultId;
    wx.showModal({
      title: "删除结果",
      content: "删除记录后无法找回。",
      confirmText: "删除",
      success: (res) => {
        if (!res.confirm) return;
        deleteCreatedResult(this.data.challengeId, resultId);
        this.render();
      }
    });
  }
});
