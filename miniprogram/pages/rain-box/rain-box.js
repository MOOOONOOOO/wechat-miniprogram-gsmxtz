const {
  receiveRainLetter,
  sendRainLetter
} = require("../../utils/api");
const { WELCOME_RAIN_LETTER } = require("../../data/rainLetterSeeds");
const { hydrateRainLetterSong } = require("../../utils/rainLetterLyrics");

const DAILY_RECEIVED_KEY = "rainBoxReceivedDate:v1";
const DAILY_SENT_KEY = "rainBoxSentDate:v1";
const INCOMING_LETTERS_KEY = "rainBoxIncomingLetters:v1";
const OUTGOING_LETTERS_KEY = "rainBoxOutgoingLetters:v1";
const LOCAL_LETTER_CACHE_LIMIT = 999;
const DROP_COUNT = 207;
const RAIN_FALL_SPEED_MULTIPLIER = 1.2;
const MAX_LETTER_BODY_LENGTH = 600;
const TIMELINE_COUNT = 4;
const RAIN_AUDIO_OPENING_URL = "cloud://cloud1-d7g2ztvs63d2800d4.636c-cloud1-d7g2ztvs63d2800d4-1434331557/音效/雨声开场.mp3";
const RAIN_AUDIO_LOOP_URL = "cloud://cloud1-d7g2ztvs63d2800d4.636c-cloud1-d7g2ztvs63d2800d4-1434331557/音效/雨声循环.mp3";
const LETTER_AUDIO_URL = "cloud://cloud1-d7g2ztvs63d2800d4.636c-cloud1-d7g2ztvs63d2800d4-1434331557/音效/寄信和收信音效.mp3";
const BOX_AUDIO_URL = "cloud://cloud1-d7g2ztvs63d2800d4.636c-cloud1-d7g2ztvs63d2800d4-1434331557/音效/打开和关闭盒子.mp3";
const OPEN_BOX_AUDIO_DELAY_MS = 1500;
const LETTER_SWIPE_THRESHOLD = 72;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function mapValue(value, inputMin, inputMax, outputMin, outputMax) {
  const progress = (value - inputMin) / (inputMax - inputMin);
  return outputMin + progress * (outputMax - outputMin);
}

function buildRainViewModel() {
  const modes = ["left", "right", "calm"];
  const rainMode = modes[Math.floor(Math.random() * modes.length)];
  let globalAngle;

  if (rainMode === "left") {
    globalAngle = randomBetween(-16, -11);
  } else if (rainMode === "right") {
    globalAngle = randomBetween(11, 16);
  } else {
    globalAngle = randomBetween(-1, 1);
  }

  const drops = Array.from({ length: DROP_COUNT }, (_, index) => {
    const depth = randomBetween(0.35, 1);
    const length = mapValue(depth, 0.35, 1, 4, 18);
    const weight = mapValue(depth, 0.35, 1, 0.35, 1.1);
    const opacity = mapValue(depth, 0.35, 1, 35 / 255, 115 / 255);
    const duration = mapValue(depth, 0.35, 1, 12.8, 4.6)
      / RAIN_FALL_SPEED_MULTIPLIER;
    const angleVariance = rainMode === "calm" ? 1.5 : 0.7;
    const angle = globalAngle + randomBetween(-angleVariance, angleVariance);
    let left;

    if (rainMode === "left") {
      left = randomBetween(0, 125);
    } else if (rainMode === "right") {
      left = randomBetween(-25, 100);
    } else {
      left = randomBetween(-5, 105);
    }

    return {
      id: `rain-${index}`,
      motionStyle: [
        `left:${left.toFixed(2)}vw`,
        `animation-duration:${duration.toFixed(2)}s`,
        `animation-delay:${(-randomBetween(0, duration)).toFixed(2)}s`
      ].join(";"),
      streakStyle: [
        `width:${Math.max(0.5, weight).toFixed(2)}px`,
        `height:${length.toFixed(2)}px`,
        `opacity:${opacity.toFixed(3)}`,
        `transform:rotate(${(-angle).toFixed(2)}deg)`
      ].join(";")
    };
  });

  return {
    rainDirectionClass: `rain-${rainMode}`,
    rainDrops: drops
  };
}

const SCENE_CONTENT = {
  idle: {
    stateLabel: "一封未拆的信，正在等你",
    stateIndex: "00 / 03",
    actionTitle: "今天的信到了",
    actionCopy: "盒盖还没有被打开。准备好时，轻轻按一下开启。",
    buttonLabel: "打开箱子",
    actionDisabled: false
  },
  opening: {
    stateLabel: "盒子正在认出你的手",
    stateIndex: "01 / 03",
    actionTitle: "请稍等一场雨",
    actionCopy: "第一段播放完毕后，盒子会保持呼吸，等待你的第二次选择。",
    buttonLabel: "正在打开箱子",
    actionDisabled: true
  },
  waiting: {
    stateLabel: "有一封信，正在盒子里呼吸",
    stateIndex: "02 / 03",
    actionTitle: "要把信取出来吗？",
    actionCopy: "盒子会一直停留在这一刻。再次开启，才能看到里面的话。",
    buttonLabel: "打开信件",
    actionDisabled: false
  },
  revealing: {
    stateLabel: "信封正在抵达",
    stateIndex: "03 / 03",
    actionTitle: "它向你打开了",
    actionCopy: "动画结束后，信纸会从信封里展开。请把这几秒留给写信的人。",
    buttonLabel: "正在打开信件",
    actionDisabled: true
  },
  received: {
    stateLabel: "今天的信已经收到",
    stateIndex: "03 / 03",
    actionTitle: "信已经交给你了",
    actionCopy: "今天只能收这一封。你可以把它收好，或者重看一次抵达的过程。",
    buttonLabel: "打开信件",
    actionDisabled: false
  },
  sending: {
    stateLabel: "你的信正在被盒子收好",
    stateIndex: "03 / 03",
    actionTitle: "正在寄出",
    actionCopy: "盒盖合上以后，这封信就会去往另一个雨天。",
    buttonLabel: "寄送中",
    actionDisabled: true
  }
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getClientEnvVersion() {
  try {
    const accountInfo = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return String((((accountInfo || {}).miniProgram || {}).envVersion) || "develop");
  } catch (error) {
    return "develop";
  }
}

function isDeveloperBuild() {
  return getClientEnvVersion() !== "release";
}

function hasReceivedToday() {
  try {
    return wx.getStorageSync(DAILY_RECEIVED_KEY) === localDateKey();
  } catch (error) {
    return false;
  }
}

function markReceivedToday() {
  try {
    wx.setStorageSync(DAILY_RECEIVED_KEY, localDateKey());
  } catch (error) {}
}

function hasSentToday() {
  try {
    return wx.getStorageSync(DAILY_SENT_KEY) === localDateKey();
  } catch (error) {
    return false;
  }
}

function formatLetterDate(date = new Date()) {
  const hour = date.getHours();
  const period = hour < 6
    ? "凌晨"
    : (hour < 12 ? "上午" : (hour < 18 ? "下午" : "晚上"));
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日，${period}`;
}

function normalizeLetterSong(song = {}) {
  return {
    ...song,
    name: song.name || song.trackName || "",
    trackName: song.trackName || song.name || "",
    artistName: song.artistName || "",
    album: song.album || song.collectionName || "",
    collectionName: song.collectionName || song.album || "",
    cover: song.cover || song.artworkUrl600 || song.artworkUrl100 || song.albumCover || ""
  };
}

function normalizeReceivedLetter(letter = {}) {
  const body = String(letter.body || "").trim();
  const bodyLines = Array.isArray(letter.bodyLines)
    ? letter.bodyLines.map((line) => String(line || "").trim()).filter(Boolean)
    : body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const song = normalizeLetterSong(letter.song || {});
  return {
    ...letter,
    id: letter.id || letter._id || `rain-letter-${Date.now()}`,
    title: String(letter.title || "").trim(),
    body,
    bodyLines: bodyLines.length ? bodyLines : [body],
    signature: String(letter.signature || "").trim() || "神秘人",
    dateText: String(letter.dateText || formatLetterDate()).trim(),
    song: {
      ...song,
      lyrics: (song.lyrics || []).map((line) => String(line || "").trim()).filter(Boolean)
    }
  };
}

function storeOutgoingLetter(letter, markDaily = true) {
  try {
    const previous = wx.getStorageSync(OUTGOING_LETTERS_KEY);
    const letters = Array.isArray(previous) ? previous : [];
    wx.setStorageSync(
      OUTGOING_LETTERS_KEY,
      [letter, ...letters].slice(0, LOCAL_LETTER_CACHE_LIMIT)
    );
    if (markDaily) wx.setStorageSync(DAILY_SENT_KEY, localDateKey());
  } catch (error) {
    console.warn("save outgoing rain letter locally failed", error);
  }
}

function storeIncomingLetter(letter) {
  try {
    const previous = wx.getStorageSync(INCOMING_LETTERS_KEY);
    const letters = Array.isArray(previous) ? previous : [];
    const exists = letters.some((item) => item && item.id === letter.id);
    if (!exists) {
      wx.setStorageSync(
        INCOMING_LETTERS_KEY,
        [letter, ...letters].slice(0, LOCAL_LETTER_CACHE_LIMIT)
      );
    }
  } catch (error) {}
}

Page({
  data: {
    sceneState: "idle",
    activeTimeline: "timeline1",
    videoSrc1: "",
    videoSrc2: "",
    videoSrc3: "",
    videoSrc4: "",
    videoPrepared: false,
    mediaStatus: "loading",
    mediaProgress: 0,
    mediaError: "",
    stateLabel: SCENE_CONTENT.idle.stateLabel,
    stateIndex: SCENE_CONTENT.idle.stateIndex,
    actionTitle: SCENE_CONTENT.idle.actionTitle,
    actionCopy: SCENE_CONTENT.idle.actionCopy,
    buttonLabel: SCENE_CONTENT.idle.buttonLabel,
    actionDisabled: true,
    showLetter: false,
    showComposer: false,
    showLetterPreview: false,
    videoMaskVisible: false,
    receivedLetter: null,
    receivedSong: {},
    receivedLyricsLoading: false,
    hasWrittenToday: false,
    composeTitle: "",
    composeBody: "",
    composeBodyCount: 0,
    composeBodyMaxLength: MAX_LETTER_BODY_LENGTH,
    composeSignature: "",
    composeDateText: "",
    composeSong: null,
    composeLyrics: [],
    composeLyricsLoading: false,
    composerCanSend: false,
    sendingLetter: false,
    isDeveloperBuild: false,
    cloudInboxLoading: false,
    cloudInboxReady: false,
    cloudInboxEmpty: false,
    rainDirectionClass: "rain-calm",
    rainDrops: []
  },

  onLoad() {
    this.loadedVideos = {};
    this.isPageAlive = true;
    this.isPageVisible = true;
    this.sceneDateKey = localDateKey();
    this.hasShownRainBox = false;
    this.hasCompletedRainOpening = false;
    this.initRainAudio();
    const developerBuild = isDeveloperBuild();
    const receivedToday = hasReceivedToday();
    const rainViewModel = buildRainViewModel();
    this.setData({
      sceneState: receivedToday ? "received" : "idle",
      activeTimeline: receivedToday ? "timeline2" : "timeline1",
      hasWrittenToday: developerBuild ? false : hasSentToday(),
      isDeveloperBuild: developerBuild,
      ...rainViewModel
    }, () => this.updateScene(receivedToday ? "received" : "idle"));
    this.loadCloudIncomingLetter();
    this.usePrefetchedMedia();
  },

  onReady() {
    this.videoContexts = {
      timeline1: wx.createVideoContext("rainTimeline1", this),
      timeline2: wx.createVideoContext("rainTimeline2", this),
      timeline3: wx.createVideoContext("rainTimeline3", this),
      timeline4: wx.createVideoContext("rainTimeline4", this)
    };
  },

  onShow() {
    this.isPageVisible = true;
    const todayKey = localDateKey();
    const crossedIntoNewDay = Boolean(this.sceneDateKey && this.sceneDateKey !== todayKey);
    this.sceneDateKey = todayKey;
    if (crossedIntoNewDay) this.resetSceneForNewDay();
    this.startRainAudio(this.hasShownRainBox);
    this.hasShownRainBox = true;
    const hasWrittenToday = this.data.isDeveloperBuild ? false : hasSentToday();
    if (hasWrittenToday !== this.data.hasWrittenToday) {
      this.setData({ hasWrittenToday }, () => this.updateComposerCanSend());
    }
    this.syncComposerSong();
    if (this.data.showComposer || this.data.showLetter || this.data.showLetterPreview) return;
    if (!this.data.videoPrepared) return;
    const state = this.data.sceneState;
    if (state === "waiting") this.playContext("timeline2", false);
    if (state === "opening") this.playContext("timeline1", false);
    if (state === "revealing") this.playContext("timeline3", false);
    if (state === "sending") this.playContext("timeline4", false);
    if (state === "received" && !this.data.showLetter) {
      this.playContext("timeline2", false);
    }
  },

  onHide() {
    this.isPageVisible = false;
    this.pauseAllVideos();
    this.stopRainAudio();
  },

  onUnload() {
    this.isPageAlive = false;
    this.isPageVisible = false;
    this.pauseAllVideos();
    this.destroyRainAudio();
    if (this.letterTimer) clearTimeout(this.letterTimer);
    if (this.mediaProgressTimer) clearInterval(this.mediaProgressTimer);
    if (this.videoMaskTimer) clearTimeout(this.videoMaskTimer);
    if (this.composerVideoTimer) clearTimeout(this.composerVideoTimer);
  },

  initRainAudio() {
    if (!wx.createInnerAudioContext) return;

    if (wx.setInnerAudioOption) {
      wx.setInnerAudioOption({
        obeyMuteSwitch: false,
        mixWithOther: true
      });
    }

    const opening = wx.createInnerAudioContext();
    const loop = wx.createInnerAudioContext();
    const letter = wx.createInnerAudioContext();
    const box = wx.createInnerAudioContext();

    opening.loop = false;
    opening.volume = 0.62;
    loop.loop = true;
    loop.volume = 0.52;
    letter.loop = false;
    letter.volume = 0.86;
    box.loop = false;
    box.volume = 0.9;

    opening.onEnded(() => {
      this.hasCompletedRainOpening = true;
      if (this.isPageVisible) this.playRainLoop();
    });

    [opening, loop, letter, box].forEach((context) => {
      context.onError((error) => {
        console.warn("rain box audio failed", error);
      });
    });

    this.rainAudioContexts = { opening, loop, letter, box };
    this.rainAudioReady = false;
    this.rainAudioRequestId = 0;
    this.rainAudioPreparePromise = this.prepareRainAudioSources();
  },

  downloadRainAudioSource(fileID) {
    if (
      !String(fileID || "").startsWith("cloud://")
      || !wx.cloud
      || !wx.cloud.downloadFile
    ) {
      return Promise.resolve(fileID);
    }

    return new Promise((resolve) => {
      wx.cloud.downloadFile({
        fileID,
        success: (result) => resolve((result && result.tempFilePath) || fileID),
        fail: (error) => {
          console.warn("download rain box audio failed", error);
          resolve(fileID);
        }
      });
    });
  },

  prepareRainAudioSources() {
    const contexts = this.rainAudioContexts;
    if (!contexts) return Promise.resolve();

    const entries = [
      ["opening", RAIN_AUDIO_OPENING_URL],
      ["loop", RAIN_AUDIO_LOOP_URL],
      ["letter", LETTER_AUDIO_URL],
      ["box", BOX_AUDIO_URL]
    ];

    return Promise.all(entries.map(([, source]) => (
      this.downloadRainAudioSource(source)
    ))).then((sources) => {
      if (!this.isPageAlive || this.rainAudioContexts !== contexts) return;
      entries.forEach(([key], index) => {
        contexts[key].src = sources[index];
      });
      this.rainAudioReady = true;
    });
  },

  startRainAudio(resumeWithLoop = false) {
    const contexts = this.rainAudioContexts;
    if (!contexts) return;

    const requestId = (this.rainAudioRequestId || 0) + 1;
    this.rainAudioRequestId = requestId;
    const start = () => {
      if (
        !this.isPageVisible
        || requestId !== this.rainAudioRequestId
        || contexts !== this.rainAudioContexts
      ) {
        return;
      }
      try {
        contexts.opening.stop();
        contexts.loop.stop();
        if (resumeWithLoop) {
          contexts.loop.play();
        } else {
          contexts.opening.play();
        }
      } catch (error) {
        console.warn("start rain audio failed", error);
      }
    };

    if (this.rainAudioReady) {
      start();
      return;
    }
    (this.rainAudioPreparePromise || Promise.resolve()).then(start);
  },

  playRainLoop() {
    const contexts = this.rainAudioContexts;
    if (!contexts || !this.isPageVisible) return;
    try {
      contexts.opening.stop();
      contexts.loop.stop();
      contexts.loop.play();
    } catch (error) {
      console.warn("play rain loop failed", error);
    }
  },

  playLetterAudio() {
    this.playRainEffectAudio("letter", "play rain letter audio failed");
  },

  playBoxAudio(delayMs = 0) {
    this.ensureRainAudioFromGesture();
    if (this.boxAudioTimer) {
      clearTimeout(this.boxAudioTimer);
      this.boxAudioTimer = null;
    }
    const play = () => {
      this.boxAudioTimer = null;
      this.playRainEffectAudio("box", "play rain box action audio failed");
    };
    if (delayMs > 0) {
      this.boxAudioTimer = setTimeout(play, delayMs);
      return;
    }
    play();
  },

  playRainEffectAudio(key, warning) {
    const contexts = this.rainAudioContexts;
    if (!contexts || !this.isPageVisible) return;

    const play = () => {
      if (!this.isPageVisible || contexts !== this.rainAudioContexts) return;
      try {
        contexts[key].stop();
        contexts[key].play();
      } catch (error) {
        console.warn(warning, error);
      }
    };

    if (this.rainAudioReady) {
      play();
      return;
    }
    (this.rainAudioPreparePromise || Promise.resolve()).then(play);
  },

  ensureRainAudioFromGesture() {
    const contexts = this.rainAudioContexts;
    if (!contexts || !this.rainAudioReady) return;
    const openingPaused = contexts.opening.paused !== false;
    const loopPaused = contexts.loop.paused !== false;
    if (openingPaused && loopPaused) {
      this.startRainAudio(this.hasCompletedRainOpening);
    }
  },

  stopRainAudio() {
    if (this.boxAudioTimer) {
      clearTimeout(this.boxAudioTimer);
      this.boxAudioTimer = null;
    }
    const contexts = this.rainAudioContexts;
    if (!contexts) return;
    this.rainAudioRequestId = (this.rainAudioRequestId || 0) + 1;
    ["opening", "loop", "letter", "box"].forEach((key) => {
      try {
        contexts[key].stop();
      } catch (error) {}
    });
  },

  destroyRainAudio() {
    const contexts = this.rainAudioContexts;
    if (!contexts) return;
    this.stopRainAudio();
    ["opening", "loop", "letter", "box"].forEach((key) => {
      try {
        contexts[key].destroy();
      } catch (error) {}
    });
    this.rainAudioContexts = null;
    this.rainAudioReady = false;
    this.rainAudioPreparePromise = null;
  },

  resetSceneForNewDay() {
    if (this.letterTimer) {
      clearTimeout(this.letterTimer);
      this.letterTimer = null;
    }
    this.pauseAllVideos();
    this.setData({
      showLetter: false,
      showComposer: false,
      showLetterPreview: false,
      sendingLetter: false,
      activeTimeline: "timeline1",
      hasWrittenToday: this.data.isDeveloperBuild ? false : hasSentToday(),
      cloudInboxReady: false,
      cloudInboxEmpty: false
    }, () => {
      this.updateScene("idle");
      const context = this.videoContexts && this.videoContexts.timeline1;
      if (context) {
        try {
          context.seek(0);
          context.pause();
        } catch (error) {}
      }
      this.loadCloudIncomingLetter(true);
    });
  },

  usePrefetchedMedia(force = false) {
    this.loadedVideos = {};
    const app = getApp();
    const globalData = app.globalData || {};
    this.setData({
      mediaStatus: "loading",
      mediaProgress: Number(globalData.rainBoxMediaProgress) || 0,
      mediaError: "",
      videoPrepared: false
    });

    const progressTimer = setInterval(() => {
      if (!this.isPageAlive) return;
      const nextPercent = Number(app.globalData.rainBoxMediaProgress) || 0;
      if (nextPercent !== this.data.mediaProgress) {
        this.setData({ mediaProgress: nextPercent });
      }
    }, 240);
    this.mediaProgressTimer = progressTimer;

    app.prefetchRainBoxMedia(force).then((sources) => {
      clearInterval(progressTimer);
      if (this.mediaProgressTimer === progressTimer) this.mediaProgressTimer = null;
      if (!this.isPageAlive) return;
      this.setData({
        videoSrc1: sources.timeline1 || "",
        videoSrc2: sources.timeline2 || "",
        videoSrc3: sources.timeline3 || "",
        videoSrc4: sources.timeline4 || "",
        mediaStatus: "warming",
        mediaProgress: 100
      });
    }).catch((error) => {
      clearInterval(progressTimer);
      if (this.mediaProgressTimer === progressTimer) this.mediaProgressTimer = null;
      if (!this.isPageAlive) return;
      const isConfigurationError = error && error.code === "RAIN_BOX_MEDIA_NOT_CONFIGURED";
      const rawErrorMessage = String(
        (error && (error.errMsg || error.message)) || "未知错误"
      );
      this.setData({
        mediaStatus: "error",
        mediaError: isConfigurationError
          ? "四段动画还没有配置云存储地址"
          : rawErrorMessage
      });
      wx.showToast({
        title: rawErrorMessage.slice(0, 30),
        icon: "none",
        duration: 4200
      });
      console.error("prepare rain box media failed", error);
    });
  },

  onVideoLoaded(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    if (this.loadedVideos[key]) return;
    this.loadedVideos[key] = true;
    if (Object.keys(this.loadedVideos).length < TIMELINE_COUNT) return;

    this.setData({
      videoPrepared: true,
      mediaStatus: "ready"
    }, () => {
      this.updateScene(this.data.sceneState);
      if (this.data.sceneState === "received") {
        this.playContext("timeline2");
      }
    });
  },

  onVideoError(event) {
    console.error("rain box video failed", event && event.detail);
    this.setData({
      mediaStatus: "error",
      mediaError: "视频解码失败，请重试"
    });
  },

  retryMedia() {
    this.usePrefetchedMedia(true);
  },

  updateScene(sceneState) {
    const content = SCENE_CONTENT[sceneState] || SCENE_CONTENT.idle;
    const needsVideo = sceneState !== "received";
    this.setData({
      sceneState,
      stateLabel: content.stateLabel,
      stateIndex: content.stateIndex,
      actionTitle: content.actionTitle,
      actionCopy: content.actionCopy,
      buttonLabel: content.buttonLabel,
      actionDisabled: content.actionDisabled || (needsVideo && !this.data.videoPrepared)
    });
  },

  pauseAllVideos() {
    if (!this.videoContexts) return;
    Object.keys(this.videoContexts).forEach((key) => {
      try {
        this.videoContexts[key].pause();
      } catch (error) {}
    });
  },

  playContext(key, reset = true) {
    const context = this.videoContexts && this.videoContexts[key];
    if (!context) return;
    this.pauseAllVideos();
    this.setData({ activeTimeline: key }, () => {
      if (reset) context.seek(0);
      context.play();
    });
  },

  onOpenTap() {
    if (this.data.mediaStatus === "error") {
      this.retryMedia();
      return;
    }
    const state = this.data.sceneState;
    if (
      this.data.isDeveloperBuild
      && (!this.data.cloudInboxReady || !this.data.receivedLetter)
    ) {
      this.useDevelopmentIncomingLetter();
    }
    if (state === "received") {
      if (!this.data.cloudInboxReady || !this.data.receivedLetter) {
        if (!this.data.cloudInboxLoading) this.loadCloudIncomingLetter(true);
        wx.showToast({ title: "信件还在路上", icon: "none" });
        return;
      }
      this.pauseAllVideos();
      this.setData({ showLetter: true });
      return;
    }
    if (!this.data.videoPrepared || this.data.actionDisabled) return;

    if (state === "idle") {
      if (!this.data.cloudInboxReady || this.data.cloudInboxEmpty) {
        if (!this.data.cloudInboxLoading) this.loadCloudIncomingLetter(true);
        wx.showToast({
          title: this.data.cloudInboxEmpty ? "今天暂时还没有来信" : "正在等信件抵达",
          icon: "none"
        });
        return;
      }
      this.playBoxAudio(OPEN_BOX_AUDIO_DELAY_MS);
      this.updateScene("opening");
      this.playContext("timeline1");
      return;
    }

    if (state === "waiting") {
      this.playLetterAudio();
      this.updateScene("revealing");
      this.playContext("timeline3");
    }
  },

  onTimeline1Ended() {
    if (this.data.sceneState !== "opening") return;
    this.updateScene("waiting");
    this.playContext("timeline2");
  },

  onTimeline3Ended() {
    if (this.data.sceneState !== "revealing") return;
    markReceivedToday();
    if (this.data.receivedLetter) storeIncomingLetter(this.data.receivedLetter);
    this.updateScene("received");
    if (this.letterTimer) clearTimeout(this.letterTimer);
    this.letterTimer = setTimeout(() => {
      if (!this.isPageVisible) return;
      this.setData({ showLetter: true });
    }, 320);
  },

  onTimeline4Ended() {
    if (this.data.sceneState !== "sending") return;
    this.setData({ sendingLetter: false }, () => {
      this.updateScene("waiting");
      this.playContext("timeline2");
      wx.showToast({ title: "已寄出", icon: "success" });
    });
  },

  onLetterSceneTap() {
    if (Date.now() < Number(this.suppressLetterSceneTapUntil || 0)) return;
    this.closeLetter();
  },

  onLetterGestureStart(event) {
    const touch = event && event.touches && event.touches[0];
    if (!touch) return;
    this.letterGestureStart = {
      x: Number(touch.clientX),
      y: Number(touch.clientY)
    };
  },

  onLetterGestureEnd(event) {
    const start = this.letterGestureStart;
    this.letterGestureStart = null;
    const touch = event && event.changedTouches && event.changedTouches[0];
    if (!start || !touch) return;

    const deltaX = Number(touch.clientX) - start.x;
    const deltaY = Number(touch.clientY) - start.y;
    const horizontalSwipe = Math.abs(deltaX) >= LETTER_SWIPE_THRESHOLD
      && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;

    if (!horizontalSwipe) return;
    this.suppressLetterSceneTapUntil = Date.now() + 320;
    this.closeLetter();
  },

  onLetterGestureCancel() {
    this.letterGestureStart = null;
  },

  closeLetter() {
    this.switchVideoBehindMask(() => {
      this.setData({ showLetter: false }, () => {
        if (this.data.sceneState === "received" && this.data.videoPrepared) {
          this.playContext("timeline2");
        }
      });
    });
  },

  replayAnimation() {
    if (!this.data.videoPrepared) {
      wx.showToast({ title: "动画还在准备", icon: "none" });
      return;
    }
    if (this.letterTimer) clearTimeout(this.letterTimer);
    this.switchVideoBehindMask(() => {
      this.pauseAllVideos();
      this.setData({
        showLetter: false,
        activeTimeline: "timeline1"
      }, () => {
        Object.keys(this.videoContexts || {}).forEach((key) => {
          try {
            this.videoContexts[key].seek(0);
            this.videoContexts[key].pause();
          } catch (error) {}
        });
        this.updateScene("idle");
      });
    });
  },

  switchVideoBehindMask(callback) {
    if (this.videoMaskTimer) clearTimeout(this.videoMaskTimer);
    this.setData({ videoMaskVisible: true }, () => {
      if (typeof callback === "function") callback();
      this.videoMaskTimer = setTimeout(() => {
        this.videoMaskTimer = null;
        if (!this.isPageAlive) return;
        this.setData({ videoMaskVisible: false });
      }, 240);
    });
  },

  openComposer() {
    if (this.data.hasWrittenToday && !this.data.isDeveloperBuild) {
      wx.showToast({ title: "今天已经写过一封信", icon: "none" });
      return;
    }
    if (!this.data.videoPrepared) {
      wx.showToast({ title: "动画还在准备", icon: "none" });
      return;
    }

    this.pauseAllVideos();
    this.setData({
      showComposer: true,
      composeDateText: formatLetterDate()
    }, () => this.updateComposerCanSend());
  },

  closeComposer() {
    if (this.data.sendingLetter) return;
    this.setData({ showComposer: false }, () => {
      if (!this.data.videoPrepared) return;
      const state = this.data.sceneState;
      if (state === "received" || state === "waiting") {
        this.playContext("timeline2", false);
      } else if (state === "idle") {
        const context = this.videoContexts && this.videoContexts.timeline1;
        if (context) {
          context.seek(0);
          context.pause();
        }
      }
    });
  },

  onComposerInput(event) {
    const field = String((event.currentTarget.dataset || {}).field || "");
    if (!field) return;
    const value = String(event.detail.value || "");
    const patch = { [field]: value };
    if (field === "composeBody") patch.composeBodyCount = value.length;
    this.setData(patch, () => this.updateComposerCanSend());
  },

  updateComposerCanSend() {
    const canSend = this.isComposerComplete();
    if (canSend !== this.data.composerCanSend) {
      this.setData({ composerCanSend: canSend });
    }
  },

  isComposerComplete() {
    return Boolean(
      String(this.data.composeBody || "").trim() &&
      (!this.data.hasWrittenToday || this.data.isDeveloperBuild) &&
      !this.data.sendingLetter
    );
  },

  chooseSongForLetter() {
    const app = getApp();
    app.globalData.draftMode = "rainLetter";
    wx.navigateTo({
      url: "/pages/artists/artists?mode=rainLetter"
    });
  },

  openMailbox() {
    wx.navigateTo({ url: "/pages/rain-box-mailbox/rain-box-mailbox" });
  },

  useDevelopmentIncomingLetter() {
    const receivedLetter = normalizeReceivedLetter(WELCOME_RAIN_LETTER);
    this.setData({
      receivedLetter,
      receivedSong: receivedLetter.song,
      cloudInboxReady: true,
      cloudInboxEmpty: false
    }, () => this.hydrateReceivedLetterLyrics(receivedLetter));
    return receivedLetter;
  },

  hydrateReceivedLetterLyrics(receivedLetter) {
    if (!receivedLetter || !receivedLetter.song || !receivedLetter.song.name) {
      this.setData({ receivedLyricsLoading: false });
      return Promise.resolve(receivedLetter);
    }
    if ((receivedLetter.song.lyrics || []).length) {
      this.setData({ receivedLyricsLoading: false });
      return Promise.resolve(receivedLetter);
    }

    const requestId = (this.receivedLyricsRequestId || 0) + 1;
    this.receivedLyricsRequestId = requestId;
    const identity = String(receivedLetter.id || receivedLetter.cloudId || "");
    this.setData({ receivedLyricsLoading: true });
    return hydrateRainLetterSong(receivedLetter.song).then((song) => {
      if (
        !this.isPageAlive
        || requestId !== this.receivedLyricsRequestId
        || identity !== String((this.data.receivedLetter || {}).id || "")
      ) {
        return receivedLetter;
      }
      const hydratedLetter = {
        ...this.data.receivedLetter,
        song
      };
      this.setData({
        receivedLetter: hydratedLetter,
        receivedSong: song,
        receivedLyricsLoading: false
      });
      return hydratedLetter;
    });
  },

  loadCloudIncomingLetter(force = false) {
    if (this.data.cloudInboxLoading) return Promise.resolve(null);
    if (!force && this.data.cloudInboxReady) {
      return Promise.resolve(this.data.receivedLetter);
    }

    this.setData({ cloudInboxLoading: true });
    return receiveRainLetter({
      clientEnvVersion: getClientEnvVersion()
    }).then((res) => {
      if (!res || !res.letter) {
        if (this.data.isDeveloperBuild) {
          return this.useDevelopmentIncomingLetter();
        }
        this.setData({
          cloudInboxReady: true,
          cloudInboxEmpty: true
        });
        return null;
      }
      const receivedLetter = normalizeReceivedLetter(res.letter);
      this.setData({
        receivedLetter,
        receivedSong: receivedLetter.song,
        cloudInboxReady: true,
        cloudInboxEmpty: false
      }, () => this.hydrateReceivedLetterLyrics(receivedLetter));
      return receivedLetter;
    }).catch((error) => {
      console.warn("receive rain letter failed", error);
      if (this.data.isDeveloperBuild) {
        return this.useDevelopmentIncomingLetter();
      }
      this.setData({
        cloudInboxReady: false,
        cloudInboxEmpty: false
      });
      return null;
    }).finally(() => {
      if (this.isPageAlive) this.setData({ cloudInboxLoading: false });
    });
  },

  syncComposerSong() {
    const app = getApp();
    const song = normalizeLetterSong(app.globalData.rainLetterSong || {});
    if (!song.name) return;

    const chosenLyrics = (app.globalData.rainLetterSelectedLyrics || [])
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    const fallbackLyrics = (app.globalData.rainLetterLyricLines || [])
      .map((line) => String((line && line.text) || line || "").trim())
      .filter(Boolean)
      .slice(0, 3);
    const composeLyrics = chosenLyrics.length ? chosenLyrics : fallbackLyrics;

    this.setData({
      composeSong: song,
      composeLyrics,
      composeLyricsLoading: false
    }, () => {
      this.updateComposerCanSend();
      if (!composeLyrics.length) this.hydrateComposerSongLyrics(song);
    });
  },

  hydrateComposerSongLyrics(sourceSong) {
    const song = normalizeLetterSong(sourceSong || {});
    if (!song.name || !song.artistName || (song.lyrics || []).length) {
      return Promise.resolve(song);
    }

    const requestId = (this.composerLyricsRequestId || 0) + 1;
    this.composerLyricsRequestId = requestId;
    const identity = String(song.trackId || song.songId || `${song.artistName}:${song.name}`);
    this.setData({ composeLyricsLoading: true });

    return hydrateRainLetterSong(song).then((hydratedSong) => {
      const currentSong = this.data.composeSong || {};
      const currentIdentity = String(
        currentSong.trackId
        || currentSong.songId
        || `${currentSong.artistName || ""}:${currentSong.name || ""}`
      );
      if (
        !this.isPageAlive
        || requestId !== this.composerLyricsRequestId
        || identity !== currentIdentity
      ) {
        return hydratedSong;
      }

      const lyrics = (hydratedSong.lyrics || [])
        .map((line) => String((line && line.text) || line || "").trim())
        .filter(Boolean)
        .slice(0, 3);
      if (lyrics.length) {
        getApp().globalData.rainLetterLyricLines = lyrics.map((text, index) => ({
          key: `auto-lyric-${index}`,
          index,
          text
        }));
      }
      this.setData({
        composeSong: hydratedSong,
        composeLyrics: lyrics,
        composeLyricsLoading: false
      });
      return hydratedSong;
    }).catch((error) => {
      console.warn("hydrate composer lyrics failed", error);
      if (requestId === this.composerLyricsRequestId && this.isPageAlive) {
        this.setData({ composeLyricsLoading: false });
      }
      return song;
    });
  },

  previewComposedLetter() {
    if (!this.isComposerComplete()) {
      this.updateComposerCanSend();
      wx.showToast({ title: "请输入信件正文", icon: "none" });
      return;
    }
    this.setData({
      composeDateText: formatLetterDate(),
      showLetterPreview: true
    });
  },

  closeLetterPreview() {
    this.setData({ showLetterPreview: false });
  },

  submitLetter() {
    if (!this.isComposerComplete()) {
      this.updateComposerCanSend();
      wx.showToast({ title: "请输入信件正文", icon: "none" });
      return;
    }

    const dateText = formatLetterDate();
    this.playLetterAudio();
    this.playBoxAudio();
    const composeSong = this.data.composeSong
      ? {
        ...normalizeLetterSong(this.data.composeSong),
        lyrics: (this.data.composeLyrics || []).slice(0, 6)
      }
      : {};
    const letter = {
      id: `rain-letter-${Date.now()}`,
      title: String(this.data.composeTitle || "").trim(),
      body: String(this.data.composeBody || "").trim(),
      signature: String(this.data.composeSignature || "").trim() || "神秘人",
      dateText,
      createdAt: Date.now(),
      song: composeSong
    };
    this.setData({
      sendingLetter: true,
      composeDateText: dateText,
      composerCanSend: false,
      hasWrittenToday: false
    });

    return sendRainLetter({
      letter,
      clientEnvVersion: getClientEnvVersion()
    }).then((res) => {
      const savedLetter = {
        ...letter,
        cloudId: (res && res.letterId) || "",
        deliveryStatus: "pending"
      };
      storeOutgoingLetter(savedLetter, !this.data.isDeveloperBuild);
      this.setData({
        hasWrittenToday: this.data.isDeveloperBuild ? false : true,
        cloudInboxReady: false,
        cloudInboxEmpty: false
      });
      this.loadCloudIncomingLetter(true);
      this.switchVideoBehindMask(() => {
        this.setData({
          showComposer: false,
          showLetterPreview: false
        }, () => {
          this.updateScene("sending");
          this.playContext("timeline4");
        });
      });
    }).catch((error) => {
      this.setData({ sendingLetter: false }, () => this.updateComposerCanSend());
      if (
        error
        && (
          error.reason === "CONTENT_REJECTED"
          || error.reason === "CONTENT_REVIEW_UNAVAILABLE"
        )
      ) {
        wx.showModal({
          title: "暂时不能发送",
          content: error.reason === "CONTENT_REJECTED"
            ? "这封信暂时没有通过内容审核，请修改后再试。"
            : "暂时无法完成内容审核，请稍后再试。",
          showCancel: false,
          confirmText: "返回修改"
        });
        return;
      }
      wx.showToast({
        title: (error && error.message) || "寄信失败，请稍后再试",
        icon: "none",
        duration: 3600
      });
    });
  },

  onReceivedSongCoverError() {
    this.setData({ "receivedSong.cover": "" });
  },

  onComposeSongCoverError() {
    this.setData({ "composeSong.cover": "" });
  },

  onShareAppMessage() {
    return {
      title: "雨水一盒｜把今天的雨声换成一首歌",
      path: "/pages/rain-box/rain-box"
    };
  },

  noop() {},

  onShareTimeline() {
    return {
      title: "雨水一盒｜把今天的雨声换成一首歌",
      query: ""
    };
  }
});
