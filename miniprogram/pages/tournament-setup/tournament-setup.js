const { searchSongs } = require("../../utils/api");
const {
  clearActiveTournament,
  createTournament,
  getActiveTournament,
  getSongKey,
  getSongName,
  makeSetupDraft,
  samplePool,
  saveActiveTournament,
  uniqueSongs
} = require("../../utils/songTournament");

function decorateSong(song, index) {
  return {
    ...song,
    index,
    key: getSongKey(song),
    displayName: getSongName(song),
    displayAlbum: song.album || song.collectionName || "未知专辑",
    fallbackText: getSongName(song).slice(0, 1) || "音"
  };
}

Page({
  data: {
    loading: true,
    loadError: "",
    artist: null,
    artistName: "",
    size: 16,
    sourceCount: 0,
    canUse16: false,
    canUse32: false,
    pool: [],
    poolPreview: [],
    poolExpanded: false,
    confirming: false
  },

  onLoad() {
    const active = getActiveTournament();
    if (active && active.status === "setup" && active.artist) {
      const size = Number(active.size) === 32 ? 32 : 16;
      const rankedPool = (active.sourceSongs || []).slice(0, size);
      this.draft = active.poolStrategy
        ? active
        : { ...active, size, pool: rankedPool, poolStrategy: "ranked", updatedAt: Date.now() };
      if (!active.poolStrategy) saveActiveTournament(this.draft);
      this.renderDraft();
      return;
    }
    const artist = getApp().globalData.songTournamentArtist;
    if (!artist) {
      this.setData({ loading: false, loadError: "没有找到已选择的歌手" });
      return;
    }
    this.loadSongs(artist);
  },

  loadSongs(artist = this.data.artist) {
    if (!artist) return;
    this.setData({ loading: true, loadError: "", artist, artistName: artist.name || artist.artistName || "" });
    searchSongs(artist, "")
      .then((res) => {
        const songs = uniqueSongs(res.songs || []);
        if (songs.length < 16) {
          this.setData({
            loading: false,
            sourceCount: songs.length,
            canUse16: false,
            canUse32: false,
            loadError: `目前只找到 ${songs.length} 首可用歌曲，请更换歌手`
          });
          return;
        }
        const resolvedArtist = {
          ...artist,
          artistId: artist.artistId || res.artistId || "",
          resolvedArtistName: artist.resolvedArtistName || res.artistName || ""
        };
        const draft = makeSetupDraft({ artist: resolvedArtist, sourceSongs: songs, size: 16 });
        if (!this.persistDraft(draft)) return;
        this.renderDraft();
      })
      .catch((error) => {
        this.setData({
          loading: false,
          loadError: (error && error.message) || "歌曲数据加载失败，请重试"
        });
      });
  },

  renderDraft() {
    const draft = this.draft || {};
    const sourceSongs = draft.sourceSongs || [];
    this.setData({
      loading: false,
      loadError: "",
      artist: draft.artist || null,
      artistName: (draft.artist || {}).name || (draft.artist || {}).artistName || "",
      size: draft.size || 16,
      sourceCount: sourceSongs.length,
      canUse16: sourceSongs.length >= 16,
      canUse32: sourceSongs.length >= 32,
      pool: (draft.pool || []).map(decorateSong),
      poolPreview: (draft.pool || []).slice(0, 3).map(decorateSong)
    });
  },

  persistDraft(draft) {
    if (!saveActiveTournament(draft)) {
      wx.showToast({ title: "本地进度保存失败", icon: "none" });
      return false;
    }
    this.draft = draft;
    return true;
  },

  selectSize(event) {
    const size = Number(event.currentTarget.dataset.size || 16);
    if (size === 32 && !this.data.canUse32) {
      wx.showToast({ title: "当前曲库不足 32 首，可以进行 16 首赛", icon: "none" });
      return;
    }
    if (!this.draft || this.draft.size === size) return;
    const pool = (this.draft.sourceSongs || []).slice(0, size);
    if (!this.persistDraft({ ...this.draft, size, pool, poolStrategy: "ranked", updatedAt: Date.now() })) return;
    this.renderDraft();
  },

  refreshPool() {
    if (!this.draft) return;
    const pool = samplePool(this.draft.sourceSongs, this.draft.size);
    if (!pool.length) {
      wx.showToast({ title: "暂时无法生成新名单", icon: "none" });
      return;
    }
    if (!this.persistDraft({ ...this.draft, pool, poolStrategy: "random", updatedAt: Date.now() })) return;
    this.renderDraft();
  },

  togglePool() {
    this.setData({ poolExpanded: !this.data.poolExpanded });
  },

  onPoolCoverError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.draft || !this.draft.pool[index]) return;
    const pool = this.draft.pool.map((song, itemIndex) => itemIndex === index ? { ...song, cover: "", coverUrl: "" } : song);
    this.draft = { ...this.draft, pool };
    this.renderDraft();
  },

  confirmPool() {
    if (this.data.confirming || !this.draft || this.draft.pool.length !== this.draft.size) return;
    const tournament = createTournament(this.draft);
    if (!tournament) {
      wx.showToast({ title: "参赛名单不完整", icon: "none" });
      return;
    }
    this.setData({ confirming: true });
    if (!saveActiveTournament(tournament)) {
      this.setData({ confirming: false });
      wx.showToast({ title: "比赛进度保存失败", icon: "none" });
      return;
    }
    wx.redirectTo({ url: "/pages/tournament-match/tournament-match" });
  },

  retry() {
    this.loadSongs(this.data.artist || getApp().globalData.songTournamentArtist);
  },

  changeArtist() {
    clearActiveTournament();
    getApp().globalData.songTournamentArtist = null;
    wx.navigateBack();
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: "/pages/home/home" });
  }
});
