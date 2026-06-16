const { searchAlbums } = require("../../utils/api");
const {
  MAX_TARGET_COUNT,
  getTargetCountHint,
  getTargetCountStartText,
  isValidTargetCount
} = require("../../utils/targetCount");

function albumSortTime(album) {
  const releaseDate = Date.parse(album.releaseDate || "");
  if (!Number.isNaN(releaseDate)) return releaseDate;
  const year = Number(album.year || 0);
  return year ? new Date(year, 0, 1).getTime() : 0;
}

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

function getThemeAlbumPickText() {
  return getApp().globalData.draftThemeTemplate === "heart"
    ? "正在为心形专辑挑战选专辑"
    : "正在为人生九专选专辑";
}

Page({
  data: {
    mode: "album",
    artist: {},
    albums: [],
    selected: [],
    targetCount: 9,
    themeAlbumDoneText: "完成：组成我的人生九专",
    themeAlbumPickText: "正在为人生九专选专辑",
    canNext: false,
    targetHint: "",
    nextButtonText: "下一步：每张专辑选 1 首",
    loading: false,
    showEmpty: false
  },

  onLoad(options = {}) {
    const app = getApp();
    const mode = options.mode || app.globalData.draftMode || "album";
    const targetCount = getAlbumTargetCount(mode);
    const artist = app.globalData.currentAlbumArtist || {};
    const selected = app.globalData.draftAlbums || [];
    this.setData({
      mode,
      targetCount,
      themeAlbumDoneText: getThemeAlbumDoneText(),
      themeAlbumPickText: getThemeAlbumPickText(),
      artist: {
        ...artist,
        avatar: artist.name ? artist.name.slice(0, 1) : "?"
      },
      selected,
      canNext: this.canUseCount(selected.length, targetCount, mode),
      targetHint: mode === "themeAlbum" ? "" : getTargetCountHint(selected.length, "张"),
      nextButtonText: mode === "themeAlbum" ? getThemeAlbumDoneText() : getTargetCountStartText(selected.length, "张", "专辑")
    }, () => this.loadAlbums());
  },

  loadAlbums() {
    if (!this.data.artist || !this.data.artist.name) return;
    this.setData({ loading: true, showEmpty: false });
    searchAlbums(this.data.artist, 200)
      .then((res) => {
        const selectedMap = this.data.selected.reduce((map, item) => {
          map[item.id] = true;
          return map;
        }, {});
        const albums = (res.albums || [])
          .slice()
          .sort((a, b) => albumSortTime(b) - albumSortTime(a))
          .map((item) => ({
            ...item,
            displayMeta: `${item.artistName || this.data.artist.name || ""}${item.year ? ` · ${item.year}` : ""}`,
            selectedClass: selectedMap[item.id] ? "selected" : ""
          }));
        this.setData({
          albums,
          showEmpty: albums.length === 0
        });
      })
      .catch(() => {
        wx.showToast({ title: "专辑搜索失败", icon: "none" });
      })
      .finally(() => this.setData({ loading: false }));
  },

  toggleAlbum(event) {
    const id = event.currentTarget.dataset.id;
    const album = this.data.albums.find((item) => item.id === id);
    if (!album) return;

    let selected = [...this.data.selected];
    if (selected.some((item) => item.id === id)) {
      selected = selected.filter((item) => item.id !== id);
    } else if (selected.length < this.data.targetCount) {
      selected.push(album);
    } else {
      wx.showToast({ title: `最多选择 ${this.data.targetCount} 张专辑`, icon: "none" });
      return;
    }

    getApp().globalData.draftAlbums = selected;
    this.setData({
      selected,
      canNext: this.canUseCount(selected.length, this.data.targetCount, this.data.mode),
      targetHint: this.data.mode === "themeAlbum" ? "" : getTargetCountHint(selected.length, "张"),
      nextButtonText: this.data.mode === "themeAlbum" ? this.data.themeAlbumDoneText : getTargetCountStartText(selected.length, "张", "专辑"),
      albums: this.data.albums.map((item) => ({
        ...item,
        selectedClass: selected.some((selectedAlbum) => selectedAlbum.id === item.id) ? "selected" : ""
      }))
    });
  },

  canUseCount(count, targetCount, mode) {
    return mode === "themeAlbum"
      ? Number(count || 0) === Number(targetCount || 0)
      : isValidTargetCount(count);
  },

  backToArtists() {
    wx.navigateBack();
  },

  next() {
    if (!this.canUseCount(this.data.selected.length, this.data.targetCount, this.data.mode)) return;
    const app = getApp();
    if (this.data.mode === "themeAlbum") {
      app.globalData.draftMode = "theme";
      wx.navigateBack({ delta: 2 });
      return;
    }
    app.globalData.draftMode = "album";
    app.globalData.draftTargetCount = this.data.selected.length;
    app.globalData.creatorChoices = {};
    wx.navigateTo({ url: "/pages/songs/songs?role=creator&mode=album" });
  }
});
