const { artists } = require("../../data/artists");
const { searchArtists, searchAlbumsByQuery, searchSongs } = require("../../utils/api");
const { readArtistCovers } = require("../../utils/itunesCache");
const {
  MAX_TARGET_COUNT,
  getTargetCountHint,
  getTargetCountStartText,
  isValidTargetCount
} = require("../../utils/targetCount");

function getAlbumTargetCount(mode) {
  if (mode === "album") return MAX_TARGET_COUNT;
  if (mode !== "themeAlbum") return 9;
  const app = getApp();
  return Number(app.globalData.draftThemeAlbumTarget || (app.globalData.draftThemePrompts || []).length || 9);
}

function getThemeAlbumDoneText() {
  return getApp().globalData.draftThemeTemplate === "heart"
    ? "完成：生成心形专辑挑战"
    : "完成：组成我的人生九专";
}

function normalizeArtistName(value) {
  const variants = {
    "張": "张",
    "陳": "陈",
    "劉": "刘",
    "鄧": "邓",
    "楊": "杨",
    "蕭": "萧",
    "謝": "谢",
    "鄭": "郑",
    "趙": "赵",
    "羅": "罗",
    "盧": "卢",
    "齊": "齐",
    "蘇": "苏",
    "譚": "谭",
    "黃": "黄",
    "吳": "吴",
    "藍": "蓝",
    "竇": "窦",
    "傑": "杰",
    "倫": "伦",
    "華": "华",
    "國": "国",
    "榮": "荣",
    "龍": "龙",
    "風": "风",
    "櫻": "樱",
    "體": "体",
    "髮": "发",
    "愛": "爱",
    "寶": "宝",
    "貝": "贝",
    "懸": "悬",
    "無": "无",
    "裏": "里",
    "裡": "里"
  };
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[張陳劉鄧楊蕭謝鄭趙羅盧齊蘇譚黃吳藍竇傑倫華國榮龍風櫻體髮愛寶貝懸無裏裡]/g, (char) => variants[char] || char)
    .replace(/[\s·・.。'’`"“”\-_/\\()（）[\]【】:：,，]+/g, "");
}

function getArtistDedupeNames(artist) {
  return [
    artist && artist.name,
    artist && artist.artistName,
    artist && artist.searchTerm,
    artist && artist.resolvedArtistName,
    artist && artist.itunesArtistName
  ].map(normalizeArtistName).filter(Boolean);
}

function emptyAvatarStats() {
  return {
    visible: 0,
    static: 0,
    pendingCacheRead: 0,
    skippedCacheRead: 0,
    localCache: 0,
    cloudCache: 0,
    missCache: 0,
    itunesFallback: 0,
    itunesSuccess: 0,
    itunesEmpty: 0,
    error: 0
  };
}

function stableLogSignature(payload) {
  if (payload === null || typeof payload !== "object") return JSON.stringify(payload);
  if (Array.isArray(payload)) return `[${payload.map(stableLogSignature).join(",")}]`;
  return `{${Object.keys(payload).sort().map((key) => `${JSON.stringify(key)}:${stableLogSignature(payload[key])}`).join(",")}}`;
}

function mergeAvatarStats(target, source) {
  const next = target || emptyAvatarStats();
  const incoming = source || emptyAvatarStats();
  Object.keys(next).forEach((key) => {
    if (key === "visible" || key === "static") {
      next[key] = Math.max(Number(next[key] || 0), Number(incoming[key] || 0));
      return;
    }
    next[key] = Number(next[key] || 0) + Number(incoming[key] || 0);
  });
  return next;
}

function getAvatarStatsDelta(stats) {
  const previous = stats._loggedSnapshot || emptyAvatarStats();
  const delta = emptyAvatarStats();
  Object.keys(delta).forEach((key) => {
    const currentValue = Number(stats[key] || 0);
    const previousValue = Number(previous[key] || 0);
    delta[key] = key === "visible" || key === "static"
      ? currentValue
      : Math.max(0, currentValue - previousValue);
  });
  stats._loggedSnapshot = { ...stats };
  return delta;
}

Page({
  data: {
    mode: "artist",
    role: "creator",
    challengeId: "",
    colorId: "",
    slotId: "",
    query: "",
    browsingLetter: false,
    selected: [],
    albumCount: 0,
    activeLetter: "C",
    letters: [],
    letterItems: [],
    localArtists: artists,
    remoteArtists: [],
    remoteAlbums: [],
    visibleArtists: artists,
    visibleAlbums: [],
    visibleArtistResults: [],
    showSearchSections: false,
    loading: false,
    canNext: false,
    isAlbumMode: false,
    albumTargetCount: 9,
    themeAlbumDoneText: "完成：组成我的人生九专",
    titleText: "",
    targetCount: 9,
    targetHint: "",
    nextButtonText: "下一步"
  },

  onLoad(options = {}) {
    const mode = options.mode || getApp().globalData.draftMode || "artist";
    const app = getApp();
    const challengeId = options.challengeId
      ? decodeURIComponent(options.challengeId)
      : ((app.globalData.challenge || {}).challengeId || "");
    app.globalData.draftMode = mode;
    const isAlbumMode = mode === "album" || mode === "themeAlbum";
    const albumTargetCount = getAlbumTargetCount(mode);
    const topArtist = app.globalData.draftTopArtist;
    const colorId = options.colorId || app.globalData.currentColorId || "";
    const colorArtist = colorId ? ((app.globalData.draftColorArtists || {})[colorId] || app.globalData.currentColorArtist) : null;
    const slotId = options.slotId || (mode === "qa" ? app.globalData.currentQaSlotId : app.globalData.currentThemeSlotId) || "";
    const themeArtist = slotId ? ((app.globalData.draftThemeArtists || {})[slotId] || app.globalData.currentThemeSlotArtist) : null;
    const qaArtist = slotId ? ((app.globalData.draftQaArtists || {})[slotId] || app.globalData.currentQaSlotArtist) : null;
    const lyricsArtist = mode === "lyrics" ? app.globalData.lyricsShareArtist : null;
    const letters = this.buildLetters(this.data.localArtists);
    this.setData({
      mode,
      role: options.role || "creator",
      challengeId,
      colorId,
      slotId,
      selected: mode === "top9" && topArtist ? [topArtist] : (mode === "color" && colorArtist ? [colorArtist] : (mode === "theme" && themeArtist ? [themeArtist] : (mode === "qa" && qaArtist ? [qaArtist] : (mode === "lyrics" && lyricsArtist ? [lyricsArtist] : [])))),
      albumCount: (app.globalData.draftAlbums || []).length,
      isAlbumMode,
      albumTargetCount,
      themeAlbumDoneText: getThemeAlbumDoneText(),
      letters,
      activeLetter: letters.includes("C") ? "C" : letters[0]
    }, () => this.renderArtists());
  },

  onShow() {
    const albumCount = (getApp().globalData.draftAlbums || []).length;
    const albumTargetCount = getAlbumTargetCount(this.data.mode);
    this.setData({
      albumCount,
      albumTargetCount,
      canNext: this.data.isAlbumMode ? this.canUseAlbumCount(albumCount) : this.data.canNext
    }, () => {
      if (this.data.isAlbumMode) this.renderArtists();
    });
  },

  onSearchInput(event) {
    const query = event.detail.value || "";
    const keyword = query.trim();
    this.setData({ query, browsingLetter: false });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.searchRemote(keyword), 360);
    this.renderArtists();
  },

  setLetter(event) {
    const letter = event.currentTarget.dataset.letter;
    this.setData({
      activeLetter: letter,
      browsingLetter: Boolean(String(this.data.query || "").trim())
    }, () => this.renderArtists());
  },

  searchRemote(query) {
    if (!query) {
      this.setData({ remoteArtists: [], remoteAlbums: [], loading: false }, () => this.renderArtists());
      return;
    }

    this.setData({ loading: true });
    const artistRequest = searchArtists(query).catch(() => ({ artists: [] }));
    const albumRequest = this.data.isAlbumMode
      ? searchAlbumsByQuery(query).catch(() => ({ albums: [] }))
      : Promise.resolve({ albums: [] });

    Promise.all([artistRequest, albumRequest])
      .then(([artistRes, albumRes]) => {
        this.setData({
          remoteArtists: artistRes.artists || [],
          remoteAlbums: this.data.isAlbumMode ? ((albumRes && albumRes.albums) || []) : []
        }, () => this.renderArtists());
        this.logSearchCacheStats(query, artistRes, albumRes);
      })
      .catch(() => {
        wx.showToast({ title: this.data.isAlbumMode ? "搜索失败" : "歌手搜索失败", icon: "none" });
      })
      .finally(() => this.setData({ loading: false }));
  },

  logSearchCacheStats(query, artistRes, albumRes) {
    if (typeof console === "undefined" || !console.log) return;
    const payload = {
      mode: this.data.mode,
      query,
      artistListSource: (artistRes && artistRes._cacheSource) || "unknown",
      artistCount: ((artistRes && artistRes.artists) || []).length,
      albumListSource: this.data.isAlbumMode ? ((albumRes && albumRes._cacheSource) || "unknown") : "disabled",
      albumCount: this.data.isAlbumMode ? (((albumRes && albumRes.albums) || []).length) : 0
    };
    const signature = stableLogSignature(payload);
    if (this.lastSearchCacheStatsSignature === signature) return;
    this.lastSearchCacheStatsSignature = signature;
    console.log("[artist-search-cache-stats]", payload);
  },

  renderArtists() {
    const { query, activeLetter, browsingLetter, selected, localArtists, remoteArtists, remoteAlbums } = this.data;
    const keyword = String(query || "").trim();
    const lowerKeyword = keyword.toLowerCase();
    const selectedAlbums = getApp().globalData.draftAlbums || [];
    const selectedMap = selected.reduce((map, item) => {
      map[item.id] = true;
      return map;
    }, {});
    const selectedAlbumMap = selectedAlbums.reduce((map, item) => {
      map[item.id] = true;
      return map;
    }, {});

    const localMatchedArtists = localArtists.filter((item) => (
        item.name.includes(keyword) ||
        String(item.searchTerm || "").toLowerCase().includes(lowerKeyword)
      ));
    const localMatchedNameMap = localMatchedArtists.reduce((map, item) => {
      getArtistDedupeNames(item).forEach((name) => {
        map[name] = true;
      });
      return map;
    }, {});
    const searchedArtists = [
      ...localMatchedArtists.map((item) => ({ ...item, type: "artist" })),
      ...remoteArtists
        .filter((remote) => !getArtistDedupeNames(remote).some((name) => localMatchedNameMap[name]))
        .map((item) => ({ ...item, type: "artist" }))
    ];
    const searchedAlbums = remoteAlbums.map((item) => ({ ...item, type: "album" }));
    const searchBase = this.data.isAlbumMode
      ? [...searchedAlbums, ...searchedArtists]
      : searchedArtists;
    const shouldShowLetterArtists = !keyword || browsingLetter;
    const base = shouldShowLetterArtists
      ? localArtists.filter((item) => item.initial === activeLetter).map((item) => ({ ...item, type: "artist" }))
      : searchBase;

    const decorateItem = (item) => ({
        ...item,
        avatar: item.name ? item.name.slice(0, 1) : "?",
        avatarUrl: item.type === "album" ? item.cover : (item.avatarUrl || ""),
        meta: item.type === "album" ? `${item.artistName || ""}${item.year ? ` · ${item.year}` : ""}` : "",
        selectedClass: item.type === "album" ? (selectedAlbumMap[item.id] ? "selected" : "") : (selectedMap[item.id] ? "selected" : "")
      });
    const visibleArtists = base.map(decorateItem);
    const showSearchSections = this.data.isAlbumMode && keyword && !browsingLetter;
    const visibleAlbums = showSearchSections ? searchedAlbums.map(decorateItem) : [];
    const visibleArtistResults = showSearchSections ? searchedArtists.map(decorateItem) : [];

    const isSingleArtistMode = this.data.mode === "top9" || this.data.mode === "color" || this.data.mode === "theme" || this.data.mode === "qa" || this.data.mode === "lyrics";
    const selectedCount = this.data.isAlbumMode ? this.data.albumCount : selected.length;
    const targetCount = this.data.isAlbumMode
      ? this.data.albumTargetCount
      : (isSingleArtistMode ? 1 : MAX_TARGET_COUNT);
    const canNext = this.data.isAlbumMode
      ? this.canUseAlbumCount(this.data.albumCount)
      : (isSingleArtistMode ? selected.length === 1 : isValidTargetCount(selected.length));
    const titleText = this.data.isAlbumMode
      ? "选择几张专辑"
      : (targetCount === 1 ? "选择 1 位歌手" : "选择几位歌手");
    const targetHint = this.data.isAlbumMode
      ? (this.data.mode === "themeAlbum" ? "" : getTargetCountHint(selectedCount, "张"))
      : (isSingleArtistMode ? "" : getTargetCountHint(selected.length, "位"));
    const nextButtonText = this.data.isAlbumMode
      ? (this.data.mode === "themeAlbum" ? this.data.themeAlbumDoneText : getTargetCountStartText(selectedCount, "张", "专辑"))
        : (this.data.mode === "top9" ? "下一步：选择 Top 歌曲"
          : (this.data.mode === "color" ? "下一步：为这个颜色选歌"
            : (this.data.mode === "qa" ? "下一步：为这个问题选歌"
              : (this.data.mode === "theme" ? "下一步：为这个题目选歌"
                : (this.data.mode === "lyrics" ? "下一步：选择歌曲"
                  : getTargetCountStartText(selected.length, "位", "歌手"))))));
    this.setData({
      visibleArtists,
      visibleAlbums,
      visibleArtistResults,
      showSearchSections,
      canNext,
      titleText,
      targetCount,
      targetHint,
      nextButtonText,
      letterItems: this.data.letters.map((key) => ({
        key,
        activeClass: key === activeLetter && shouldShowLetterArtists ? "active" : ""
      }))
    }, () => this.loadVisibleArtistAvatars(showSearchSections ? visibleArtistResults : visibleArtists));
  },

  getItemInitial(item) {
    const initial = String((item && item.initial) || "").toUpperCase();
    if (/^[A-Z]$/.test(initial)) return initial;

    const source = String((item && (item.searchTerm || item.artistName || item.name)) || "").trim();
    const letter = source.slice(0, 1).toUpperCase();
    return /^[A-Z]$/.test(letter) ? letter : "";
  },

  buildLetters(list) {
    return list
      .map((item) => item.initial)
      .filter((initial, index, source) => initial && source.indexOf(initial) === index)
      .sort((a, b) => a.localeCompare(b));
  },

  loadVisibleArtistAvatars(visibleArtists) {
    if (!this.avatarRequests) this.avatarRequests = {};
    if (!this.avatarCacheReads) this.avatarCacheReads = {};

    const stats = emptyAvatarStats();
    const nonAlbumArtists = (visibleArtists || []).filter((artist) => artist.type !== "album");
    stats.visible = nonAlbumArtists.length;
    stats.static = nonAlbumArtists.filter((artist) => artist.avatarUrl).length;
    const candidates = (visibleArtists || [])
      .filter((artist) => artist.type !== "album" && !artist.avatarUrl);
    const unread = candidates.filter((artist) => {
      const key = this.getArtistRequestKey(artist);
      if (this.avatarCacheReads[key]) {
        stats.skippedCacheRead += 1;
        return false;
      }
      this.avatarCacheReads[key] = true;
      stats.pendingCacheRead += 1;
      return true;
    });

    if (!unread.length) {
      this.loadMissingArtistAvatars(candidates, stats);
      this.logAvatarStats(stats);
      return;
    }

    readArtistCovers(unread)
      .then((coverMap) => {
        const hits = unread.filter((artist) => coverMap[artist.id] && !coverMap[artist.id]._miss);
        const misses = unread.filter((artist) => !coverMap[artist.id]);
        unread.forEach((artist) => {
          const cover = coverMap[artist.id];
          if (!cover) return;
          if (cover._source === "local") stats.localCache += 1;
          else if (cover._source === "cloud") stats.cloudCache += 1;
          else if (cover._source === "miss") stats.missCache += 1;
        });
        if (!hits.length) {
          this.loadMissingArtistAvatars(misses, stats);
          this.logAvatarStats(stats);
          return;
        }

        this.applyArtistCoverMap(hits, coverMap, () => {
          this.loadMissingArtistAvatars(misses, stats);
          this.logAvatarStats(stats);
        });
      })
      .catch(() => {
        stats.error += unread.length;
        this.loadMissingArtistAvatars(unread, stats);
        this.logAvatarStats(stats);
      });
  },

  getArtistRequestKey(artist) {
    return String(
      (artist && (artist.itunesArtistId || artist.artistId || artist.searchTerm || artist.name || artist.id)) || ""
    );
  },

  applyArtistCoverMap(artistsWithCover, coverMap, callback) {
    const byId = {};
    (artistsWithCover || []).forEach((artist) => {
      if (artist && coverMap[artist.id]) byId[artist.id] = coverMap[artist.id];
    });

    const patch = (item) => {
      const cover = item && byId[item.id];
      const avatarUrl = cover && (cover.avatarUrl || cover.coverUrl);
      if (!avatarUrl) return item;
      return {
        ...item,
        avatarUrl,
        artistId: item.artistId || cover.artistId || "",
        itunesArtistId: item.itunesArtistId || cover.artistId || "",
        trustedArtistId: item.trustedArtistId || cover.trustedArtistId || Boolean(cover.resolvedArtistName || cover.itunesArtistName),
        resolvedArtistName: item.resolvedArtistName || cover.resolvedArtistName || cover.itunesArtistName || "",
        sourceCollectionId: item.sourceCollectionId || cover.sourceCollectionId || "",
        sourceCollectionName: item.sourceCollectionName || cover.sourceCollectionName || ""
      };
    };

    this.setData({
      localArtists: this.data.localArtists.map(patch),
      remoteArtists: this.data.remoteArtists.map(patch),
      selected: this.data.selected.map(patch)
    }, () => {
      this.renderArtists();
      if (callback) callback();
    });
  },

  loadMissingArtistAvatars(artistsToLoad, stats) {
    (artistsToLoad || [])
      .filter((artist) => !artist.avatarUrl && !this.avatarRequests[this.getArtistRequestKey(artist)])
      .forEach((artist) => {
        const requestKey = this.getArtistRequestKey(artist);
        this.avatarRequests[requestKey] = true;
        if (stats) stats.itunesFallback += 1;
        searchSongs(artist, "")
          .then((res) => {
            const song = (res.songs || []).find((item) => item.cover);
            if (!song || !song.cover) {
              if (stats) stats.itunesEmpty += 1;
              this.logAvatarStats(stats);
              return;
            }
            if (stats) stats.itunesSuccess += 1;

            this.applyArtistCoverMap([artist], {
              [artist.id]: {
                avatarUrl: song.cover,
                coverUrl: song.cover,
                artistId: res.artistId || song.artistId || "",
                trustedArtistId: Boolean(res.artistId),
                resolvedArtistName: res.artistName || "",
                sourceCollectionId: song.collectionId || "",
                sourceCollectionName: song.collectionName || song.album || ""
              }
            }, () => this.logAvatarStats(stats));
          })
          .catch(() => {
            if (stats) stats.error += 1;
            this.logAvatarStats(stats);
          });
      });
  },

  logAvatarStats(stats) {
    if (!stats || typeof console === "undefined" || !console.log) return;
    this.pendingAvatarStats = mergeAvatarStats(this.pendingAvatarStats, getAvatarStatsDelta(stats));
    clearTimeout(this.avatarStatsTimer);
    this.avatarStatsTimer = setTimeout(() => {
      const pending = this.pendingAvatarStats || emptyAvatarStats();
      this.pendingAvatarStats = null;
      const payload = {
        mode: this.data.mode,
        query: this.data.query || "",
        letter: this.data.activeLetter || "",
        visible: pending.visible,
        static: pending.static,
        localCache: pending.localCache,
        cloudCache: pending.cloudCache,
        missCache: pending.missCache,
        avatarSearchRequests: pending.itunesFallback,
        itunesSuccess: pending.itunesSuccess,
        itunesEmpty: pending.itunesEmpty,
        pendingCacheRead: pending.pendingCacheRead,
        skippedCacheRead: pending.skippedCacheRead,
        error: pending.error
      };
      const signature = stableLogSignature(payload);
      if (this.lastAvatarStatsSignature === signature) return;
      this.lastAvatarStatsSignature = signature;
      console.log("[artist-avatar-stats]", payload);
    }, 500);
  },

  toggleArtist(event) {
    const id = event.currentTarget.dataset.id;
    const type = event.currentTarget.dataset.type || "artist";
    if (type === "album") {
      this.toggleAlbum(id);
      return;
    }

    const all = [...this.data.localArtists, ...this.data.remoteArtists];
    const artist = all.find((item) => item.id === id);
    if (this.data.isAlbumMode) {
      if (!artist) return;
      getApp().globalData.currentAlbumArtist = artist;
      wx.navigateTo({ url: `/pages/albums/albums?artistId=${encodeURIComponent(id)}&mode=${this.data.mode}` });
      return;
    }

    if (this.data.mode === "top9") {
      const selected = this.data.selected.some((item) => item.id === id) ? [] : (artist ? [artist] : []);
      getApp().globalData.draftTopArtist = selected[0] || null;
      this.setData({ selected }, () => this.renderArtists());
      return;
    }

    if (this.data.mode === "color") {
      const selected = this.data.selected.some((item) => item.id === id) ? [] : (artist ? [artist] : []);
      this.setData({ selected }, () => this.renderArtists());
      return;
    }

    if (this.data.mode === "theme") {
      const selected = this.data.selected.some((item) => item.id === id) ? [] : (artist ? [artist] : []);
      this.setData({ selected }, () => this.renderArtists());
      return;
    }

    if (this.data.mode === "qa") {
      const selected = this.data.selected.some((item) => item.id === id) ? [] : (artist ? [artist] : []);
      this.setData({ selected }, () => this.renderArtists());
      return;
    }

    if (this.data.mode === "lyrics") {
      const selected = this.data.selected.some((item) => item.id === id) ? [] : (artist ? [artist] : []);
      this.setData({ selected }, () => this.renderArtists());
      return;
    }

    let selected = [...this.data.selected];

    if (selected.some((item) => item.id === id)) {
      selected = selected.filter((item) => item.id !== id);
    } else if (selected.length < MAX_TARGET_COUNT && artist) {
      selected.push(artist);
    } else if (artist) {
      wx.showToast({ title: `最多选择 ${MAX_TARGET_COUNT} 位歌手`, icon: "none" });
    }

    this.setData({ selected }, () => this.renderArtists());
  },

  toggleAlbum(id) {
    const album = this.data.remoteAlbums.find((item) => item.id === id);
    if (!album) return;

    let selected = [...(getApp().globalData.draftAlbums || [])];
    if (selected.some((item) => item.id === id)) {
      selected = selected.filter((item) => item.id !== id);
    } else if (selected.length < this.data.albumTargetCount) {
      selected.push(album);
    } else {
      wx.showToast({ title: `最多选择 ${this.data.albumTargetCount} 张专辑`, icon: "none" });
      return;
    }

    getApp().globalData.draftAlbums = selected;
    this.setData({
      albumCount: selected.length,
      canNext: this.canUseAlbumCount(selected.length)
    }, () => this.renderArtists());
  },

  canUseAlbumCount(count) {
    return this.data.mode === "themeAlbum"
      ? Number(count || 0) === this.data.albumTargetCount
      : isValidTargetCount(count);
  },

  next() {
    if (this.data.mode === "qa") {
      if (this.data.selected.length !== 1) {
        wx.showToast({ title: "请选择 1 位歌手", icon: "none" });
        return;
      }
      const app = getApp();
      const artist = this.data.selected[0];
      app.globalData.currentQaSlotId = this.data.slotId;
      app.globalData.currentQaSlotArtist = artist;
      app.globalData.draftQaArtists = {
        ...(app.globalData.draftQaArtists || {}),
        [this.data.slotId]: artist
      };
      wx.redirectTo({ url: `/pages/songs/songs?role=${this.data.role}&mode=qa&slotId=${this.data.slotId}&challengeId=${encodeURIComponent(this.data.challengeId || "")}` });
      return;
    }

    if (this.data.mode === "theme") {
      if (this.data.selected.length !== 1) {
        wx.showToast({ title: "请选择 1 位歌手", icon: "none" });
        return;
      }
      const app = getApp();
      const artist = this.data.selected[0];
      app.globalData.currentThemeSlotId = this.data.slotId;
      app.globalData.currentThemeSlotArtist = artist;
      app.globalData.draftThemeArtists = {
        ...(app.globalData.draftThemeArtists || {}),
        [this.data.slotId]: artist
      };
      wx.redirectTo({ url: `/pages/songs/songs?role=${this.data.role}&mode=theme&slotId=${this.data.slotId}` });
      return;
    }

    if (this.data.mode === "color") {
      if (this.data.selected.length !== 1) {
        wx.showToast({ title: "请选择 1 位歌手", icon: "none" });
        return;
      }
      const app = getApp();
      const artist = this.data.selected[0];
      app.globalData.currentColorId = this.data.colorId;
      app.globalData.currentColorArtist = artist;
      app.globalData.draftColorArtists = {
        ...(app.globalData.draftColorArtists || {}),
        [this.data.colorId]: artist
      };
      wx.redirectTo({ url: `/pages/songs/songs?role=${this.data.role}&mode=color&colorId=${this.data.colorId}&challengeId=${encodeURIComponent(this.data.challengeId || "")}` });
      return;
    }

    if (this.data.mode === "top9") {
      if (this.data.selected.length !== 1) {
        wx.showToast({ title: "请选择 1 位歌手", icon: "none" });
        return;
      }
      const app = getApp();
      app.globalData.draftTopArtist = this.data.selected[0];
      app.globalData.draftMode = "top9";
      app.globalData.draftTargetCount = 9;
      app.globalData.creatorTopSongs = [];
      wx.navigateTo({ url: "/pages/songs/songs?role=creator&mode=top9" });
      return;
    }

    if (this.data.mode === "lyrics") {
      if (this.data.selected.length !== 1) {
        wx.showToast({ title: "请选择 1 位歌手", icon: "none" });
        return;
      }
      const app = getApp();
      app.globalData.draftMode = "lyrics";
      app.globalData.draftArtists = this.data.selected;
      app.globalData.lyricsShareArtist = this.data.selected[0];
      app.globalData.lyricsShareSong = null;
      app.globalData.lyricsShareSelectedLyrics = [];
      wx.navigateTo({ url: "/pages/songs/songs?role=creator&mode=lyrics" });
      return;
    }

    if (this.data.mode === "album") {
      const albumCount = (getApp().globalData.draftAlbums || []).length;
      if (!isValidTargetCount(albumCount)) {
        wx.showToast({ title: `请选择 3、6、9、12、15 或 ${MAX_TARGET_COUNT} 张专辑`, icon: "none" });
        return;
      }
      getApp().globalData.draftTargetCount = albumCount;
      getApp().globalData.creatorChoices = {};
      wx.navigateTo({ url: "/pages/songs/songs?role=creator&mode=album" });
      return;
    }

    if (this.data.mode === "themeAlbum") {
      if ((getApp().globalData.draftAlbums || []).length !== this.data.albumTargetCount) {
        wx.showToast({ title: `请选择 ${this.data.albumTargetCount} 张专辑`, icon: "none" });
        return;
      }
      const app = getApp();
      app.globalData.draftMode = "theme";
      wx.navigateBack();
      return;
    }

    if (!isValidTargetCount(this.data.selected.length)) {
      wx.showToast({ title: `请选择 3、6、9、12、15 或 ${MAX_TARGET_COUNT} 位歌手`, icon: "none" });
      return;
    }
    getApp().globalData.draftArtists = this.data.selected;
    getApp().globalData.draftMode = "artist";
    getApp().globalData.draftTargetCount = this.data.selected.length;
    getApp().globalData.creatorChoices = {};
    wx.navigateTo({ url: "/pages/songs/songs?role=creator" });
  }
});
