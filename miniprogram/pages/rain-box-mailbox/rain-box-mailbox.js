const { listRainLetters } = require("../../utils/api");
const { hydrateRainLetterSong } = require("../../utils/rainLetterLyrics");

const INCOMING_LETTERS_KEY = "rainBoxIncomingLetters:v1";
const OUTGOING_LETTERS_KEY = "rainBoxOutgoingLetters:v1";

function readLetters(key) {
  try {
    const value = wx.getStorageSync(key);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function bodyLines(letter = {}) {
  if (Array.isArray(letter.bodyLines) && letter.bodyLines.length) {
    return letter.bodyLines.map((line) => String(line || "").trim()).filter(Boolean);
  }
  return String(letter.body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeSong(song = {}) {
  return {
    ...song,
    name: song.name || song.trackName || "",
    artistName: song.artistName || "",
    album: song.album || song.collectionName || "",
    cover: song.cover || song.artworkUrl600 || song.artworkUrl100 || song.albumCover || "",
    lyrics: (song.lyrics || []).map((line) => String(line || "").trim()).filter(Boolean)
  };
}

function normalizeLetter(letter = {}, index, type) {
  const lines = bodyLines(letter);
  const body = lines.join("\n");
  return {
    ...letter,
    id: letter.id || `${type}-${index}`,
    title: String(letter.title || "没有标题的信").trim(),
    body,
    bodyLines: lines,
    preview: body.length > 62 ? `${body.slice(0, 62)}…` : body,
    signature: String(letter.signature || "").trim() || "神秘人",
    dateText: String(letter.dateText || "").trim(),
    song: normalizeSong(letter.song || {}),
    directionLabel: type === "inbox" ? "收到" : "寄出"
  };
}

function letterIdentity(letter = {}) {
  return String(letter.cloudId || letter.id || letter.clientId || "");
}

function mergeLetters(cloudLetters, localLetters) {
  const seen = {};
  return [...(cloudLetters || []), ...(localLetters || [])].filter((letter) => {
    const key = letterIdentity(letter);
    if (!key) return true;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

Page({
  data: {
    activeTab: "inbox",
    inbox: [],
    outbox: [],
    activeLetters: [],
    selectedId: "",
    inboxCount: 0,
    outboxCount: 0,
    cloudLoading: false
  },

  onLoad(options = {}) {
    this.setData({
      activeTab: options.tab === "outbox" ? "outbox" : "inbox"
    });
  },

  onShow() {
    this.refreshLetters();
    this.syncCloudLetters();
  },

  refreshLetters() {
    const inbox = readLetters(INCOMING_LETTERS_KEY)
      .map((letter, index) => normalizeLetter(letter, index, "inbox"));
    const outbox = readLetters(OUTGOING_LETTERS_KEY)
      .map((letter, index) => normalizeLetter(letter, index, "outbox"));
    const activeLetters = this.data.activeTab === "outbox" ? outbox : inbox;
    this.setData({
      inbox,
      outbox,
      activeLetters,
      inboxCount: inbox.length,
      outboxCount: outbox.length,
      selectedId: ""
    });
  },

  syncCloudLetters() {
    if (this.data.cloudLoading) return;
    this.setData({ cloudLoading: true });
    return listRainLetters().then((res) => {
      const cloudInbox = (res.inbox || [])
        .map((letter, index) => normalizeLetter(letter, index, "inbox"));
      const cloudOutbox = (res.outbox || [])
        .map((letter, index) => normalizeLetter(letter, index, "outbox"));
      const inbox = mergeLetters(cloudInbox, this.data.inbox);
      const outbox = mergeLetters(cloudOutbox, this.data.outbox);
      this.setData({
        inbox,
        outbox,
        activeLetters: this.data.activeTab === "outbox" ? outbox : inbox,
        inboxCount: inbox.length,
        outboxCount: outbox.length
      });
    }).catch((error) => {
      console.warn("sync rain mailbox failed", error);
    }).finally(() => {
      this.setData({ cloudLoading: false });
    });
  },

  switchTab(event) {
    const activeTab = String((event.currentTarget.dataset || {}).tab || "inbox");
    if (activeTab === this.data.activeTab) return;
    this.setData({
      activeTab,
      activeLetters: activeTab === "outbox" ? this.data.outbox : this.data.inbox,
      selectedId: ""
    });
  },

  toggleLetter(event) {
    const id = String((event.currentTarget.dataset || {}).id || "");
    const opening = this.data.selectedId !== id;
    this.setData({
      selectedId: opening ? id : ""
    });
    if (opening) this.hydrateLetterLyrics(id);
  },

  hydrateLetterLyrics(id) {
    const sourceKey = this.data.activeTab === "outbox" ? "outbox" : "inbox";
    const letter = (this.data[sourceKey] || []).find((item) => item.id === id);
    if (
      !letter
      || !letter.song
      || !letter.song.name
      || (letter.song.lyrics || []).length
      || letter.lyricsLoading
    ) {
      return;
    }

    const loadingLetters = (this.data[sourceKey] || []).map((item) => (
      item.id === id ? { ...item, lyricsLoading: true } : item
    ));
    this.setData({
      [sourceKey]: loadingLetters,
      activeLetters: loadingLetters
    });

    hydrateRainLetterSong(letter.song).then((song) => {
      const nextLetters = (this.data[sourceKey] || []).map((item) => (
        item.id === id
          ? { ...item, song, lyricsLoading: false }
          : item
      ));
      this.setData({
        [sourceKey]: nextLetters,
        activeLetters: this.data.activeTab === sourceKey
          ? nextLetters
          : this.data.activeLetters
      });
    });
  }
});
