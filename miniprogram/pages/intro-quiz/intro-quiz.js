const {
  answerIntroQuiz,
  createIntroQuiz,
  getIntroQuizState,
  joinIntroQuiz,
  readyIntroQuiz,
  searchSongs,
  startIntroQuiz
} = require("../../utils/api");
const {
  cacheAccountProfile,
  isCompleteProfile,
  readCachedProfile,
  saveAccountProfile
} = require("../../utils/profile");
const { saveParticipatedResult } = require("../../utils/history");

const DEFAULT_QUESTION_COUNT = 8;
const MIN_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 30;
const MAX_CANDIDATE_SONGS = 36;
const POLL_INTERVAL_MS = 900;
const CLOCK_INTERVAL_MS = 200;
const DEFAULT_PREVIEW_DURATION_MS = 15000;
const DURATION_OPTIONS_SECONDS = [3, 5, 10, 15];

function questionCountState(questionCount, candidateCount, preparing) {
  const count = Math.floor(Number(questionCount) || 0);
  const availableSongs = Math.min(
    MAX_CANDIDATE_SONGS,
    Math.max(0, Number(candidateCount) || 0)
  );
  const maxForCurrentArtist = Math.max(
    0,
    Math.min(MAX_QUESTION_COUNT, availableSongs - 3)
  );
  const valid = count >= MIN_QUESTION_COUNT && count <= maxForCurrentArtist;
  let hint = `可以自定义 ${MIN_QUESTION_COUNT}–${MAX_QUESTION_COUNT} 道`;
  if (preparing) {
    hint = "正在计算当前曲库可出的题数";
  } else if (maxForCurrentArtist < MIN_QUESTION_COUNT) {
    hint = `至少需要 ${MIN_QUESTION_COUNT + 3} 首可试听歌曲`;
  } else if (!valid) {
    hint = `当前曲库请输入 ${MIN_QUESTION_COUNT}–${maxForCurrentArtist} 道`;
  } else {
    hint = `当前曲库最多可以出 ${maxForCurrentArtist} 道`;
  }
  return {
    questionCount: count,
    questionCountMax: maxForCurrentArtist,
    questionCountHint: hint,
    questionCountInvalid: !preparing && !valid,
    canCreateRoom: !preparing && valid
  };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return String(value || "");
  }
}

function normalizeProfile(profile = {}) {
  return {
    nickName: String(profile.nickName || "").trim(),
    avatarUrl: profile.avatarUrl || ""
  };
}

function normalizeCandidateSong(song = {}) {
  return {
    id: String(song.trackId || song.songId || song.id || ""),
    trackId: String(song.trackId || song.songId || song.id || ""),
    name: String(song.name || song.trackName || "").trim(),
    trackName: String(song.trackName || song.name || "").trim(),
    album: String(song.album || song.collectionName || "").trim(),
    cover: song.cover || song.artworkUrl600 || song.artworkUrl100 || song.albumCover || "",
    previewUrl: String(song.previewUrl || song.preview || "").trim()
  };
}

function optionClass(option, room) {
  const answer = room.myAnswer || null;
  const selected = Boolean(answer && answer.optionId === option.id);
  const revealing = room.phase === "reveal";
  const correct = revealing && room.question && room.question.correctOptionId === option.id;
  if (correct) return "correct";
  if (revealing && selected) return "wrong";
  if (selected) return "selected";
  return "";
}

function optionResultMark(option, room) {
  if (!room || room.phase !== "reveal" || !room.question) return "";
  if (room.question.correctOptionId === option.id) return "✓";
  if (room.myAnswer && room.myAnswer.optionId === option.id) return "×";
  return "";
}

function canAnswerDuringPlayback(room) {
  return Boolean(
    room
    && (
      room.roomType === "solo"
      || !Number(room.answerDurationMs || 0)
    )
  );
}

function phaseCopy(room) {
  if (!room) return "";
  if (room.phase === "preparing") {
    if (room.roomType === "solo") {
      return room.currentIndex > 0 ? "正在加载下一首" : "正在加载试听";
    }
    return "正在加载试听，准备好后统一倒数";
  }
  if (room.phase === "countdown") return "把声音打开，马上开始";
  if (room.phase === "playing") {
    const seconds = Math.round(
      Number(room.questionDurationMs || DEFAULT_PREVIEW_DURATION_MS) / 1000
    );
    const waitsForAnswerWindow = (
      room.roomType !== "solo"
      && Number(room.answerDurationMs || 0) > 0
    );
    return room.myAnswer
      ? (room.roomType === "solo"
        ? (room.myAnswer.correct ? "答对了，正在进入下一首" : "答错了，马上揭晓答案")
        : "答案已锁定，等其他人作答")
      : (waitsForAnswerWindow
        ? `先听完 ${seconds} 秒片段，记住你的答案`
        : `听 ${seconds} 秒片段，直接选出这首歌`);
  }
  if (room.phase === "answering") {
    if (room.myAnswer) {
      return room.roomType === "solo"
        ? (room.myAnswer.correct ? "答对了，正在进入下一首" : "答错了，马上揭晓答案")
        : "答案已锁定，下一首正在准备";
    }
    return "滴滴倒数，抓紧作答";
  }
  if (room.phase === "reveal") return "答案揭晓";
  return "";
}

Page({
  data: {
    pageState: "loading",
    roomType: "multi",
    questionDurationSeconds: 15,
    roomId: "",
    roomCode: "",
    artist: null,
    artistInitial: "音",
    candidateCount: 0,
    canCreateRoom: false,
    preparingSongs: false,
    creatingRoom: false,
    joiningRoom: false,
    startingRoom: false,
    submittingAnswer: false,
    profile: {
      nickName: "",
      avatarUrl: ""
    },
    showProfileGate: false,
    profileSaving: false,
    room: null,
    playerSlots: [],
    finalRankings: [],
    options: [],
    phaseText: "",
    countdownText: "",
    progressPercent: 0,
    questionNumber: 0,
    questionCount: DEFAULT_QUESTION_COUNT,
    questionCountMode: "preset",
    customQuestionCount: "",
    questionCountMax: MAX_QUESTION_COUNT,
    questionCountHint: `可以自定义 ${MIN_QUESTION_COUNT}–${MAX_QUESTION_COUNT} 道`,
    questionCountInvalid: false,
    myAccuracy: 0,
    shareReady: false,
    startButtonText: "等待好友加入",
    fatalMessage: "",
    audioStatus: "idle",
    canAnswer: false
  },

  onLoad(options = {}) {
    this.isPageAlive = true;
    this.isPageVisible = true;
    this.serverOffsetMs = 0;
    this.pollFailures = 0;
    this.pendingRoomId = safeDecode(options.roomId || "");
    this.candidateSongs = [];
    this.initAudio();

    const profile = normalizeProfile(readCachedProfile());
    const artist = getApp().globalData.introQuizArtist || null;
    this.setData({
      profile,
      artist,
      artistInitial: String((artist && artist.name) || "音").slice(0, 1),
      roomId: this.pendingRoomId
    });

    if (!isCompleteProfile(profile)) {
      this.setData({
        pageState: "profile",
        showProfileGate: true
      });
      return;
    }
    this.continueInitialFlow();
  },

  onShow() {
    this.isPageVisible = true;
    if (this.data.roomId && this.data.room) this.schedulePoll(0);
    this.startClock();
  },

  onHide() {
    this.isPageVisible = false;
    this.stopPolling();
    this.stopClock();
    this.stopAudio();
  },

  onUnload() {
    this.isPageAlive = false;
    this.isPageVisible = false;
    this.stopPolling();
    this.stopClock();
    this.destroyAudio();
  },

  initAudio() {
    this.audioReadyQuestionId = "";
    this.readyReportedQuestionId = "";
    this.audioPlaybackStartedQuestionId = "";
    this.audioPlaybackRemainingMs = 0;
    this.audioPlaybackSegmentStartedAt = 0;
    this.preloadedQuestionPaths = Object.create(null);
    this.preloadQueue = [];
    this.preloadQueuedQuestionIds = Object.create(null);
    this.preloadingQuestionId = "";
    this.nextPreloadTask = null;
    this.cueTimers = [];
    this.initCueAudio();
    if (!wx.createInnerAudioContext) return;
    const audio = wx.createInnerAudioContext();
    audio.autoplay = false;
    audio.loop = false;
    audio.obeyMuteSwitch = true;
    audio.volume = 1;
    audio.onPlay(() => {
      if (!this.isPageAlive || !this.audioQuestionId) return;
      if (this.audioPlaybackSegmentStartedAt) {
        this.setData({ audioStatus: "playing" });
        return;
      }
      if (this.audioPlaybackStartedQuestionId !== this.audioQuestionId) {
        this.audioPlaybackStartedQuestionId = this.audioQuestionId;
        this.audioPlaybackRemainingMs = Math.max(
          0,
          Number(this.pendingAudioRemainingMs || DEFAULT_PREVIEW_DURATION_MS)
        );
      }
      this.audioPlaybackSegmentStartedAt = Date.now();
      clearTimeout(this.audioStopTimer);
      this.audioStopTimer = setTimeout(
        () => {
          this.stopAudio({ preserveCues: true });
          this.enterAnswerWindow();
        },
        this.audioPlaybackRemainingMs
      );
      this.setData({ audioStatus: "playing" });
    });
    audio.onWaiting(() => {
      this.pausePlaybackClock();
      if (this.isPageAlive) this.setData({ audioStatus: "buffering" });
    });
    audio.onCanplay(() => {
      this.audioReadyQuestionId = this.audioQuestionId;
      this.reportQuestionReady();
      this.syncQuestionAudio();
      this.preloadUpcomingQuestions(this.data.room);
    });
    audio.onPause(() => this.pausePlaybackClock());
    audio.onEnded(() => {
      clearTimeout(this.audioStopTimer);
      this.audioPlaybackSegmentStartedAt = 0;
      if (this.isPageAlive) this.setData({ audioStatus: "ended" });
    });
    audio.onError((error) => {
      console.warn("intro quiz audio failed", error);
      if (this.isPageAlive) {
        this.setData({ audioStatus: "error" });
        wx.showToast({ title: "试听加载失败，请检查网络", icon: "none" });
      }
    });
    this.audio = audio;

    const preloadAudio = wx.createInnerAudioContext();
    preloadAudio.autoplay = false;
    preloadAudio.loop = false;
    preloadAudio.obeyMuteSwitch = true;
    preloadAudio.volume = 0;
    preloadAudio.onCanplay(() => {
      if (this.preloadAudioQuestionId) {
        this.warmedQuestionId = this.preloadAudioQuestionId;
      }
    });
    preloadAudio.onError(() => {});
    this.preloadAudio = preloadAudio;
  },

  initCueAudio() {
    if (!wx.createWebAudioContext) return;
    try {
      this.cueAudioContext = wx.createWebAudioContext();
    } catch (error) {
      this.cueAudioContext = null;
    }
  },

  resumeCueAudio() {
    const context = this.cueAudioContext;
    if (!context || typeof context.resume !== "function") return;
    try {
      context.resume();
    } catch (error) {}
  },

  playCueTone(frequency = 880) {
    const context = this.cueAudioContext;
    if (
      !context
      || typeof context.createOscillator !== "function"
      || typeof context.createGain !== "function"
    ) {
      if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
      return;
    }
    try {
      this.resumeCueAudio();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = Number(context.currentTime || 0);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.15);
    } catch (error) {
      if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    }
  },

  clearCueTimers() {
    (this.cueTimers || []).forEach((timer) => clearTimeout(timer));
    this.cueTimers = [];
    this.cueQuestionId = "";
    this.cueStartAtMs = 0;
    this.answerCueQuestionId = "";
    this.answerCueEndsAtMs = 0;
  },

  scheduleCountdownCues(room) {
    if (
      !room
      || room.phase !== "countdown"
      || !room.question
      || !room.questionStartedAtMs
    ) {
      return;
    }
    const questionId = room.question.id;
    const startAt = Number(room.questionStartedAtMs);
    if (this.cueQuestionId === questionId && this.cueStartAtMs === startAt) return;
    this.clearCueTimers();
    this.cueQuestionId = questionId;
    this.cueStartAtMs = startAt;
    const serverNow = Date.now() + this.serverOffsetMs;
    [startAt - 1900, startAt - 900].forEach((cueAt) => {
      const delay = cueAt - serverNow;
      if (delay < -350) return;
      const timer = setTimeout(
        () => this.playCueTone(),
        Math.max(0, delay)
      );
      this.cueTimers.push(timer);
    });
  },

  scheduleAnswerCues(room) {
    if (
      !room
      || !room.question
      || !room.answerDurationMs
      || !room.questionAudioEndsAtMs
      || !room.questionEndsAtMs
    ) {
      return;
    }
    const questionId = room.question.id;
    const answerEndsAt = Number(room.questionEndsAtMs);
    if (
      this.answerCueQuestionId === questionId
      && this.answerCueEndsAtMs === answerEndsAt
    ) {
      return;
    }
    this.clearCueTimers();
    this.answerCueQuestionId = questionId;
    this.answerCueEndsAtMs = answerEndsAt;
    const answerStartsAt = Number(room.questionAudioEndsAtMs);
    const serverNow = Date.now() + this.serverOffsetMs;
    [
      { at: answerStartsAt + 100, frequency: 740 },
      { at: answerStartsAt + 1100, frequency: 740 },
      { at: answerStartsAt + 2100, frequency: 980 }
    ].forEach((cue) => {
      const delay = cue.at - serverNow;
      if (delay < -350 || cue.at >= answerEndsAt) return;
      const timer = setTimeout(
        () => this.playCueTone(cue.frequency),
        Math.max(0, delay)
      );
      this.cueTimers.push(timer);
    });
  },

  pausePlaybackClock() {
    clearTimeout(this.audioStopTimer);
    if (!this.audioPlaybackSegmentStartedAt) return;
    const consumedMs = Math.max(0, Date.now() - this.audioPlaybackSegmentStartedAt);
    this.audioPlaybackRemainingMs = Math.max(
      0,
      this.audioPlaybackRemainingMs - consumedMs
    );
    this.audioPlaybackSegmentStartedAt = 0;
  },

  destroyAudio() {
    clearTimeout(this.audioStartTimer);
    clearTimeout(this.audioStopTimer);
    this.clearCueTimers();
    if (this.nextPreloadTask && typeof this.nextPreloadTask.abort === "function") {
      try {
        this.nextPreloadTask.abort();
      } catch (error) {}
    }
    this.nextPreloadTask = null;
    this.preloadQueue = [];
    this.preloadQueuedQuestionIds = Object.create(null);
    this.preloadedQuestionPaths = Object.create(null);
    if (this.audio) {
      try {
        this.audio.stop();
        this.audio.destroy();
      } catch (error) {}
      this.audio = null;
    }
    if (this.preloadAudio) {
      try {
        this.preloadAudio.stop();
        this.preloadAudio.destroy();
      } catch (error) {}
      this.preloadAudio = null;
    }
    if (this.cueAudioContext && typeof this.cueAudioContext.close === "function") {
      try {
        this.cueAudioContext.close();
      } catch (error) {}
    }
    this.cueAudioContext = null;
  },

  stopAudio(options = {}) {
    clearTimeout(this.audioStartTimer);
    clearTimeout(this.audioStopTimer);
    if (!options.preserveCues) this.clearCueTimers();
    this.audioPlaybackStartedQuestionId = "";
    this.audioPlaybackRemainingMs = 0;
    this.audioPlaybackSegmentStartedAt = 0;
    this.pendingAudioRemainingMs = 0;
    if (!this.audio) return;
    try {
      this.audio.stop();
    } catch (error) {}
    if (this.isPageAlive) this.setData({ audioStatus: "idle" });
  },

  preloadUpcomingQuestions(room) {
    if (!room || !this.isPageAlive) return;
    const questions = room.roomType === "solo"
      ? (room.preloadQuestions || [])
      : (room.nextQuestion ? [room.nextQuestion] : []);
    questions.forEach((question) => {
      if (
        !question
        || !question.id
        || !question.previewUrl
        || this.preloadedQuestionPaths[question.id]
        || this.preloadQueuedQuestionIds[question.id]
        || this.preloadingQuestionId === question.id
      ) {
        return;
      }
      this.preloadQueue.push(question);
      this.preloadQueuedQuestionIds[question.id] = true;
    });
    this.runNextQuestionPreload();
  },

  preloadNextQuestion(room) {
    this.preloadUpcomingQuestions(room);
  },

  runNextQuestionPreload() {
    if (
      !this.isPageAlive
      || this.preloadingQuestionId
      || !this.preloadQueue.length
      || !wx.downloadFile
    ) {
      return;
    }
    const question = this.preloadQueue.shift();
    delete this.preloadQueuedQuestionIds[question.id];
    this.preloadingQuestionId = question.id;
    this.preloadAudioQuestionId = question.id;
    if (this.data.roomType !== "solo" && this.preloadAudio) {
      try {
        this.preloadAudio.src = question.previewUrl;
      } catch (error) {}
    }
    const task = wx.downloadFile({
      url: question.previewUrl,
      success: (res) => {
        if (
          this.isPageAlive
          && this.preloadingQuestionId === question.id
          && Number(res.statusCode || 0) === 200
          && res.tempFilePath
        ) {
          this.preloadedQuestionPaths[question.id] = res.tempFilePath;
        }
      },
      complete: () => {
        if (this.preloadingQuestionId === question.id) {
          this.preloadingQuestionId = "";
          this.nextPreloadTask = null;
          this.runNextQuestionPreload();
        }
      }
    });
    this.nextPreloadTask = task;
  },

  enterAnswerWindow(room = this.data.room) {
    if (!room || !room.question || !this.isPageAlive) return;
    if (!Number(room.answerDurationMs || 0)) {
      this.preloadNextQuestion(room);
      this.schedulePoll(0);
      return;
    }
    const serverNow = Date.now() + this.serverOffsetMs;
    if (
      serverNow < Number(room.questionAudioEndsAtMs || 0) - 250
      || serverNow >= Number(room.questionEndsAtMs || 0)
    ) {
      return;
    }
    const answerRoom = room.phase === "answering"
      ? room
      : { ...room, phase: "answering" };
    if (room.phase !== "answering") {
      this.setData({
        room: answerRoom,
        phaseText: phaseCopy(answerRoom),
        canAnswer: !answerRoom.myAnswer
      });
    }
    this.scheduleAnswerCues(answerRoom);
    this.preloadNextQuestion(answerRoom);
    this.updateClock();
  },

  continueInitialFlow() {
    if (this.pendingRoomId) {
      this.joinSharedRoom(this.pendingRoomId);
      return;
    }
    if (!this.data.artist) {
      this.setData({
        pageState: "error",
        fatalMessage: "还没有选择歌手"
      });
      return;
    }
    this.prepareSongs();
  },

  onChooseAvatar(event) {
    this.setData({
      profile: {
        ...this.data.profile,
        avatarUrl: event.detail.avatarUrl
      }
    });
  },

  onNicknameInput(event) {
    this.setData({
      profile: {
        ...this.data.profile,
        nickName: event.detail.value
      }
    });
  },

  confirmProfile() {
    const profile = normalizeProfile(this.data.profile);
    if (!isCompleteProfile(profile) || this.data.profileSaving) {
      wx.showToast({ title: "请先填写昵称并选择头像", icon: "none" });
      return;
    }
    this.setData({ profileSaving: true });
    saveAccountProfile(profile)
      .then((savedProfile) => {
        const nextProfile = cacheAccountProfile(savedProfile || profile);
        this.setData({
          profile: nextProfile,
          showProfileGate: false,
          profileSaving: false
        });
        this.continueInitialFlow();
      })
      .catch(() => {
        const nextProfile = cacheAccountProfile(profile);
        this.setData({
          profile: nextProfile,
          showProfileGate: false,
          profileSaving: false
        });
        this.continueInitialFlow();
      });
  },

  prepareSongs() {
    if (this.data.preparingSongs) return;
    this.setData({
      pageState: "setup",
      preparingSongs: true,
      canCreateRoom: false,
      questionCountHint: "正在计算当前曲库可出的题数",
      questionCountInvalid: false,
      fatalMessage: ""
    });
    searchSongs(this.data.artist, "")
      .then((result) => {
        const songs = (result.songs || [])
          .map(normalizeCandidateSong)
          .filter((song) => song.id && song.name && song.previewUrl);
        this.candidateSongs = songs;
        const maxForCurrentArtist = Math.max(
          0,
          Math.min(
            MAX_QUESTION_COUNT,
            Math.min(MAX_CANDIDATE_SONGS, songs.length) - 3
          )
        );
        let selectedQuestionCount = this.data.questionCount;
        let questionCountMode = this.data.questionCountMode;
        let customQuestionCount = this.data.customQuestionCount;
        if (
          maxForCurrentArtist >= MIN_QUESTION_COUNT
          && (
            selectedQuestionCount < MIN_QUESTION_COUNT
            || selectedQuestionCount > maxForCurrentArtist
          )
        ) {
          selectedQuestionCount = maxForCurrentArtist >= DEFAULT_QUESTION_COUNT
            ? DEFAULT_QUESTION_COUNT
            : MIN_QUESTION_COUNT;
          questionCountMode = "preset";
          customQuestionCount = "";
        }
        const countState = questionCountState(
          selectedQuestionCount,
          songs.length,
          false
        );
        this.setData({
          candidateCount: songs.length,
          preparingSongs: false,
          questionCountMode,
          customQuestionCount,
          ...countState
        });
        if (maxForCurrentArtist < MIN_QUESTION_COUNT) {
          this.setData({
            fatalMessage: `只找到 ${songs.length} 首可试听歌曲，至少需要 ${MIN_QUESTION_COUNT + 3} 首`
          });
        }
      })
      .catch((error) => {
        this.setData({
          preparingSongs: false,
          canCreateRoom: false,
          fatalMessage: (error && error.message) || "歌曲读取失败"
        });
      });
  },

  createRoom() {
    const questionCount = Number(this.data.questionCount);
    if (
      this.data.creatingRoom
      || !this.data.canCreateRoom
      || questionCount < MIN_QUESTION_COUNT
      || questionCount > this.data.questionCountMax
    ) {
      return;
    }
    this.resumeCueAudio();
    this.setData({ creatingRoom: true });
    createIntroQuiz({
      profile: this.data.profile,
      artist: this.data.artist,
      roomType: this.data.roomType,
      questionDurationMs: this.data.questionDurationSeconds * 1000,
      questionCount,
      songs: this.candidateSongs
    }).then((result) => {
      const room = result.room;
      this.pendingRoomId = room.roomId;
      this.setData({
      roomId: room.roomId,
      roomCode: String(room.roomId || "").slice(-6).toUpperCase(),
      creatingRoom: false,
        shareReady: true
      });
      this.applyRoom(room);
      if (room.roomType === "solo") {
        this.startCreatedSoloRoom(room.roomId);
      } else {
        this.schedulePoll();
      }
    }).catch((error) => {
      this.setData({ creatingRoom: false });
      wx.showModal({
        title: "房间没有建好",
        content: (error && error.message) || "请稍后重试",
        showCancel: false
      });
    });
  },

  selectRoomType(event) {
    if (this.data.creatingRoom) return;
    const roomType = event.currentTarget.dataset.roomType === "solo"
      ? "solo"
      : "multi";
    this.setData({
      roomType
    });
  },

  selectQuestionDuration(event) {
    if (this.data.creatingRoom) return;
    const seconds = Number(event.currentTarget.dataset.seconds);
    if (!DURATION_OPTIONS_SECONDS.includes(seconds)) return;
    this.setData({
      questionDurationSeconds: seconds
    });
  },

  selectQuestionCount(event) {
    if (this.data.creatingRoom) return;
    const count = Number(event.currentTarget.dataset.count);
    if (![5, 8, 15].includes(count) || count > this.data.questionCountMax) return;
    this.setData({
      questionCountMode: "preset",
      customQuestionCount: "",
      ...questionCountState(count, this.data.candidateCount, false)
    });
  },

  activateCustomQuestionCount() {
    if (this.data.creatingRoom || this.data.questionCountMode === "custom") return;
    this.setData({
      questionCountMode: "custom",
      customQuestionCount: "",
      ...questionCountState(0, this.data.candidateCount, false)
    });
  },

  onCustomQuestionCountInput(event) {
    if (this.data.creatingRoom) return;
    const raw = String(event.detail.value || "")
      .replace(/\D/g, "")
      .slice(0, 2);
    const count = raw ? Number(raw) : 0;
    this.setData({
      questionCountMode: "custom",
      customQuestionCount: raw,
      ...questionCountState(count, this.data.candidateCount, false)
    });
  },

  startCreatedSoloRoom(roomId) {
    this.setData({ startingRoom: true });
    startIntroQuiz({ roomId })
      .then((result) => {
        this.setData({ startingRoom: false });
        this.applyRoom(result.room);
        this.schedulePoll(0);
      })
      .catch((error) => {
        this.setData({ startingRoom: false });
        wx.showToast({
          title: (error && error.message) || "单人练习没有开始",
          icon: "none"
        });
      });
  },

  joinSharedRoom(roomId) {
    if (this.data.joiningRoom) return;
    this.setData({
      pageState: "loading",
      joiningRoom: true,
      fatalMessage: ""
    });
    joinIntroQuiz({
      roomId,
      profile: this.data.profile
    }).then((result) => {
      this.setData({
        roomId,
        roomCode: String(roomId || "").slice(-6).toUpperCase(),
        joiningRoom: false,
        shareReady: true
      });
      this.applyRoom(result.room);
      this.schedulePoll();
    }).catch((error) => {
      this.setData({
        joiningRoom: false,
        pageState: "error",
        fatalMessage: (error && error.message) || "加入房间失败"
      });
    });
  },

  startRoom() {
    const room = this.data.room;
    if (!room || !room.canStart || !room.isHost || this.data.startingRoom) return;
    this.resumeCueAudio();
    this.setData({ startingRoom: true });
    startIntroQuiz({ roomId: room.roomId })
      .then((result) => {
        this.setData({ startingRoom: false });
        this.applyRoom(result.room);
        this.schedulePoll(0);
      })
      .catch((error) => {
        this.setData({ startingRoom: false });
        wx.showToast({
          title: (error && error.message) || "暂时无法开始",
          icon: "none"
        });
      });
  },

  chooseOption(event) {
    const room = this.data.room;
    const optionId = String(event.currentTarget.dataset.optionId || "");
    if (
      !room
      || (
        room.phase !== "answering"
        && !(room.phase === "playing" && canAnswerDuringPlayback(room))
      )
      || !this.data.canAnswer
      || room.myAnswer
      || this.data.submittingAnswer
      || !optionId
    ) {
      return;
    }
    this.setData({ submittingAnswer: true });
    answerIntroQuiz({
      roomId: room.roomId,
      questionId: room.question.id,
      optionId
    }).then((result) => {
      this.setData({ submittingAnswer: false });
      this.applyRoom(result.room);
      this.schedulePoll(0);
    }).catch((error) => {
      this.setData({ submittingAnswer: false });
      wx.showToast({
        title: (error && error.message) || "答案没有提交成功",
        icon: "none"
      });
      this.schedulePoll(0);
    });
  },

  schedulePoll(delay = POLL_INTERVAL_MS) {
    this.stopPolling();
    if (
      !this.isPageAlive
      || !this.isPageVisible
      || !this.data.roomId
      || (this.data.room && this.data.room.status === "finished")
    ) {
      return;
    }
    this.pollTimer = setTimeout(() => this.pollRoom(), delay);
  },

  stopPolling() {
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  },

  pollRoom() {
    if (this.pollPromise || !this.data.roomId || !this.isPageVisible) return;
    this.pollPromise = getIntroQuizState({ roomId: this.data.roomId })
      .then((result) => {
        this.pollFailures = 0;
        this.applyRoom(result.room);
      })
      .catch((error) => {
        this.pollFailures += 1;
        console.warn("sync intro quiz room failed", error);
        if (this.pollFailures === 3) {
          wx.showToast({ title: "正在重新连接房间", icon: "none" });
        }
      })
      .finally(() => {
        this.pollPromise = null;
        this.schedulePoll(this.pollFailures ? 1800 : POLL_INTERVAL_MS);
      });
  },

  applyRoom(room) {
    if (!room || !this.isPageAlive) return;
    this.serverOffsetMs = Number(room.serverNow || Date.now()) - Date.now();
    const previousRoom = this.data.room || {};
    const previousQuestionId = previousRoom.question && previousRoom.question.id;
    const currentQuestionId = room.question && room.question.id;
    const players = room.players || [];
    const maxPlayers = Math.max(1, Number(room.maxPlayers || 2));
    const playerSlots = Array.from({ length: maxPlayers }, (_, slot) => {
      const player = players[slot];
      if (!player) {
        return {
          slot,
          empty: true,
          name: "等待好友",
          avatarText: "?"
        };
      }
      const name = String((player.profile || {}).nickName || "神秘听众");
      return {
        ...player,
        empty: false,
        name,
        avatarUrl: (player.profile || {}).avatarUrl || "",
        avatarText: name.slice(0, 1),
        scoreText: `${Number(player.score || 0)} 分`
      };
    });
    const options = ((room.question && room.question.options) || []).map((option, index) => ({
      ...option,
      letter: ["A", "B", "C", "D"][index] || "",
      stateClass: optionClass(option, room),
      resultMark: optionResultMark(option, room)
    }));
    const me = players.find((player) => player.isMe);
    const myAccuracy = room.questionCount
      ? Math.round((Number((me && me.score) || 0) / room.questionCount) * 100)
      : 0;
    const pageState = room.status === "waiting"
      ? "waiting"
      : (room.status === "finished" ? "finished" : "game");
    const questionDurationSeconds = Math.round(
      Number(room.questionDurationMs || DEFAULT_PREVIEW_DURATION_MS) / 1000
    );

    const finalRankings = playerSlots
      .filter((player) => !player.empty)
      .slice()
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .map((player, index) => ({
        ...player,
        rank: index + 1
      }));

    if (room.status === "finished") {
      this.saveFinishedRoomHistory(room, myAccuracy);
    }

    this.setData({
      pageState,
      room,
      roomType: room.roomType || this.data.roomType,
      questionDurationSeconds,
      artist: room.artist || this.data.artist,
      artistInitial: String(((room.artist || this.data.artist || {}).name) || "音").slice(0, 1),
      playerSlots,
      finalRankings,
      options,
      phaseText: phaseCopy(room),
      startButtonText: room.canStart
        ? `${players.length} 人已到，开始`
        : `至少 ${room.minPlayers || 2} 人开局`,
      questionNumber: Math.min(room.currentIndex + 1, room.questionCount),
      questionCount: room.questionCount,
      myAccuracy,
      canAnswer: (
        (
          room.phase === "answering"
          || (room.phase === "playing" && canAnswerDuringPlayback(room))
        )
        && !room.myAnswer
      )
    });

    if (room.status === "finished" || room.phase === "reveal") {
      this.stopAudio();
    } else if (currentQuestionId && currentQuestionId !== previousQuestionId) {
      this.prepareQuestionAudio(room);
    } else if (currentQuestionId) {
      this.syncQuestionAudio();
    }
    this.updateClock();
  },

  saveFinishedRoomHistory(room, myAccuracy) {
    if (!room || !room.roomId || this.savedHistoryRoomId === room.roomId) return;
    const players = room.players || [];
    const host = players.find((player) => player.isHost) || {};
    const me = players.find((player) => player.isMe) || {};
    const artist = room.artist || {};
    const challengeId = `introQuiz:${room.roomId}`;
    const saved = saveParticipatedResult({
      challengeId,
      mode: "introQuiz",
      challenge: {
        challengeId,
        mode: "introQuiz",
        artists: [artist],
        creatorProfile: host.profile || {},
        createdAt: Date.now()
      },
      creatorProfile: host.profile || {},
      friendProfile: me.profile || this.data.profile || {},
      result: {
        mode: "introQuiz",
        score: myAccuracy,
        matchCount: Number(me.score || 0),
        totalCount: Number(room.questionCount || 0),
        resultCopy: `${Number(room.questionDurationMs || DEFAULT_PREVIEW_DURATION_MS) / 1000} 秒片段 · ${Number(room.questionCount || 0)} 题`
      },
      resultCopy: `${Number(room.questionDurationMs || DEFAULT_PREVIEW_DURATION_MS) / 1000} 秒片段 · ${Number(room.questionCount || 0)} 题`,
      savedAt: Date.now()
    });
    if (saved) this.savedHistoryRoomId = room.roomId;
  },

  prepareQuestionAudio(room) {
    this.stopAudio();
    if (!this.audio || !room.question || !room.question.previewUrl) return;
    this.audioQuestionId = room.question.id;
    this.audioReadyQuestionId = "";
    this.readyReportedQuestionId = "";
    this.audioPlaybackStartedQuestionId = "";
    this.audioPlaybackRemainingMs = 0;
    this.audioPlaybackSegmentStartedAt = 0;
    this.pendingAudioRemainingMs = 0;
    this.audioStartAtMs = Number(room.questionStartedAtMs || 0);
    this.audioEndAtMs = Number(room.questionAudioEndsAtMs || 0);
    const preloadedQuestionPath = this.preloadedQuestionPaths[room.question.id] || "";
    this.audio.src = preloadedQuestionPath
      ? preloadedQuestionPath
      : room.question.previewUrl;
    if (preloadedQuestionPath) {
      delete this.preloadedQuestionPaths[room.question.id];
    }
    this.setData({ audioStatus: "loading" });
    this.syncQuestionAudio();
  },

  reportQuestionReady() {
    const room = this.data.room;
    if (
      !this.isPageAlive
      || !room
      || room.status !== "playing"
      || !room.question
      || room.question.id !== this.audioReadyQuestionId
      || this.readyReportedQuestionId === room.question.id
      || this.readyPromise
    ) {
      return;
    }
    const questionId = room.question.id;
    this.readyReportedQuestionId = questionId;
    this.readyPromise = readyIntroQuiz({
      roomId: room.roomId,
      questionId
    }).then((result) => {
      if (this.isPageAlive && result && result.room) {
        this.applyRoom(result.room);
        this.schedulePoll(0);
      }
    }).catch((error) => {
      console.warn("report intro quiz audio ready failed", error);
      if (this.readyReportedQuestionId === questionId) {
        this.readyReportedQuestionId = "";
      }
      setTimeout(() => this.reportQuestionReady(), 900);
    }).finally(() => {
      this.readyPromise = null;
    });
  },

  syncQuestionAudio() {
    const room = this.data.room;
    if (
      !this.audio
      || !room
      || !room.question
      || room.question.id !== this.audioQuestionId
      || room.status !== "playing"
      || room.phase === "reveal"
    ) {
      return;
    }
    clearTimeout(this.audioStartTimer);
    if (room.phase === "preparing" || !room.questionStartedAtMs) {
      if (this.audioReadyQuestionId === room.question.id) {
        this.reportQuestionReady();
      }
      return;
    }
    if (room.phase === "answering") {
      this.stopAudio({ preserveCues: true });
      this.enterAnswerWindow(room);
      return;
    }
    this.scheduleCountdownCues(room);
    const now = Date.now() + this.serverOffsetMs;
    const startAt = Number(room.questionStartedAtMs || 0);
    const endAt = Number(room.questionAudioEndsAtMs || 0);
    if (now >= endAt) {
      this.stopAudio({ preserveCues: true });
      this.enterAnswerWindow(room);
      return;
    }
    if (now < startAt) {
      this.audioStartTimer = setTimeout(
        () => this.syncQuestionAudio(),
        Math.max(0, startAt - now)
      );
      return;
    }
    if (this.data.audioStatus === "playing") return;

    const questionDurationMs = Number(
      room.questionDurationMs || DEFAULT_PREVIEW_DURATION_MS
    );
    const maxElapsedSeconds = Math.max(0, (questionDurationMs / 1000) - 0.5);
    const elapsedSeconds = Math.max(
      0,
      Math.min(maxElapsedSeconds, (now - startAt) / 1000)
    );
    this.pendingAudioRemainingMs = Math.max(
      0,
      questionDurationMs - (elapsedSeconds * 1000)
    );
    try {
      if (elapsedSeconds > 0.25) this.audio.seek(elapsedSeconds);
      this.audio.play();
    } catch (error) {}
  },

  startClock() {
    if (this.clockTimer) return;
    this.updateClock();
    this.clockTimer = setInterval(() => this.updateClock(), CLOCK_INTERVAL_MS);
  },

  stopClock() {
    clearInterval(this.clockTimer);
    this.clockTimer = null;
  },

  updateClock() {
    const room = this.data.room;
    if (!room || room.status !== "playing") return;
    const now = Date.now() + this.serverOffsetMs;
    let countdownText = "";
    let progressPercent = 0;
    let canAnswer = false;
    if (room.phase === "preparing") {
      countdownText = "···";
      progressPercent = 0;
    } else if (room.phase === "countdown") {
      countdownText = String(Math.max(1, Math.ceil((room.questionStartedAtMs - now) / 1000)));
      progressPercent = 0;
    } else if (room.phase === "playing") {
      const remaining = Math.max(0, room.questionAudioEndsAtMs - now);
      const questionDurationMs = Number(
        room.questionDurationMs || DEFAULT_PREVIEW_DURATION_MS
      );
      countdownText = `${Math.ceil(remaining / 1000)}s`;
      progressPercent = Math.max(
        0,
        Math.min(100, ((now - room.questionStartedAtMs) / questionDurationMs) * 100)
      );
      canAnswer = (
        canAnswerDuringPlayback(room)
        && remaining > 0
        && !room.myAnswer
      );
      if (!Number(room.answerDurationMs || 0) && remaining <= 3000) {
        this.preloadNextQuestion(room);
      }
    } else if (room.phase === "answering") {
      const remaining = Math.max(0, room.questionEndsAtMs - now);
      countdownText = `${Math.ceil(remaining / 1000)}s`;
      progressPercent = Math.max(
        0,
        Math.min(100, (remaining / Number(room.answerDurationMs || 3000)) * 100)
      );
      canAnswer = remaining > 0 && !room.myAnswer;
      this.scheduleAnswerCues(room);
      this.preloadNextQuestion(room);
      if (!remaining) this.schedulePoll(0);
    } else if (room.phase === "reveal") {
      countdownText = "✓";
      progressPercent = 100;
    }
    this.setData({
      countdownText,
      progressPercent,
      canAnswer
    });
  },

  retrySetup() {
    if (this.data.roomId) {
      this.joinSharedRoom(this.data.roomId);
      return;
    }
    this.prepareSongs();
  },

  backHome() {
    wx.reLaunch({ url: "/pages/home/home" });
  },

  chooseAnotherArtist() {
    getApp().globalData.introQuizArtist = null;
    wx.redirectTo({ url: "/pages/artists/artists?mode=introQuiz" });
  },

  onShareAppMessage() {
    const roomId = this.data.roomId;
    const name = String((this.data.profile || {}).nickName || "好友");
    if (!roomId) {
      return {
        title: "来玩片段猜歌挑战，看看谁认得更快",
        path: "/pages/home/home"
      };
    }
    return {
      title: `${name} 邀请你来玩片段猜歌挑战`,
      path: `/pages/intro-quiz/intro-quiz?roomId=${encodeURIComponent(roomId)}`
    };
  }
});
