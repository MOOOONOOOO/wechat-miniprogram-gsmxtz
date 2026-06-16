const { searchSongs, searchAlbumSongs, createChallenge } = require("../../utils/api");
const { ensureChallenge, needsChallenge } = require("../../utils/challengeState");
const { readFriendDraft, saveFriendDraft } = require("../../utils/friendDraft");
const { saveCreatedChallenge } = require("../../utils/history");
const {
  creatorProfileGateData,
  creatorProfileGateMethods,
  prepareCreatorProfileForCreate
} = require("../../utils/creatorProfileGate");
const { getColorSubjects } = require("../../data/colors");
const {
  cacheDefaultSongList,
  readDefaultSongListWithTimeout
} = require("../../utils/itunesCache");
const {
  getNextValidTargetCount,
  getTargetCountStartText,
  getTargetCountFromChallenge,
  isValidTargetCount,
  normalizeTargetCount
} = require("../../utils/targetCount");

const SONG_LIST_CACHE_VERSION = 2;
const MIN_LEGACY_DEFAULT_SONGS = 24;

function truncateText(text, maxLength = 12) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength)}....` : value;
}

function cleanTopSong(song, index) {
  const {
    selectedClass,
    dragClass,
    ...rest
  } = song || {};
  return {
    ...rest,
    rank: index + 1
  };
}

function hasTopSongs(songs) {
  return Array.isArray(songs) && isValidTargetCount(songs.length);
}

function getTopNextLabel(role, count) {
  if (role !== "creator") return "下一步：排序 Top";
  return getTargetCountStartText(count, "首", "歌曲");
}

function buildScaledProgressDots(count, targetCount) {
  const total = Math.max(1, Number(targetCount || 0));
  const filled = Math.max(0, Math.min(total, Number(count || 0))) / total * 9;
  return Array.from({ length: 9 }).map((_, index) => ({
    id: `progress-${index + 1}`,
    doneClass: filled >= index + 1 ? "done" : (filled > index ? "half" : "")
  }));
}

function hasFreshDefaultSongCache(cacheRecord, mode) {
  if (!cacheRecord || !Array.isArray(cacheRecord.songs) || !cacheRecord.songs.length) return false;
  if (mode === "album") return true;
  return Number(cacheRecord.listVersion || 0) >= SONG_LIST_CACHE_VERSION || cacheRecord.songs.length >= MIN_LEGACY_DEFAULT_SONGS;
}

function normalizeSongKeyText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s·・.。'’`"“”\-_/\\()（）[\]【】:：,，]+/g, "");
}

function getSongKey(song) {
  if (!song) return "";
  const trackId = String(song.trackId || "").trim();
  if (trackId) return `id:${trackId}`;
  const artistName = normalizeSongKeyText(song.artistName || "");
  const songName = normalizeSongKeyText(song.name || song.trackName || "");
  return artistName || songName ? `name:${artistName}:${songName}` : "";
}

function normalizeLyricsSong(song = {}) {
  const duration = Number(song.duration || 0) || (song.trackTimeMillis ? Math.round(Number(song.trackTimeMillis) / 1000) : 0);
  return {
    ...song,
    trackName: song.trackName || song.name || "",
    name: song.name || song.trackName || "",
    artistName: song.artistName || "",
    album: song.album || song.collectionName || "",
    collectionName: song.collectionName || song.album || "",
    cover: song.cover || song.artworkUrl600 || song.artworkUrl100 || song.albumCover || "",
    duration,
    trackTimeMillis: song.trackTimeMillis || (duration ? duration * 1000 : 0)
  };
}

function getChoiceKeyForData(data) {
  if (data.mode === "color") return data.colorId;
  if (data.mode === "theme" || data.mode === "qa") return data.slotId;
  return (data.currentArtist || {}).id;
}

function stableInsertIndex(song, length) {
  if (!length) return 0;
  const seed = String((song && (song.trackId || song.name || song.trackName)) || "");
  const total = seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  if (length <= 3) return Math.min(length, 1);
  return 1 + (total % Math.min(length, 8));
}

function getChallengeTargetCount(mode, app, fallbackItems = []) {
  const challenge = app.globalData.challenge || {};
  if (mode === "lyrics") return 1;
  if (mode === "theme") return (app.globalData.draftThemePrompts || []).length || 9;
  if (mode === "qa") return (app.globalData.draftQaPrompts || []).length || 9;
  if (mode === "color") return (app.globalData.draftColors || getColorSubjects()).length || 9;
  if (mode === "top9") return getTargetCountFromChallenge(challenge, app.globalData.draftTargetCount || 9);
  if (mode === "artist" || mode === "album") {
    return normalizeTargetCount(app.globalData.draftTargetCount || getTargetCountFromChallenge(challenge, fallbackItems.length || 9), fallbackItems.length || 9);
  }
  return 9;
}

Page({
  data: {
    ...creatorProfileGateData,
    role: "creator",
    mode: "artist",
    challengeId: "",
    colorId: "",
    slotId: "",
    artists: [],
    currentIndex: 0,
    currentArtist: {},
    searchPlaceholder: "搜索这位歌手的歌曲",
    query: "",
    songs: [],
    loading: false,
    choices: {},
    topSongs: [],
    selectedTrackId: "",
    stepText: 1,
    targetCount: 9,
    canPrev: false,
    canProceed: false,
    nextLabel: "下一位",
    showEmpty: false,
    emptyText: "没有找到相关歌曲，换个关键词试试。",
    progressDots: []
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
    const mode = options.mode || app.globalData.draftMode || ((app.globalData.challenge || {}).mode) || "artist";
    const colorId = options.colorId || app.globalData.currentColorId || "";
    const slotId = options.slotId || (mode === "qa" ? app.globalData.currentQaSlotId : app.globalData.currentThemeSlotId) || "";
    const colorArtist = mode === "color" ? (app.globalData.currentColorArtist || ((app.globalData.draftColorArtists || {})[colorId])) : null;
    const themeArtist = mode === "theme" ? (app.globalData.currentThemeSlotArtist || ((app.globalData.draftThemeArtists || {})[slotId])) : null;
    const qaArtist = mode === "qa" ? (app.globalData.currentQaSlotArtist || ((app.globalData.draftQaArtists || {})[slotId])) : null;
    const lyricsArtist = mode === "lyrics" ? (app.globalData.lyricsShareArtist || (app.globalData.draftArtists || [])[0]) : null;
    const artists = mode === "album"
      ? (app.globalData.draftAlbums || [])
      : (mode === "top9"
          ? [app.globalData.draftTopArtist || (app.globalData.challenge || {}).topArtist].filter(Boolean)
          : (mode === "lyrics" ? [lyricsArtist].filter(Boolean) : (mode === "color" ? [colorArtist].filter(Boolean) : (mode === "theme" ? [themeArtist].filter(Boolean) : (mode === "qa" ? [qaArtist].filter(Boolean) : (app.globalData.draftArtists || []))))));
    const targetCount = getChallengeTargetCount(mode, app, artists);
    if (role === "friend" && challengeId) {
      const draft = readFriendDraft(challengeId);
      if (!Object.keys(app.globalData.friendChoices || {}).length && Object.keys(draft.friendChoices || {}).length) {
        app.globalData.friendChoices = draft.friendChoices;
      }
      if (!(app.globalData.friendTopSongs || []).length && Array.isArray(draft.friendTopSongs) && draft.friendTopSongs.length) {
        app.globalData.friendTopSongs = draft.friendTopSongs;
      }
      if (draft.friendProfile && (draft.friendProfile.nickName || draft.friendProfile.avatarUrl)) {
        app.globalData.friendProfile = draft.friendProfile;
      }
    }
    const choices = mode === "theme"
      ? (app.globalData.draftThemeChoices || {})
      : (role === "friend" ? app.globalData.friendChoices : app.globalData.creatorChoices);
    const topSongs = mode === "top9"
      ? (role === "friend" ? (app.globalData.friendTopSongs || []) : (app.globalData.creatorTopSongs || []))
      : [];

    app.globalData.draftMode = mode;
    if (mode === "color") {
      app.globalData.currentColorId = colorId;
    }
    if (mode === "theme") {
      app.globalData.currentThemeSlotId = slotId;
      app.globalData.draftThemeChoices = app.globalData.draftThemeChoices || {};
    }
    if (mode === "qa") {
      app.globalData.currentQaSlotId = slotId;
      if (role === "friend") app.globalData.friendChoices = app.globalData.friendChoices || {};
      else app.globalData.creatorChoices = app.globalData.creatorChoices || {};
    }
    if (mode === "color" && !(app.globalData.draftColors || []).length) {
      app.globalData.draftColors = getColorSubjects();
    }
    if (role === "creator") this.initCreatorProfileGate();
    this.setData({ role, mode, challengeId, artists, choices, topSongs, colorId, slotId, targetCount }, () => this.setCurrent(0));
  },

  ...creatorProfileGateMethods,

  onShow() {
    if (this.data.mode === "lyrics") {
      const selectedSong = getApp().globalData.lyricsShareSong || null;
      const selectedTrackId = selectedSong && selectedSong.trackId ? String(selectedSong.trackId) : "";
      this.setData({
        selectedTrackId,
        stepText: selectedSong ? 1 : 0,
        targetCount: 1,
        canProceed: Boolean(selectedSong),
        songs: this.data.songs.map((item) => ({
          ...item,
          selectedClass: selectedTrackId && String(item.trackId) === selectedTrackId ? "selected" : ""
        })),
        progressDots: buildScaledProgressDots(selectedSong ? 1 : 0, 1)
      });
      return;
    }
    if (this.data.mode !== "top9") return;
    const topSongs = getApp().globalData[this.data.role === "friend" ? "friendTopSongs" : "creatorTopSongs"] || [];
    const selectedMap = topSongs.reduce((map, song) => {
      if (song && song.trackId) map[song.trackId] = true;
      return map;
    }, {});
    this.setData({
      topSongs: topSongs.map(cleanTopSong),
      stepText: topSongs.length,
      targetCount: this.getTopTargetCount(topSongs.length),
      canProceed: this.canUseTopSongs(topSongs.length),
      nextLabel: getTopNextLabel(this.data.role, topSongs.length),
      songs: this.data.songs.map((item) => ({
        ...item,
        selectedClass: selectedMap[item.trackId] ? "selected" : ""
      })),
      progressDots: buildScaledProgressDots(topSongs.length, this.getTopTargetCount(topSongs.length))
    });
  },

  setCurrent(index) {
    const artist = this.data.artists[index];
    const currentArtist = {
      ...artist,
      avatar: artist && artist.name ? artist.name.slice(0, 1) : "?",
      avatarUrl: this.data.mode === "album" ? artist.cover : artist.avatarUrl,
      swatchStyle: this.data.mode === "color" ? `background:${artist.color};color:${artist.textColor};` : "",
      displayName: this.data.mode === "album" ? truncateText(artist.name, 12) : artist.name
    };
    const choiceKey = this.data.mode === "color" ? this.data.colorId : (this.data.mode === "theme" || this.data.mode === "qa" ? this.data.slotId : currentArtist.id);
    const selected = this.data.mode === "lyrics"
      ? (getApp().globalData.lyricsShareSong || null)
      : (this.data.mode === "top9" ? null : this.data.choices[choiceKey]);
    const selectedCount = Object.keys(this.data.choices || {}).length;
    const topTargetCount = this.getTopTargetCount(this.data.topSongs.length);
    const targetCount = this.data.mode === "top9"
      ? topTargetCount
      : getChallengeTargetCount(this.data.mode, getApp(), this.data.artists);
    const isLastSubject = index >= targetCount - 1;
    this.setData({
      currentIndex: index,
      currentArtist,
      searchPlaceholder: this.data.mode === "album" ? "搜索这张专辑里的歌曲" : "搜索这位歌手的歌曲",
      query: "",
      songs: [],
      selectedTrackId: selected ? selected.trackId : "",
      stepText: this.data.mode === "top9" ? this.data.topSongs.length : (this.data.mode === "lyrics" ? (selected ? 1 : 0) : (this.data.mode === "color" || this.data.mode === "theme" || this.data.mode === "qa" ? selectedCount : index + 1)),
      targetCount,
      canPrev: this.data.mode === "top9" || this.data.mode === "lyrics" ? false : index > 0,
      canProceed: this.data.mode === "top9" ? this.canUseTopSongs(this.data.topSongs.length) : Boolean(selected),
      nextLabel: this.data.mode === "top9" ? getTopNextLabel(this.data.role, this.data.topSongs.length) : (this.data.mode === "lyrics" ? "下一步：选择歌词" : (this.data.mode === "color" ? "回到颜色格" : (this.data.mode === "theme" ? "回到题目格" : (this.data.mode === "qa" ? "回到问答格" : (isLastSubject ? (this.data.role === "friend" ? "查看结果" : "创建挑战") : (this.data.mode === "album" ? "下一张" : "下一位")))))),
      showEmpty: false,
      emptyText: this.data.mode === "color" || this.data.mode === "theme" || this.data.mode === "qa" ? "没有找到这位歌手的歌曲，换个关键词试试。" : "没有找到相关歌曲，换个关键词试试。",
      progressDots: this.data.mode === "lyrics"
        ? buildScaledProgressDots(selected ? 1 : 0, 1)
        : (this.data.mode === "top9"
          ? buildScaledProgressDots(this.data.topSongs.length, topTargetCount)
          : this.buildProgressDots(this.data.mode === "color" ? (getApp().globalData.draftColors || getColorSubjects()) : (this.data.mode === "theme" ? (getApp().globalData.draftThemePrompts || []) : (this.data.mode === "qa" ? (getApp().globalData.draftQaPrompts || []) : this.data.artists)), this.data.choices, targetCount))
    }, () => {
      this.loadSongs();
    });
  },

  onSongSearch(event) {
    const query = event.detail.value || "";
    this.setData({
      query,
      songs: [],
      showEmpty: false,
      emptyText: "没有找到相关歌曲，换个关键词试试。"
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.loadSongs(), 360);
  },

  loadSongs() {
    const { currentArtist } = this.data;
    const query = String(this.data.query || "").trim();
    if (!currentArtist || !currentArtist.name) return;

    const requestId = (this.songRequestId || 0) + 1;
    this.songRequestId = requestId;
    this.setData({ loading: true });

    if (!query) {
      readDefaultSongListWithTimeout(currentArtist, this.data.mode, 250)
        .then((cacheRecord) => {
          if (this.songRequestId !== requestId) return;
          if (cacheRecord && Array.isArray(cacheRecord.songs) && cacheRecord.songs.length) {
            this.applySongs(cacheRecord.songs, requestId);
            this.patchCurrentArtistIdentity(cacheRecord);
            this.setData({ loading: false });
            if (hasFreshDefaultSongCache(cacheRecord, this.data.mode)) return;
          }
          this.fetchSongsFromItunes(currentArtist, query, requestId, true);
        });
      return;
    }

    this.fetchSongsFromItunes(currentArtist, query, requestId, false);
  },

  fetchSongsFromItunes(currentArtist, query, requestId, shouldCacheDefault) {
    const request = this.data.mode === "album"
      ? searchAlbumSongs(currentArtist.collectionId, query)
      : searchSongs(currentArtist, query);

    request
      .then((res) => {
        if (this.songRequestId !== requestId) return;
        const songs = res.songs || [];
        this.applySongs(songs, requestId);
        if (shouldCacheDefault) {
          const cacheSubject = this.data.mode === "album"
            ? currentArtist
            : {
                ...currentArtist,
                artistId: res.artistId || currentArtist.artistId || currentArtist.itunesArtistId || "",
                itunesArtistId: res.artistId || currentArtist.itunesArtistId || currentArtist.artistId || "",
                trustedArtistId: Boolean(res.artistId || currentArtist.trustedArtistId),
                resolvedArtistName: res.artistName || currentArtist.resolvedArtistName || ""
              };
          const record = cacheDefaultSongList(cacheSubject, this.data.mode, songs);
          this.patchCurrentArtistIdentity(record);
        }
      })
      .catch(() => {
        if (this.songRequestId !== requestId) return;
        wx.showToast({ title: "歌曲搜索失败", icon: "none" });
      })
      .finally(() => {
        if (this.songRequestId === requestId) this.setData({ loading: false });
      });
  },

  applySongs(rawSongs, requestId) {
    if (this.songRequestId !== requestId) return;
    const selectedTrackId = this.data.selectedTrackId;
    const topSelectedMap = this.data.topSongs.reduce((map, song) => {
      if (song && song.trackId) map[song.trackId] = true;
      return map;
    }, {});
    const visibleRawSongs = this.mixCreatorChoiceSong(rawSongs || []);
    const songs = visibleRawSongs.map((item) => ({
      ...item,
      selectedClass: this.data.mode === "top9" ? (topSelectedMap[item.trackId] ? "selected" : "") : (item.trackId === selectedTrackId ? "selected" : "")
    }));
    this.setData({
      songs,
      showEmpty: songs.length === 0
    });
  },

  mixCreatorChoiceSong(rawSongs) {
    if (this.data.role !== "friend" || this.data.mode === "top9") return rawSongs;
    const app = getApp();
    const choiceKey = getChoiceKeyForData(this.data);
    const creatorSong = ((app.globalData.creatorChoices || {})[choiceKey]) || null;
    if (!creatorSong || !creatorSong.trackId) return rawSongs;

    const seen = {};
    const songs = (rawSongs || []).filter((song) => {
      const key = getSongKey(song);
      if (!key) return true;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    const creatorKey = getSongKey(creatorSong);
    if (!creatorKey || seen[creatorKey]) return songs;

    const insertIndex = stableInsertIndex(creatorSong, songs.length);
    const mixed = songs.slice();
    mixed.splice(insertIndex, 0, {
      ...creatorSong,
      selectedClass: ""
    });
    return mixed;
  },

  patchCurrentArtistIdentity(record) {
    if (!record || !record.artistId || this.data.mode === "album") return;
    const artistId = String(record.artistId || "");
    const currentId = (this.data.currentArtist || {}).id;
    if (!artistId || !currentId) return;

    const patch = (artist) => (
      artist && artist.id === currentId
        ? {
            ...artist,
            artistId: artist.artistId || artistId,
            itunesArtistId: artist.itunesArtistId || artistId,
            trustedArtistId: true,
            resolvedArtistName: artist.resolvedArtistName || record.resolvedArtistName || record.itunesArtistName || ""
          }
        : artist
    );
    const artists = this.data.artists.map(patch);
    const currentArtist = patch(this.data.currentArtist);
    const app = getApp();
    if (this.data.mode === "artist") {
      app.globalData.draftArtists = (app.globalData.draftArtists || []).map(patch);
    } else if (this.data.mode === "top9") {
      app.globalData.draftTopArtist = currentArtist;
    } else if (this.data.mode === "color") {
      app.globalData.currentColorArtist = currentArtist;
      app.globalData.draftColorArtists = {
        ...(app.globalData.draftColorArtists || {}),
        [this.data.colorId]: currentArtist
      };
    } else if (this.data.mode === "qa") {
      app.globalData.currentQaSlotArtist = currentArtist;
      app.globalData.draftQaArtists = {
        ...(app.globalData.draftQaArtists || {}),
        [this.data.slotId]: currentArtist
      };
    } else if (this.data.mode === "lyrics") {
      app.globalData.lyricsShareArtist = currentArtist;
      app.globalData.draftArtists = (app.globalData.draftArtists || []).map(patch);
    }
    this.setData({ artists, currentArtist });
  },

  selectSong(event) {
    const trackId = event.currentTarget.dataset.trackId;
    const song = this.data.songs.find((item) => item.trackId === trackId);
    if (!song) return;

    if (this.data.mode === "top9") {
      this.toggleTopSong(song);
      return;
    }

    if (this.data.mode === "lyrics") {
      const selectedSong = normalizeLyricsSong(song);
      const app = getApp();
      app.globalData.lyricsShareArtist = this.data.currentArtist;
      app.globalData.lyricsShareSong = selectedSong;
      app.globalData.lyricsShareSelectedLyrics = [];
      this.setData({
        selectedTrackId: String(trackId),
        stepText: 1,
        canProceed: true,
        progressDots: buildScaledProgressDots(1, 1),
        songs: this.data.songs.map((item) => ({
          ...item,
          selectedClass: String(item.trackId) === String(trackId) ? "selected" : ""
        }))
      });
      wx.navigateTo({ url: "/pages/lyrics-select/lyrics-select" });
      return;
    }

    const choices = {
      ...this.data.choices,
      [this.data.mode === "color" ? this.data.colorId : (this.data.mode === "theme" || this.data.mode === "qa" ? this.data.slotId : this.data.currentArtist.id)]: song
    };
    const app = getApp();
    if (this.data.mode === "theme") app.globalData.draftThemeChoices = choices;
    else if (this.data.role === "friend") {
      app.globalData.friendChoices = choices;
      saveFriendDraft(this.data.challengeId || (app.globalData.challenge || {}).challengeId || "", {
        friendChoices: choices,
        friendProfile: app.globalData.friendProfile || wx.getStorageSync(`friendProfile:${this.data.challengeId}`) || {}
      });
    } else app.globalData.creatorChoices = choices;

    if (this.data.mode === "color" || this.data.mode === "theme" || this.data.mode === "qa") {
      this.setData({ choices, selectedTrackId: trackId });
      wx.navigateBack();
      return;
    }

    this.setData({
      choices,
      selectedTrackId: trackId,
      canProceed: true,
      progressDots: this.buildProgressDots(this.data.artists, choices),
      songs: this.data.songs.map((item) => ({
        ...item,
        selectedClass: item.trackId === trackId ? "selected" : ""
      }))
    });
  },

  toggleTopSong(song) {
    const exists = this.data.topSongs.some((item) => item.trackId === song.trackId);
    let topSongs = exists
      ? this.data.topSongs.filter((item) => item.trackId !== song.trackId)
      : [...this.data.topSongs, song];
    const maxCount = this.data.role === "friend" ? this.getTopTargetCount(topSongs.length) : 18;
    if (!exists && topSongs.length > maxCount) {
      wx.showToast({ title: `最多选择 ${maxCount} 首歌`, icon: "none" });
      return;
    }
    topSongs = topSongs.map(cleanTopSong);
    this.persistTopSongs(topSongs);
  },

  removeTopSong(event) {
    const trackId = event.currentTarget.dataset.trackId;
    const topSongs = this.data.topSongs
      .filter((item) => item.trackId !== trackId)
      .map(cleanTopSong);
    this.persistTopSongs(topSongs);
  },

  decorateTopSongs(topSongs, dragTrackId = "", reflow = false) {
    return (topSongs || []).map((song, index) => {
      const trackId = song && song.trackId;
      const classes = [];
      if (dragTrackId && trackId === dragTrackId) classes.push("dragging");
      if (reflow && (!dragTrackId || trackId !== dragTrackId)) classes.push("reflowing");
      return {
        ...song,
        rank: index + 1,
        dragClass: classes.join(" ")
      };
    });
  },

  persistTopSongs(topSongs, options = {}) {
    const cleanSongs = (topSongs || []).map(cleanTopSong);
    const app = getApp();
    if (this.data.role === "friend") {
      app.globalData.friendTopSongs = cleanSongs;
      saveFriendDraft(this.data.challengeId || (app.globalData.challenge || {}).challengeId || "", {
        friendTopSongs: cleanSongs,
        friendProfile: app.globalData.friendProfile || wx.getStorageSync(`friendProfile:${this.data.challengeId}`) || {}
      });
    } else app.globalData.creatorTopSongs = cleanSongs;
    const selectedMap = cleanSongs.reduce((map, song) => {
      if (song && song.trackId) map[song.trackId] = true;
      return map;
    }, {});
    const dragTrackId = options.dragTrackId || ((this.dragState || {}).active ? this.dragState.trackId : "");
    const displaySongs = this.decorateTopSongs(cleanSongs, dragTrackId, Boolean(options.reflow));
    this.setData({
      topSongs: displaySongs,
      stepText: cleanSongs.length,
      targetCount: this.getTopTargetCount(cleanSongs.length),
      canProceed: this.canUseTopSongs(cleanSongs.length),
      nextLabel: getTopNextLabel(this.data.role, cleanSongs.length),
      songs: this.data.songs.map((item) => ({
        ...item,
        selectedClass: selectedMap[item.trackId] ? "selected" : ""
      })),
      progressDots: buildScaledProgressDots(cleanSongs.length, this.getTopTargetCount(cleanSongs.length))
    });

    if (options.reflow) {
      clearTimeout(this.reflowTimer);
      this.reflowTimer = setTimeout(() => {
        const activeTrackId = ((this.dragState || {}).active && (this.dragState || {}).trackId) || "";
        this.setData({
          topSongs: this.decorateTopSongs(this.data.topSongs.map(cleanTopSong), activeTrackId, false)
        });
      }, 180);
    }
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
      index,
      trackId: song.trackId,
      startY: touch.clientY,
      rowHeight: 112 * (info.windowWidth || 375) / 750
    };
    this.dragActivateTimer = setTimeout(() => this.activateTopSongDrag(), 180);
  },

  activateTopSongDrag() {
    if (!this.dragState || this.dragState.active) return;
    this.dragState.active = true;
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    this.setData({
      topSongs: this.decorateTopSongs(this.data.topSongs.map(cleanTopSong), this.dragState.trackId, false)
    });
  },

  onTopSongDragMove(event) {
    if (!this.dragState) return;
    const touch = (event.touches || [])[0];
    if (!touch) return;
    const delta = touch.clientY - this.dragState.startY;

    if (!this.dragState.active) {
      if (Math.abs(delta) > 14) {
        clearTimeout(this.dragActivateTimer);
        this.dragState = null;
      }
      return;
    }

    if (Math.abs(delta) < this.dragState.rowHeight * 0.45) return;

    const direction = delta > 0 ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(this.data.topSongs.length - 1, this.dragState.index + direction));
    if (nextIndex === this.dragState.index) return;
    const topSongs = this.data.topSongs.map(cleanTopSong);
    const [moved] = topSongs.splice(this.dragState.index, 1);
    topSongs.splice(nextIndex, 0, moved);
    this.dragState.index = nextIndex;
    this.dragState.startY += direction * this.dragState.rowHeight;
    this.persistTopSongs(topSongs.map(cleanTopSong), {
      dragTrackId: this.dragState.trackId,
      reflow: true
    });
  },

  onTopSongDragEnd() {
    clearTimeout(this.dragActivateTimer);
    const wasActive = this.dragState && this.dragState.active;
    this.dragState = null;
    if (wasActive) {
      this.setData({
        topSongs: this.decorateTopSongs(this.data.topSongs.map(cleanTopSong), "", false)
      });
    }
  },

  buildProgressDots(artists, choices, targetCount) {
    if (this.data.mode === "lyrics") {
      return buildScaledProgressDots(getApp().globalData.lyricsShareSong ? 1 : 0, 1);
    }
    if (this.data.mode === "artist" || this.data.mode === "album") {
      return buildScaledProgressDots(Object.keys(choices || {}).length, targetCount || (artists || []).length || 9);
    }
    return artists.map((artist) => ({
      id: artist.id,
      doneClass: choices[artist.id] ? "done" : ""
    }));
  },

  getTopTargetCount(count = this.data.topSongs.length) {
    if (this.data.role === "friend") {
      return normalizeTargetCount(this.data.targetCount || getTargetCountFromChallenge(getApp().globalData.challenge || {}, 9));
    }
    return isValidTargetCount(count)
      ? Number(count)
      : getNextValidTargetCount(count);
  },

  canUseTopSongs(count = this.data.topSongs.length) {
    if (this.data.role === "friend") return Number(count || 0) === this.getTopTargetCount(count);
    return isValidTargetCount(count);
  },

  prev() {
    if (this.data.currentIndex === 0) return;
    this.setCurrent(this.data.currentIndex - 1);
  },

  next() {
    if (this.data.mode === "lyrics") {
      if (!getApp().globalData.lyricsShareSong) {
        wx.showToast({ title: "先选一首歌", icon: "none" });
        return;
      }
      wx.navigateTo({ url: "/pages/lyrics-select/lyrics-select" });
      return;
    }

    if (this.data.mode === "theme") {
      wx.navigateBack();
      return;
    }

    if (this.data.mode === "qa") {
      wx.navigateBack();
      return;
    }

    if (this.data.mode === "color") {
      wx.navigateBack();
      return;
    }

    if (this.data.mode === "top9") {
      if (!this.canUseTopSongs(this.data.topSongs.length)) {
        const targetCount = this.getTopTargetCount(this.data.topSongs.length);
        wx.showToast({ title: `请选择 ${targetCount} 首歌`, icon: "none" });
        return;
      }
      getApp().globalData.draftTargetCount = this.getTopTargetCount(this.data.topSongs.length);
      wx.navigateTo({ url: `/pages/top9-sort/top9-sort?role=${this.data.role}&challengeId=${encodeURIComponent(this.data.challengeId || "")}` });
      return;
    }

    if (this.data.currentIndex < this.data.targetCount - 1) {
      this.setCurrent(this.data.currentIndex + 1);
      return;
    }

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
    const mode = app.globalData.draftMode || this.data.mode || "artist";
    const topArtist = app.globalData.draftTopArtist || this.data.currentArtist || this.data.artists[0] || null;
    const creatorTopSongs = (app.globalData.creatorTopSongs || []).length
      ? app.globalData.creatorTopSongs.map(cleanTopSong)
      : this.data.topSongs.map(cleanTopSong);
    if (mode === "top9") {
      app.globalData.draftTopArtist = topArtist;
      app.globalData.creatorTopSongs = creatorTopSongs;
    }
    prepareCreatorProfileForCreate(this)
      .then((creatorProfile) => createChallenge({
        mode,
        artists: app.globalData.draftArtists,
        albums: app.globalData.draftAlbums,
        topArtist,
        creatorChoices: app.globalData.creatorChoices,
        creatorTopSongs,
        targetCount: mode === "top9" ? creatorTopSongs.length : this.data.targetCount,
        creatorProfile
      }))
      .then((res) => {
        app.globalData.challenge = {
          challengeId: res.challengeId,
          mode,
          artists: app.globalData.draftArtists,
          albums: app.globalData.draftAlbums,
          topArtist,
          creatorChoices: app.globalData.creatorChoices,
          creatorTopSongs,
          targetCount: mode === "top9" ? creatorTopSongs.length : this.data.targetCount,
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
