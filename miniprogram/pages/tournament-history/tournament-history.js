const {
  deleteTournamentRecord,
  deriveTournament,
  getSongName,
  listTournamentHistory
} = require("../../utils/songTournament");

function formatDate(value) {
  const date = new Date(value || Date.now());
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

Page({
  data: { records: [] },

  onShow() {
    this.render();
  },

  render() {
    const records = listTournamentHistory().map((record) => {
      const derived = deriveTournament(record);
      if (!derived.valid || !derived.complete) return null;
      return {
        id: record.id,
        artistName: (record.artist || {}).name || "未知歌手",
        size: record.size,
        completedAt: formatDate(record.completedAt),
        championName: getSongName(derived.champion),
        championCover: (derived.champion || {}).cover || "",
        fallbackText: getSongName(derived.champion).slice(0, 1) || "音"
      };
    }).filter(Boolean);
    this.setData({ records });
  },

  openRecord(event) {
    wx.navigateTo({ url: `/pages/tournament-result/tournament-result?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },

  onCoverError(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({
      records: this.data.records.map((record) => record.id === id ? { ...record, championCover: "" } : record)
    });
  },

  deleteRecord(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除这条决选记录？",
      content: "删除后无法恢复，已保存到相册的图片不受影响。",
      confirmText: "删除",
      confirmColor: "#c9342f",
      success: (res) => {
        if (!res.confirm) return;
        deleteTournamentRecord(id);
        this.render();
      }
    });
  }
});
