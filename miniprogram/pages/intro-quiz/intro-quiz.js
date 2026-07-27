const {
  answerIntroQuiz,
  createIntroQuiz,
  getIntroQuizState,
  joinIntroQuiz,
  searchSongs,
  startIntroQuiz
} = require("../../utils/api");
const {
  cacheAccountProfile,
  isCompleteProfile,
  readCachedProfile,
  saveAccountProfile
} = require("../../utils/profile");

const QUESTION_COUNT = 8;
const POLL_INTERVAL_MS = 900;
const CLOCK_INTERVAL_MS = 200;
const PREVIEW_DURATION_MS = 15000;

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

function phaseCopy(room) {
  if (!room) return "";
  if (room.phase === "countdown") return "把声音打开，马上开始";
  if (room.phase === "playing") {
    return room.myAnswer ? "答案已锁定，等对方作答" : "听前 15 秒，选出这首歌";
  }
  if (room.phase === "reveal") return "答案揭晓";
  return "";
}

Page({
  data: {
    pageState: "loading",
    roomId: "",
    roomCode: "",
    artist: null,
    artistInitial: "音",
    candidateCount: 0,
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
    questionCount: QUESTION_COUNT,
    myAccuracy: 0,
    shareReady: false,
    fatalMessage: "",
    audioStatus: "idle"
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
    if (!wx.createInnerAudioContext) return;
    const audio = wx.createInnerAudioContext();
    audio.autoplay = false;
    audio.loop = false;
    audio.obeyMuteSwitch = true;
    audio.volume = 1;
    audio.onPlay(() => {
      if (this.isPageAlive) this.setData({ audioStatus: "playing" });
    });
    audio.onWaiting(() => {
      if (this.isPageAlive) this.setData({ audioStatus: "buffering" });
    });
    audio.onCanplay(() => this.syncQuestionAudio());
    audio.onEnded(() => {
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
  },

  destroyAudio() {
    clearTimeout(this.audioStartTimer);
    clearTimeout(this.audioStopTimer);
    if (!this.audio) return;
    try {
      this.audio.stop();
      this.audio.destroy();
    } catch (error) {}
    this.audio = null;
  },

  stopAudio() {
    clearTimeout(this.audioStartTimer);
    clearTimeout(this.audioStopTimer);
    if (!this.audio) return;
    try {
      this.audio.stop();
    } catch (error) {}
    if (this.isPageAlive) this.setData({ audioStatus: "idle" });
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
      fatalMessage: ""
    });
    searchSongs(this.data.artist, "")
      .then((result) => {
        const songs = (result.songs || [])
          .map(normalizeCandidateSong)
          .filter((song) => song.id && song.name && song.previewUrl);
        this.candidateSongs = songs;
        this.setData({
          candidateCount: songs.length,
          preparingSongs: false
        });
        if (songs.length < QUESTION_COUNT + 3) {
          this.setData({
            fatalMessage: `只找到 ${songs.length} 首可试听歌曲，暂时不能组成 ${QUESTION_COUNT} 题`
          });
        }
      })
      .catch((error) => {
        this.setData({
          preparingSongs: false,
          fatalMessage: (error && error.message) || "歌曲读取失败"
        });
      });
  },

  createRoom() {
    if (
      this.data.creatingRoom
      || this.candidateSongs.length < QUESTION_COUNT + 3
    ) {
      return;
    }
    this.setData({ creatingRoom: true });
    createIntroQuiz({
      profile: this.data.profile,
      artist: this.data.artist,
      questionCount: QUESTION_COUNT,
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
      this.schedulePoll();
    }).catch((error) => {
      this.setData({ creatingRoom: false });
      wx.showModal({
        title: "房间没有建好",
        content: (error && error.message) || "请稍后重试",
        showCancel: false
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
      || room.phase !== "playing"
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
    const playerSlots = [0, 1].map((slot) => {
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
      stateClass: optionClass(option, room)
    }));
    const me = players.find((player) => player.isMe);
    const myAccuracy = room.questionCount
      ? Math.round((Number((me && me.score) || 0) / room.questionCount) * 100)
      : 0;
    const pageState = room.status === "waiting"
      ? "waiting"
      : (room.status === "finished" ? "finished" : "game");

    const finalRankings = playerSlots
      .filter((player) => !player.empty)
      .slice()
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .map((player, index) => ({
        ...player,
        rank: index + 1
      }));

    this.setData({
      pageState,
      room,
      artist: room.artist || this.data.artist,
      artistInitial: String(((room.artist || this.data.artist || {}).name) || "音").slice(0, 1),
      playerSlots,
      finalRankings,
      options,
      phaseText: phaseCopy(room),
      questionNumber: Math.min(room.currentIndex + 1, room.questionCount),
      questionCount: room.questionCount,
      myAccuracy
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

  prepareQuestionAudio(room) {
    this.stopAudio();
    if (!this.audio || !room.question || !room.question.previewUrl) return;
    this.audioQuestionId = room.question.id;
    this.audioStartAtMs = Number(room.questionStartedAtMs || 0);
    this.audioEndAtMs = Number(room.questionEndsAtMs || 0);
    this.audio.src = room.question.previewUrl;
    this.setData({ audioStatus: "loading" });
    this.syncQuestionAudio();
  },

  syncQuestionAudio() {
    const room = this.data.room;
    if (
      !this.audio
      || !room
      || !room.question
      || room.question.id !== this.audioQuestionId
      || room.phase === "reveal"
      || room.status === "finished"
    ) {
      return;
    }
    clearTimeout(this.audioStartTimer);
    clearTimeout(this.audioStopTimer);
    const now = Date.now() + this.serverOffsetMs;
    const startAt = Number(room.questionStartedAtMs || 0);
    const endAt = Number(room.questionEndsAtMs || 0);
    if (!startAt || now >= endAt) {
      this.stopAudio();
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

    const elapsedSeconds = Math.max(0, Math.min(14.5, (now - startAt) / 1000));
    try {
      if (elapsedSeconds > 0.25) this.audio.seek(elapsedSeconds);
      this.audio.play();
    } catch (error) {}
    this.audioStopTimer = setTimeout(
      () => this.stopAudio(),
      Math.max(0, Math.min(PREVIEW_DURATION_MS, endAt - now))
    );
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
    if (room.phase === "countdown") {
      countdownText = String(Math.max(1, Math.ceil((room.questionStartedAtMs - now) / 1000)));
      progressPercent = 0;
    } else if (room.phase === "playing") {
      const remaining = Math.max(0, room.questionEndsAtMs - now);
      countdownText = `${Math.ceil(remaining / 1000)}s`;
      progressPercent = Math.max(
        0,
        Math.min(100, ((now - room.questionStartedAtMs) / PREVIEW_DURATION_MS) * 100)
      );
    } else if (room.phase === "reveal") {
      countdownText = "✓";
      progressPercent = 100;
    }
    this.setData({
      countdownText,
      progressPercent
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
        title: "来听前奏猜歌，看看谁认得更快",
        path: "/pages/home/home"
      };
    }
    return {
      title: `${name} 邀请你来听前奏猜歌`,
      path: `/pages/intro-quiz/intro-quiz?roomId=${encodeURIComponent(roomId)}`
    };
  }
});
