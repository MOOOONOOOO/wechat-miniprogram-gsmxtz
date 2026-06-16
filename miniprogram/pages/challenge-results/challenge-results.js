const {
  deleteCreatedResult,
  getCreatedChallenge
} = require("../../utils/history");
const { getChallengeMultiplayer } = require("../../utils/api");
const { syncCreatorInbox } = require("../../utils/historySync");
const { getMockRecord, getMockSummary, normalizeMode } = require("../../utils/multiplayerMock");

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
  if (mode === "top9") return "同担 Top 挑战";
  if (mode === "color") return "颜色推歌挑战";
  if (mode === "qa") return "歌单问答";
  return mode === "album" ? "专辑默契挑战" : "歌手默契挑战";
}

function supportsMultiplayer(mode) {
  return ["artist", "album", "top9"].indexOf(mode) >= 0;
}

function hasEnoughMultiplayerPeople(friendCount) {
  return Number(friendCount || 0) + 1 >= 3;
}

function normalizeTime(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value.$date) return normalizeTime(value.$date);
  return 0;
}

function resultTotalCount(record, item) {
  const result = (item || {}).result || {};
  const explicitTotal = Number((item || {}).totalCount || result.totalCount) || 0;
  if (explicitTotal) return explicitTotal;
  const challenge = (record || {}).challenge || {};
  const targetCount = Number(challenge.targetCount || (record || {}).targetCount) || 0;
  if (targetCount && supportsMultiplayer((record || {}).mode)) return targetCount;
  if ((record || {}).mode === "top9") {
    return Math.max((challenge.creatorTopSongs || []).length, ((item || {}).friendTopSongs || []).length, 9);
  }
  if ((record || {}).mode === "album") return (challenge.albums || []).length || 9;
  if ((record || {}).mode === "artist") return (challenge.artists || []).length || 9;
  return 0;
}

function formatMatchText(record, item) {
  return `${(item || {}).matchCount || 0}/${resultTotalCount(record, item)} 契合`;
}

function formatPairMatchText(pair) {
  const matchCount = Number(pair && pair.matchCount) || 0;
  const totalCount = Number(pair && pair.totalCount) || 0;
  return `${matchCount}/${totalCount} 契合`;
}

function makePairResultQuery(challengeId, leftParticipantId, rightParticipantId) {
  return [
    "pair=1",
    `challengeId=${encodeURIComponent(challengeId || "")}`,
    `leftParticipantId=${encodeURIComponent(leftParticipantId || "")}`,
    `rightParticipantId=${encodeURIComponent(rightParticipantId || "")}`
  ].join("&");
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
    showMultiplayerOverview: false,
    multiplayerBestPair: null,
    multiplayerMyBestPair: null,
    multiplayerPairRows: [],
    results: [],
    mockMultiplayer: false
  },

  onLoad(options) {
    if ((options || {}).mock === "multiplayer") {
      const mode = normalizeMode((options || {}).mode);
      this.setData({
        challengeId: `mock-multiplayer-${mode}`,
        mockMultiplayer: true
      }, () => this.renderMockMultiplayer(mode));
      return;
    }
    this.setData({ challengeId: options.challengeId || "" }, () => this.render());
  },

  onShow() {
    if (this.data.mockMultiplayer) return;
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

  renderMockMultiplayer(mode) {
    const record = getMockRecord(mode);
    const results = (record.results || []).map((item) => ({
      resultId: item.resultId,
      friendName: (item.friendProfile || {}).nickName || "匿名朋友",
      avatarUrl: "",
      avatarText: ((item.friendProfile || {}).nickName || "友").slice(0, 1),
      scoreText: `${item.score || 0}%`,
      matchText: formatMatchText(record, item),
      timeText: formatTime(item.createdAt),
      metaText: `${formatMatchText(record, item)} · ${formatTime(item.createdAt)}`
    }));
    const scores = (record.results || []).map((item) => Number(item.score) || 0);
    const best = scores.reduce((max, score) => Math.max(max, score), 0);
    const avg = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
    this.setData({
      title: `${modeTitle(record.mode)} · Mock`,
      countText: `${results.length} 位朋友已作答`,
      bestText: `最高 ${best}%`,
      avgText: `平均 ${avg}%`,
      showStats: true,
      results,
      mockMultiplayer: true
    }, () => this.loadMockMultiplayerOverview(record.mode));
  },

  loadMockMultiplayerOverview(mode) {
    const res = getMockSummary(mode, "creator");
    if (!hasEnoughMultiplayerPeople(res.participantCount)) {
      this.resetMultiplayerOverview();
      return;
    }
    const mapPair = (pair, index) => ({
      ...pair,
      rank: index + 1,
      namesText: `${pair.leftName || "TA"} × ${pair.rightName || "TA"}`,
      scoreText: `${Number(pair.score) || 0}%`,
      matchText: pair.matchText || formatPairMatchText(pair),
      leftAvatarUrl: "",
      rightAvatarUrl: "",
      leftOriginalAvatarUrl: "",
      rightOriginalAvatarUrl: "",
      leftInitial: pair.leftInitial || String(pair.leftName || "友").slice(0, 1),
      rightInitial: pair.rightInitial || String(pair.rightName || "友").slice(0, 1)
    });
    const rows = (res.pairLeaderboard || []).slice(0, 5).map(mapPair);
    const myBestPair = (res.viewerRanking || [])[0] || null;
    this.setData({
      showMultiplayerOverview: rows.length > 0,
      multiplayerBestPair: res.bestPair ? mapPair(res.bestPair, 0) : null,
      multiplayerMyBestPair: myBestPair ? mapPair(myBestPair, 0) : null,
      multiplayerPairRows: rows
    });
  },

  render() {
    const record = getCreatedChallenge(this.data.challengeId);
    if (!record) {
      this.setData({
        results: [],
        showMultiplayerOverview: false,
        multiplayerBestPair: null,
        multiplayerMyBestPair: null,
        multiplayerPairRows: []
      });
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
      matchText: isColorMode ? "颜色推歌结果" : (isQaMode ? "歌单问答结果" : formatMatchText(record, item)),
      timeText: formatTime(item.createdAt),
      metaText: (isColorMode || isQaMode) ? formatTime(item.createdAt) : `${formatMatchText(record, item)} · ${formatTime(item.createdAt)}`
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
    }, () => {
      this.resolveAvatarUrls();
      this.loadMultiplayerOverview(record);
    });
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

  resetMultiplayerOverview() {
    this.multiplayerOverviewKey = "";
    this.setData({
      showMultiplayerOverview: false,
      multiplayerBestPair: null,
      multiplayerMyBestPair: null,
      multiplayerPairRows: []
    });
  },

  loadMultiplayerOverview(record) {
    const results = (record && record.results) || [];
    if (!record || !record.challengeId || !supportsMultiplayer(record.mode) || !hasEnoughMultiplayerPeople(results.length)) {
      this.resetMultiplayerOverview();
      return;
    }

    const latestTime = results.reduce((latest, item) => Math.max(latest, normalizeTime(item.createdAt)), 0);
    const requestKey = `${record.challengeId}:${record.mode}:${results.length}:${latestTime}`;
    if (this.multiplayerOverviewKey === requestKey && (this.data.multiplayerPairRows || []).length) return;
    this.multiplayerOverviewKey = requestKey;

    getChallengeMultiplayer({
      challengeId: record.challengeId
    }).then((res) => {
      if (this.multiplayerOverviewKey !== requestKey) return;
      if (!res.supported || !(res.pairLeaderboard || []).length) {
        this.resetMultiplayerOverview();
        return;
      }
      if (!hasEnoughMultiplayerPeople(res.participantCount)) {
        this.resetMultiplayerOverview();
        return;
      }

      const mapPair = (pair, index) => ({
        ...pair,
        rank: index + 1,
        namesText: `${pair.leftName || "TA"} × ${pair.rightName || "TA"}`,
        scoreText: `${Number(pair.score) || 0}%`,
        matchText: pair.matchText || formatPairMatchText(pair),
        leftAvatarUrl: isUsableAvatarUrl(pair.leftAvatarUrl) ? pair.leftAvatarUrl : "",
        rightAvatarUrl: isUsableAvatarUrl(pair.rightAvatarUrl) ? pair.rightAvatarUrl : "",
        leftOriginalAvatarUrl: pair.leftAvatarUrl || "",
        rightOriginalAvatarUrl: pair.rightAvatarUrl || "",
        leftInitial: pair.leftInitial || String(pair.leftName || "友").slice(0, 1),
        rightInitial: pair.rightInitial || String(pair.rightName || "友").slice(0, 1)
      });
      const rows = (res.pairLeaderboard || []).slice(0, 5).map(mapPair);
      const myBestPair = (res.viewerRanking || [])[0] || null;
      this.setData({
        showMultiplayerOverview: rows.length > 0,
        multiplayerBestPair: res.bestPair ? mapPair(res.bestPair, 0) : null,
        multiplayerMyBestPair: myBestPair ? mapPair(myBestPair, 0) : null,
        multiplayerPairRows: rows
      }, () => this.resolveMultiplayerAvatars());
    }).catch(() => {
      if (this.multiplayerOverviewKey === requestKey) this.resetMultiplayerOverview();
    });
  },

  resolveMultiplayerAvatars() {
    if (!wx.cloud || !wx.cloud.getTempFileURL) return;
    const items = []
      .concat(this.data.multiplayerBestPair ? [this.data.multiplayerBestPair] : [])
      .concat(this.data.multiplayerMyBestPair ? [this.data.multiplayerMyBestPair] : [])
      .concat(this.data.multiplayerPairRows || []);
    const fileList = Array.from(new Set(items.reduce((list, item) => (
      list.concat([item.leftOriginalAvatarUrl, item.rightOriginalAvatarUrl])
    ), []).filter(isCloudFileUrl)));
    if (!fileList.length) return;

    wx.cloud.getTempFileURL({ fileList })
      .then((res) => {
        const tempUrlMap = (res.fileList || []).reduce((map, item) => {
          if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
          return map;
        }, {});
        const applyTempUrl = (item) => ({
          ...item,
          leftAvatarUrl: isUsableAvatarUrl(tempUrlMap[item.leftOriginalAvatarUrl] || item.leftAvatarUrl)
            ? (tempUrlMap[item.leftOriginalAvatarUrl] || item.leftAvatarUrl)
            : "",
          rightAvatarUrl: isUsableAvatarUrl(tempUrlMap[item.rightOriginalAvatarUrl] || item.rightAvatarUrl)
            ? (tempUrlMap[item.rightOriginalAvatarUrl] || item.rightAvatarUrl)
            : ""
        });
        this.setData({
          multiplayerBestPair: this.data.multiplayerBestPair ? applyTempUrl(this.data.multiplayerBestPair) : null,
          multiplayerMyBestPair: this.data.multiplayerMyBestPair ? applyTempUrl(this.data.multiplayerMyBestPair) : null,
          multiplayerPairRows: (this.data.multiplayerPairRows || []).map(applyTempUrl)
        });
      })
      .catch(() => {});
  },

  onMultiplayerPairAvatarError(event) {
    const index = Number((event.currentTarget || {}).dataset.index);
    const side = ((event.currentTarget || {}).dataset.side) === "right" ? "right" : "left";
    if (Number.isNaN(index)) return;
    const avatarKey = `${side}AvatarUrl`;
    const rows = (this.data.multiplayerPairRows || []).map((item, itemIndex) => (
      itemIndex === index ? { ...item, [avatarKey]: "" } : item
    ));
    this.setData({ multiplayerPairRows: rows });
  },

  viewPairResult(event) {
    const dataset = (event.currentTarget || {}).dataset || {};
    const leftParticipantId = dataset.leftId || "";
    const rightParticipantId = dataset.rightId || "";
    if (!this.data.challengeId || !leftParticipantId || !rightParticipantId) return;
    if (this.data.mockMultiplayer) {
      const mode = normalizeMode(this.data.challengeId.replace("mock-multiplayer-", ""));
      wx.navigateTo({
        url: `/pages/result/result?mock=multiplayer&mode=${encodeURIComponent(mode)}&${makePairResultQuery(this.data.challengeId, leftParticipantId, rightParticipantId)}`
      });
      return;
    }
    wx.navigateTo({
      url: `/pages/result/result?${makePairResultQuery(this.data.challengeId, leftParticipantId, rightParticipantId)}`
    });
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
    if (this.data.mockMultiplayer) {
      const mode = normalizeMode(this.data.challengeId.replace("mock-multiplayer-", ""));
      wx.navigateTo({ url: `/pages/result/result?mock=multiplayer&mode=${encodeURIComponent(mode)}&viewerParticipantId=${encodeURIComponent(resultId)}` });
      return;
    }
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
