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
    creatorChoices: {},
    creatorTopSongs: [],
    creatorProfile: null,
    friendProfile: null,
    challenge: null,
    friendChoices: {},
    friendTopSongs: [],
    lastResult: null
  },

  onLaunch() {
    if (wx.cloud) {
      const cloudOptions = { traceUser: true };
      if (this.globalData.envId) cloudOptions.env = this.globalData.envId;
      wx.cloud.init(cloudOptions);
    }
  },
});
