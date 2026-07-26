const { searchSongs } = require("./utils/api");
const {
  createTournament,
  deriveTournament,
  makeSetupDraft,
  saveCompletedTournament,
  selectGroupWinners,
  selectWinner
} = require("./utils/songTournament");

App({
  globalData: {
    envId: "",
    user: null,
    draftMode: "artist",
    draftArtists: [],
    draftAlbums: [],
    draftColors: [],
    draftColorArtists: {},
    draftThemeTemplate: "",
    draftThemePrompts: [],
    draftThemeChoices: {},
    draftThemeArtists: {},
    draftQaPrompts: [],
    draftQaArtists: {},
    currentThemeSlotId: "",
    currentThemeSlotArtist: null,
    currentQaSlotId: "",
    currentQaSlotArtist: null,
    currentColorId: "",
    currentColorArtist: null,
    draftTopArtist: null,
    songTournamentArtist: null,
    creatorChoices: {},
    creatorTopSongs: [],
    creatorProfile: null,
    friendProfile: null,
    challenge: null,
    friendChoices: {},
    friendTopSongs: [],
    treeMockCovers: [],
    lastResult: null
  },

  onLaunch() {
    if (wx.cloud) {
      const cloudOptions = { traceUser: true };
      if (this.globalData.envId) cloudOptions.env = this.globalData.envId;
      wx.cloud.init(cloudOptions);
    }
  },

  openTournamentMock(size = 16) {
    const tournamentSize = Number(size) === 32 ? 32 : 16;
    const artist = {
      id: "mock-jj-lin",
      name: "林俊杰",
      artistName: "林俊杰",
      searchTerm: "林俊杰"
    };
    wx.showLoading({ title: "读取真实歌曲" });
    return searchSongs(artist)
      .then((res) => {
        const songs = (res.songs || []).slice(0, tournamentSize);
        if (songs.length < tournamentSize) {
          throw new Error(`只获取到 ${songs.length} 首歌`);
        }
        const resolvedArtist = {
          ...artist,
          artistId: res.artistId || "",
          itunesArtistId: res.artistId || "",
          trustedArtistId: Boolean(res.artistId),
          resolvedArtistName: res.artistName || "林俊杰"
        };
        const setup = makeSetupDraft({
          artist: resolvedArtist,
          sourceSongs: songs,
          size: tournamentSize,
          pool: songs,
          id: `tournament-live-mock-${Date.now()}`
        });
        let tournament = createTournament(setup, () => 0.999);
        let derived = deriveTournament(tournament);
        let pairIndex = 0;
        while (derived.valid && !derived.complete) {
          if (derived.phase === "group4") {
            tournament = selectGroupWinners(tournament, [
              derived.currentGroup.songs[0],
              derived.currentGroup.songs[2]
            ]);
          } else {
            const winner = pairIndex % 2
              ? derived.currentMatch.right
              : derived.currentMatch.left;
            tournament = selectWinner(tournament, winner);
            pairIndex += 1;
          }
          derived = deriveTournament(tournament);
        }
        if (!derived.valid || !derived.complete) {
          throw new Error((derived && derived.reason) || "赛事 Mock 生成失败");
        }
        const record = saveCompletedTournament(tournament);
        if (!record) throw new Error("赛事 Mock 保存失败");
        wx.navigateTo({
          url: `/pages/tournament-result/tournament-result?id=${encodeURIComponent(record.id)}`
        });
        return record;
      })
      .catch((error) => {
        wx.showToast({
          title: String((error && error.message) || "Mock 生成失败").slice(0, 18),
          icon: "none"
        });
        throw error;
      })
      .finally(() => wx.hideLoading());
  },

  openTreeMock() {
    const url = "/pages/theme-tree/theme-tree?mock=tree-left";
    const artist = {
      id: "mock-tree-jj-lin",
      name: "林俊杰",
      artistName: "林俊杰",
      searchTerm: "林俊杰"
    };
    wx.showLoading({ title: "准备封面" });
    return searchSongs(artist)
      .then((res) => {
        const seen = {};
        const covers = (res.songs || [])
          .map((song) => song && (song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || ""))
          .filter((cover) => {
            if (!cover || seen[cover]) return false;
            seen[cover] = true;
            return true;
          })
          .slice(0, 3);
        if (!covers.length) throw new Error("没有获取到测试封面");
        this.globalData.treeMockCovers = covers;
        return new Promise((resolve, reject) => {
          wx.reLaunch({
            url,
            success: resolve,
            fail: reject
          });
        });
      })
      .catch((error) => {
        console.error("openTreeMock failed", error);
        wx.showToast({
          title: String((error && error.message) || "Mock 页面打开失败").slice(0, 18),
          icon: "none"
        });
        throw error;
      })
      .finally(() => wx.hideLoading());
  },
});
