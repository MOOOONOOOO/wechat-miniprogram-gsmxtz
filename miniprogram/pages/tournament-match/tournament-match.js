const {
  deriveTournament,
  getActiveTournament,
  getSongKey,
  getSongName,
  saveActiveTournament,
  saveCompletedTournament,
  selectGroupWinners,
  selectWinner,
  undoLastChoice
} = require("../../utils/songTournament");

function decorateSong(song, selectedKeys = [], eliminatedKeys = []) {
  const key = getSongKey(song);
  const selected = selectedKeys.indexOf(key) >= 0;
  const eliminated = eliminatedKeys.indexOf(key) >= 0;
  return {
    ...(song || {}),
    key,
    displayName: getSongName(song),
    displayAlbum: (song || {}).album || (song || {}).collectionName || "未知专辑",
    fallbackText: getSongName(song).slice(0, 1) || "音",
    selectedClass: selected ? "selected" : "",
    stateClass: selected ? (eliminatedKeys.length ? "selected advanced" : "selected") : (eliminated ? "eliminated" : "")
  };
}

function stageToken(derived) {
  if (!derived) return "";
  if (derived.phase === "group4") return `group4:${derived.currentGroupIndex}`;
  return `pair:${(derived.currentRound || {}).key || ""}`;
}

function stageContent(derived, size) {
  if (derived.phase === "group4") {
    const total = size / 4;
    return {
      label: `${size} 进 ${size / 2}`,
      copy: "每 4 首，留下 2 首",
      progress: `${derived.currentGroupIndex + 1}/${total}`
    };
  }
  const round = derived.currentRound || {};
  return {
    label: round.label || "两两决选",
    copy: round.key === "final" ? "最后，只留下一首" : "两两选择，继续收束",
    progress: `${Number(derived.currentMatchIndex || 0) + 1}/${(round.matches || []).length}`
  };
}

function compactStageLabel(label) {
  return String(label || "").replace(/\s+/g, "");
}

function finishedStage(before, after) {
  if (before.phase === "group4") return after.phase !== "group4";
  return before.phase === "pair"
    && after.phase === "pair"
    && (before.currentRound || {}).key !== (after.currentRound || {}).key;
}

function completedWinners(before, after) {
  if (before.phase === "group4") {
    const firstRound = (after.rounds || [])[0] || {};
    return (firstRound.groups || []).reduce((songs, group) => songs.concat(group.winners || []), []);
  }
  const key = (before.currentRound || {}).key;
  const round = (after.rounds || []).find((item) => item.key === key);
  return ((round || {}).matches || []).map((match) => match.winner).filter(Boolean);
}

Page({
  data: {
    invalid: false,
    stageTitle: "",
    stageCopy: "",
    progressText: "",
    overallText: "",
    progressPercent: 0,
    songs: [],
    groupMode: false,
    selectedCount: 0,
    canConfirmGroup: false,
    locked: false,
    roundBreak: false,
    roundBreakLabel: "",
    roundBreakTitle: "",
    roundWinners: [],
    nextStageLabel: "",
    canUndo: false,
    undoLabel: "撤销上一组"
  },

  onLoad() {
    this.pendingGroupKeys = [];
    this.loadActive();
  },

  onShow() {
    if (!this.data.locked && !this.data.roundBreak) this.loadActive();
  },

  onUnload() {
    clearTimeout(this.advanceTimer);
  },

  loadActive() {
    const tournament = getActiveTournament();
    if (!tournament || tournament.status !== "playing") {
      this.setData({ invalid: true });
      return;
    }
    this.tournament = tournament;
    this.renderMatch();
  },

  renderMatch() {
    const derived = deriveTournament(this.tournament);
    if (!derived.valid) {
      this.setData({ invalid: true });
      return;
    }
    if (derived.complete) {
      this.finishTournament();
      return;
    }
    this.derived = derived;
    const content = stageContent(derived, this.tournament.size);
    const groupMode = derived.phase === "group4";
    const groupId = groupMode ? derived.currentGroup.id : "";
    if (this.pendingGroupId !== groupId) {
      this.pendingGroupId = groupId;
      this.pendingGroupKeys = [];
    }
    const sourceSongs = groupMode
      ? derived.currentGroup.songs
      : [derived.currentMatch.left, derived.currentMatch.right];
    const artistName = (this.tournament.artist || {}).name || "";
    this.setData({
      invalid: false,
      stageTitle: `${artistName} ${compactStageLabel(content.label)}`.trim(),
      stageCopy: content.copy,
      progressText: content.progress,
      overallText: `已完成 ${derived.decisionCount} / ${derived.totalDecisions} 组选择`,
      progressPercent: Math.round(derived.decisionCount / derived.totalDecisions * 100),
      songs: sourceSongs.map((song) => decorateSong(song, this.pendingGroupKeys)),
      groupMode,
      selectedCount: this.pendingGroupKeys.length,
      canConfirmGroup: groupMode && this.pendingGroupKeys.length === 2,
      locked: false,
      roundBreak: false,
      canUndo: this.pendingGroupKeys.length > 0 || (this.tournament.decisions || []).length > 0,
      undoLabel: this.pendingGroupKeys.length ? "清空本组选中" : "撤销上一组"
    });
  },

  chooseSong(event) {
    if (this.data.locked || this.data.roundBreak) return;
    const key = event.currentTarget.dataset.key;
    if (this.data.groupMode) {
      this.toggleGroupSong(key);
      return;
    }
    const before = this.derived || deriveTournament(this.tournament);
    const next = selectWinner(this.tournament, key);
    if (!next) return;
    if (!saveActiveTournament(next)) {
      wx.showToast({ title: "进度保存失败，请重试", icon: "none" });
      return;
    }
    this.tournament = next;
    this.setData({
      songs: this.data.songs.map((song) => decorateSong(
        song,
        [key],
        this.data.songs.filter((item) => item.key !== key).map((item) => item.key)
      )),
      locked: true,
      canUndo: true
    });
    this.scheduleAdvance(before, 620);
  },

  toggleGroupSong(key) {
    const selected = this.pendingGroupKeys.slice();
    const index = selected.indexOf(key);
    if (index >= 0) {
      selected.splice(index, 1);
    } else if (selected.length < 2) {
      selected.push(key);
    } else {
      wx.showToast({ title: "这一组只能留下 2 首", icon: "none" });
      return;
    }
    this.pendingGroupKeys = selected;
    this.setData({
      songs: this.derived.currentGroup.songs.map((song) => decorateSong(song, selected)),
      selectedCount: selected.length,
      canConfirmGroup: selected.length === 2,
      canUndo: selected.length > 0 || (this.tournament.decisions || []).length > 0,
      undoLabel: selected.length ? "清空本组选中" : "撤销上一组"
    });
  },

  confirmGroup() {
    if (this.data.locked || this.pendingGroupKeys.length !== 2) return;
    const before = this.derived || deriveTournament(this.tournament);
    const next = selectGroupWinners(this.tournament, this.pendingGroupKeys);
    if (!next) return;
    if (!saveActiveTournament(next)) {
      wx.showToast({ title: "进度保存失败，请重试", icon: "none" });
      return;
    }
    this.tournament = next;
    this.setData({ locked: true, canConfirmGroup: false, canUndo: true });
    this.scheduleAdvance(before);
  },

  scheduleAdvance(before, delay = 420) {
    this.advanceTimer = setTimeout(() => {
      const after = deriveTournament(this.tournament);
      if (!after.valid) {
        this.setData({ invalid: true, locked: false });
        return;
      }
      if (after.complete) {
        this.finishTournament();
        return;
      }
      if (finishedStage(before, after)) {
        const nextContent = stageContent(after, this.tournament.size);
        this.pendingGroupKeys = [];
        this.pendingGroupId = "";
        this.derived = after;
        this.setData({
          locked: false,
          roundBreak: true,
          roundBreakLabel: `${(before.currentRound || {}).label} 完成`,
          roundBreakTitle: "这一轮留下了这些歌曲",
          roundWinners: completedWinners(before, after).map((song) => ({
            ...song,
            key: getSongKey(song),
            displayName: getSongName(song),
            fallbackText: getSongName(song).slice(0, 1) || "音"
          })),
          nextStageLabel: nextContent.label,
          canUndo: true,
          undoLabel: "撤销上一组"
        });
        return;
      }
      this.pendingGroupKeys = [];
      this.pendingGroupId = "";
      this.renderMatch();
    }, delay);
  },

  continueRound() {
    this.setData({ roundBreak: false }, () => this.renderMatch());
  },

  undoLast() {
    if (this.data.locked) return;
    if (this.pendingGroupKeys.length) {
      this.pendingGroupKeys = [];
      this.renderMatch();
      return;
    }
    const previous = undoLastChoice(this.tournament);
    if (!previous) {
      wx.showToast({ title: "还没有可以撤销的选择", icon: "none" });
      return;
    }
    if (!saveActiveTournament(previous)) {
      wx.showToast({ title: "进度保存失败，请重试", icon: "none" });
      return;
    }
    this.tournament = previous;
    this.pendingGroupId = "";
    this.setData({ roundBreak: false }, () => this.renderMatch());
  },

  onSongCoverError(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({
      songs: this.data.songs.map((song) => song.key === key ? { ...song, cover: "", coverUrl: "" } : song)
    });
  },

  onWinnerCoverError(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({
      roundWinners: this.data.roundWinners.map((song) => song.key === key ? { ...song, cover: "", coverUrl: "" } : song)
    });
  },

  finishTournament() {
    const record = saveCompletedTournament(this.tournament);
    if (!record) {
      wx.showToast({ title: "结果保存失败，请重试", icon: "none" });
      this.setData({ locked: false });
      return;
    }
    wx.redirectTo({ url: `/pages/tournament-result/tournament-result?id=${encodeURIComponent(record.id)}` });
  },

  goHome() {
    wx.reLaunch({ url: "/pages/home/home" });
  }
});
