const { getThemeTemplates } = require("../../data/themeTemplates");

function readThemeCoverConfig() {
  if (!wx.cloud) return Promise.resolve({});
  return wx.cloud.callFunction({
    name: "noticeHub",
    data: {
      action: "listThemeCovers"
    }
  }).then((res) => ((res.result || {}).covers || {})).catch(() => ({}));
}

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

function resolveThemeCoverUrls(covers) {
  const cloudIds = Object.keys(covers || {})
    .map((key) => covers[key])
    .filter(isCloudFileUrl);
  if (!cloudIds.length || !wx.cloud || !wx.cloud.getTempFileURL) {
    return Promise.resolve(covers || {});
  }

  return wx.cloud.getTempFileURL({
    fileList: cloudIds
  }).then((res) => {
    const tempMap = (res.fileList || []).reduce((map, item) => {
      if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
      return map;
    }, {});
    return Object.keys(covers || {}).reduce((map, key) => {
      map[key] = isCloudFileUrl(covers[key]) ? (tempMap[covers[key]] || "") : covers[key];
      return map;
    }, {});
  }).catch(() => Object.keys(covers || {}).reduce((map, key) => {
    map[key] = isCloudFileUrl(covers[key]) ? "" : covers[key];
    return map;
  }, {}));
}

function decorateTemplates(cloudCovers = {}, failedCovers = {}) {
  return getThemeTemplates().map((item) => {
    const coverImage = failedCovers[item.id] ? "" : (cloudCovers[item.id] || "");
    return {
      ...item,
      coverImage,
      previewCells: Array.from({ length: 9 }).map((_, index) => index + 1),
      readyClass: item.status === "ready" ? "ready" : "soon"
    };
  });
}

function getWindowWidth() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return Number((info || {}).windowWidth || (info || {}).screenWidth || 375);
  } catch (error) {
    return 375;
  }
}

function buildTemplateLayout() {
  const windowWidth = Math.max(1, getWindowWidth());
  const pxToRpx = 750 / windowWidth;
  const pagePaddingRpx = 56;
  const contentRpx = Math.max(320, Math.floor(windowWidth * pxToRpx - pagePaddingRpx));
  const minCardRpx = 320;
  const minGapRpx = 20;
  const preferredGapRpx = 24;
  const useTwoColumns = contentRpx >= minCardRpx * 2 + minGapRpx;
  const gapRpx = useTwoColumns ? preferredGapRpx : 0;
  const cardWidthRpx = useTwoColumns
    ? Math.floor((contentRpx - gapRpx) / 2)
    : contentRpx;

  return {
    templateColumns: useTwoColumns ? 2 : 1,
    templateListStyle: `display:grid;grid-template-columns:${useTwoColumns ? `${cardWidthRpx}rpx ${cardWidthRpx}rpx` : `${cardWidthRpx}rpx`};column-gap:${gapRpx}rpx;row-gap:24rpx;justify-content:start;width:${contentRpx}rpx;max-width:100%;`,
    templateCardStyle: `width:${cardWidthRpx}rpx;`
  };
}

Page({
  data: {
    templates: [],
    coverStatus: "读取云端封面中",
    templateColumns: 2,
    templateListStyle: "",
    templateCardStyle: ""
  },

  onLoad() {
    this.cloudCovers = {};
    this.failedCovers = {};
    this.setData({
      ...buildTemplateLayout(),
      coverStatus: "读取云端封面中",
      templates: decorateTemplates()
    });
    readThemeCoverConfig()
      .then((cloudCovers) => resolveThemeCoverUrls(cloudCovers))
      .then((cloudCovers) => {
        this.cloudCovers = cloudCovers || {};
        this.failedCovers = {};
        this.renderTemplates();
      });
  },

  onResize() {
    this.updateTemplateLayout();
  },

  updateTemplateLayout() {
    this.setData(buildTemplateLayout());
  },

  renderTemplates() {
    const cloudCovers = this.cloudCovers || {};
    const failedCovers = this.failedCovers || {};
    const coverCount = Object.keys(cloudCovers).filter((key) => cloudCovers[key] && !failedCovers[key]).length;
    this.setData({
      coverStatus: coverCount ? "" : "云端封面未配置",
      templates: decorateTemplates(cloudCovers, failedCovers)
    });
  },

  onCoverLoad(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    console.log("theme cover loaded", id);
  },

  onCoverError(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    console.warn("theme cover load failed", id, (this.cloudCovers || {})[id], event.detail || {});
    this.failedCovers = {
      ...(this.failedCovers || {}),
      [id]: true
    };
    this.renderTemplates();
  },

  openTemplate(event) {
    const id = event.currentTarget.dataset.id;
    const template = this.data.templates.find((item) => item.id === id);
    if (!template) return;

    if (template.status !== "ready") {
      wx.showToast({ title: "这个模板稍后开放", icon: "none" });
      return;
    }

    if (id === "life9") {
      const app = getApp();
      app.globalData.draftMode = "theme";
      app.globalData.draftThemeTemplate = "life9";
      app.globalData.draftThemePrompts = template.prompts || [];
      app.globalData.draftThemeChoices = {};
      app.globalData.draftThemeArtists = {};
      app.globalData.draftAlbums = [];
      app.globalData.draftThemeAlbumTarget = 9;
      app.globalData.currentThemeSlotId = "";
      app.globalData.currentThemeSlotArtist = null;
      wx.navigateTo({ url: "/pages/theme-life/theme-life?template=life9" });
      return;
    }

    if (id === "qa") {
      const app = getApp();
      app.globalData.draftMode = "qa";
      app.globalData.draftThemeTemplate = "qa";
      app.globalData.draftQaPrompts = [];
      app.globalData.draftQaArtists = {};
      app.globalData.currentQaSlotId = "";
      app.globalData.currentQaSlotArtist = null;
      app.globalData.creatorChoices = {};
      app.globalData.friendChoices = {};
      wx.navigateTo({ url: "/pages/theme-qa/theme-qa" });
      return;
    }

    if (id === "heart") {
      const app = getApp();
      app.globalData.draftMode = "theme";
      app.globalData.draftThemeTemplate = "heart";
      app.globalData.draftThemePrompts = template.prompts || [];
      app.globalData.draftThemeChoices = {};
      app.globalData.draftThemeArtists = {};
      app.globalData.draftAlbums = [];
      app.globalData.draftThemeAlbumTarget = (template.prompts || []).length || 15;
      app.globalData.currentThemeSlotId = "";
      app.globalData.currentThemeSlotArtist = null;
      wx.navigateTo({ url: "/pages/theme-heart/theme-heart?template=heart" });
    }
  }
});
