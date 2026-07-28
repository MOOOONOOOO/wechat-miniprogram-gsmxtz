const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = "introQuizRooms";
const DEFAULT_QUESTION_DURATION_MS = 15000;
const QUESTION_DURATION_OPTIONS_MS = [3000, 5000, 10000, 15000];
const QUESTION_LEAD_IN_MS = 2000;
const PREPARATION_TIMEOUT_MS = 8000;
const SHORT_CLIP_ANSWER_DURATION_MS = 3000;
const REVEAL_DURATION_MS = 2200;
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUESTION_COUNT = 8;
const MIN_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 30;
const MAX_CANDIDATE_SONGS = 36;
const MIN_MULTIPLAYER_PLAYERS = 2;
const MAX_MULTIPLAYER_PLAYERS = 5;

function normalizeRoomType(value) {
  return value === "solo" ? "solo" : "multi";
}

function normalizeQuestionDurationMs(value) {
  const duration = Number(value);
  return QUESTION_DURATION_OPTIONS_MS.includes(duration)
    ? duration
    : DEFAULT_QUESTION_DURATION_MS;
}

function answerDurationMs(room) {
  return normalizeQuestionDurationMs(room && room.questionDurationMs) <= 10000
    ? SHORT_CLIP_ANSWER_DURATION_MS
    : 0;
}

function minimumPlayers(room) {
  return normalizeRoomType(room && room.roomType) === "solo"
    ? 1
    : MIN_MULTIPLAYER_PLAYERS;
}

function maximumPlayers(room) {
  return normalizeRoomType(room && room.roomType) === "solo"
    ? 1
    : MAX_MULTIPLAYER_PLAYERS;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeProfile(profile = {}) {
  return {
    nickName: cleanText(profile.nickName, 20) || "神秘听众",
    avatarUrl: cleanText(profile.avatarUrl, 500)
  };
}

function allowedPreviewUrl(value) {
  const previewUrl = cleanText(value, 1000);
  if (!previewUrl) return "";
  try {
    const parsed = new URL(previewUrl);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return "";
    if (host === "apple.com" || host.endsWith(".apple.com")) return previewUrl;
    return "";
  } catch (error) {
    return "";
  }
}

function normalizeSong(song = {}) {
  const trackId = cleanText(song.trackId || song.songId || song.id, 80);
  const name = cleanText(song.name || song.trackName, 100);
  const previewUrl = allowedPreviewUrl(song.previewUrl || song.preview);
  if (!trackId || !name || !previewUrl) return null;
  return {
    id: trackId,
    name,
    album: cleanText(song.album || song.collectionName, 100),
    cover: cleanText(
      song.cover
      || song.artworkUrl600
      || song.artworkUrl100
      || song.albumCover,
      500
    ),
    previewUrl
  };
}

function uniqueSongs(songs) {
  const seen = {};
  return (Array.isArray(songs) ? songs : [])
    .map(normalizeSong)
    .filter((song) => {
      if (!song || seen[song.id]) return false;
      seen[song.id] = true;
      return true;
    })
    .slice(0, MAX_CANDIDATE_SONGS);
}

function shuffled(list) {
  const result = (list || []).slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }
  return result;
}

function buildQuestions(songs, requestedCount) {
  const requested = Math.floor(Number(requestedCount) || DEFAULT_QUESTION_COUNT);
  const safeCount = Math.max(
    MIN_QUESTION_COUNT,
    Math.min(MAX_QUESTION_COUNT, requested)
  );
  if (songs.length < safeCount + 3) {
    throw new Error(`至少需要 ${safeCount + 3} 首可试听歌曲`);
  }

  const correctSongs = shuffled(songs).slice(0, safeCount);
  return correctSongs.map((correct, index) => {
    const distractors = shuffled(
      songs.filter((song) => song.id !== correct.id)
    ).slice(0, 3);
    const options = shuffled([correct, ...distractors]).map((song) => ({
      id: song.id,
      name: song.name
    }));
    return {
      id: `q${index + 1}`,
      previewUrl: correct.previewUrl,
      correctOptionId: correct.id,
      options
    };
  });
}

function playerAnswerForQuestion(player, questionId) {
  return ((player && player.answers) || [])
    .find((answer) => answer.questionId === questionId) || null;
}

function allPlayersAnswered(room, questionId) {
  const players = room.players || [];
  return players.length >= minimumPlayers(room)
    && players.every((player) => playerAnswerForQuestion(player, questionId));
}

function allPlayersReady(room, questionId) {
  const players = room.players || [];
  return players.length >= minimumPlayers(room)
    && players.every((player) => player.readyQuestionId === questionId);
}

async function settleRoom(room, now) {
  if (!room || room.status !== "playing") return room;
  const questions = room.questions || [];
  const question = questions[room.currentIndex];
  if (!question) {
    await db.collection(ROOMS_COLLECTION).doc(room._id).update({
      data: {
        status: "finished",
        finishedAtMs: now,
        updatedAtMs: now
      }
    });
    return {
      ...room,
      status: "finished",
      finishedAtMs: now,
      updatedAtMs: now
    };
  }

  if (!room.questionStartedAtMs) {
    const preparationExpired = now - Number(
      room.preparingStartedAtMs || room.updatedAtMs || now
    )
      >= PREPARATION_TIMEOUT_MS;
    if (!allPlayersReady(room, question.id) && !preparationExpired) return room;
    const questionStartedAtMs = now + QUESTION_LEAD_IN_MS;
    const questionAudioEndsAtMs = questionStartedAtMs
      + normalizeQuestionDurationMs(room.questionDurationMs);
    const questionEndsAtMs = questionAudioEndsAtMs + answerDurationMs(room);
    await db.collection(ROOMS_COLLECTION).doc(room._id).update({
      data: {
        questionStartedAtMs,
        questionAudioEndsAtMs,
        questionEndsAtMs,
        updatedAtMs: now
      }
    });
    return {
      ...room,
      questionStartedAtMs,
      questionAudioEndsAtMs,
      questionEndsAtMs,
      updatedAtMs: now
    };
  }

  if (room.revealUntilMs) {
    if (now < room.revealUntilMs) return room;
    const nextIndex = room.currentIndex + 1;
    if (nextIndex >= questions.length) {
      await db.collection(ROOMS_COLLECTION).doc(room._id).update({
        data: {
          status: "finished",
          finishedAtMs: now,
          revealUntilMs: 0,
          updatedAtMs: now
        }
      });
      return {
        ...room,
        status: "finished",
        finishedAtMs: now,
        revealUntilMs: 0,
        updatedAtMs: now
      };
    }
    await db.collection(ROOMS_COLLECTION).doc(room._id).update({
      data: {
        currentIndex: nextIndex,
        questionStartedAtMs: 0,
        questionAudioEndsAtMs: 0,
        questionEndsAtMs: 0,
        preparingStartedAtMs: now,
        revealUntilMs: 0,
        updatedAtMs: now
      }
    });
    return {
      ...room,
      currentIndex: nextIndex,
      questionStartedAtMs: 0,
      questionAudioEndsAtMs: 0,
      questionEndsAtMs: 0,
      preparingStartedAtMs: now,
      revealUntilMs: 0,
      updatedAtMs: now
    };
  }

  if (now >= room.questionEndsAtMs) {
    const revealUntilMs = now + REVEAL_DURATION_MS;
    await db.collection(ROOMS_COLLECTION).doc(room._id).update({
      data: {
        revealUntilMs,
        updatedAtMs: now
      }
    });
    return {
      ...room,
      revealUntilMs,
      updatedAtMs: now
    };
  }
  return room;
}

function publicRoom(room, openId, now) {
  const players = (room.players || []).map((player, index) => {
    const question = (room.questions || [])[room.currentIndex] || {};
    return {
      slot: index,
      profile: normalizeProfile(player.profile),
      score: Number(player.score || 0),
      answeredCurrent: Boolean(playerAnswerForQuestion(player, question.id)),
      isMe: player.openId === openId,
      isHost: player.openId === room.hostOpenId
    };
  });
  const me = (room.players || []).find((player) => player.openId === openId);
  const question = (room.questions || [])[room.currentIndex] || null;
  const myAnswer = question ? playerAnswerForQuestion(me, question.id) : null;
  const revealing = Boolean(
    room.status === "playing"
    && room.revealUntilMs
    && now < room.revealUntilMs
  );
  let phase = room.status;
  if (room.status === "playing") {
    if (revealing) phase = "reveal";
    else if (!room.questionStartedAtMs) phase = "preparing";
    else if (now < room.questionStartedAtMs) phase = "countdown";
    else if (now < room.questionAudioEndsAtMs) phase = "playing";
    else if (answerDurationMs(room) && now < room.questionEndsAtMs) phase = "answering";
    else phase = answerDurationMs(room) ? "answering" : "playing";
  }
  const nextQuestion = (room.questions || [])[Number(room.currentIndex || 0) + 1] || null;

  return {
    roomId: room._id,
    roomType: normalizeRoomType(room.roomType),
    questionDurationMs: normalizeQuestionDurationMs(room.questionDurationMs),
    answerDurationMs: answerDurationMs(room),
    status: room.status,
    phase,
    serverNow: now,
    artist: room.artist || {},
    questionCount: (room.questions || []).length,
    currentIndex: Number(room.currentIndex || 0),
    questionStartedAtMs: Number(room.questionStartedAtMs || 0),
    questionAudioEndsAtMs: Number(room.questionAudioEndsAtMs || 0),
    questionEndsAtMs: Number(room.questionEndsAtMs || 0),
    revealUntilMs: Number(room.revealUntilMs || 0),
    players,
    minPlayers: minimumPlayers(room),
    maxPlayers: maximumPlayers(room),
    isHost: room.hostOpenId === openId,
    canStart: room.status === "waiting" && players.length >= minimumPlayers(room),
    myAnswer: myAnswer
      ? {
          optionId: myAnswer.optionId,
          correct: Boolean(myAnswer.correct),
          responseMs: Number(myAnswer.responseMs || 0)
        }
      : null,
    question: question && room.status !== "finished"
      ? {
          id: question.id,
          previewUrl: question.previewUrl,
          options: question.options || [],
          correctOptionId: revealing ? question.correctOptionId : ""
        }
      : null,
    nextQuestion: nextQuestion && room.status === "playing"
      ? {
          id: nextQuestion.id,
          previewUrl: nextQuestion.previewUrl
        }
      : null,
    preloadQuestions: (
      normalizeRoomType(room.roomType) === "solo"
      && room.status === "playing"
    )
      ? (room.questions || [])
          .slice(Number(room.currentIndex || 0) + 1)
          .map((item) => ({
            id: item.id,
            previewUrl: item.previewUrl
          }))
      : []
  };
}

async function getRoom(roomId) {
  const id = cleanText(roomId, 80);
  if (!id) throw new Error("缺少房间号");
  try {
    const result = await db.collection(ROOMS_COLLECTION).doc(id).get();
    return result.data;
  } catch (error) {
    throw new Error("房间不存在或已经失效");
  }
}

async function createRoom(event, openId, now) {
  const songs = uniqueSongs(event.songs);
  const questions = buildQuestions(songs, event.questionCount);
  const artist = event.artist || {};
  const profile = normalizeProfile(event.profile);
  const roomType = normalizeRoomType(event.roomType);
  const questionDurationMs = normalizeQuestionDurationMs(event.questionDurationMs);
  const data = {
    mode: "introQuiz",
    roomType,
    questionDurationMs,
    status: "waiting",
    hostOpenId: openId,
    artist: {
      id: cleanText(artist.id || artist.artistId || artist.itunesArtistId, 80),
      name: cleanText(artist.name || artist.artistName, 80) || "歌手",
      cover: cleanText(artist.avatarUrl || artist.cover, 500)
    },
    players: [{
      openId,
      profile,
      score: 0,
      answers: [],
      readyQuestionId: ""
    }],
    questions,
    currentIndex: 0,
    questionStartedAtMs: 0,
    questionAudioEndsAtMs: 0,
    questionEndsAtMs: 0,
    preparingStartedAtMs: 0,
    revealUntilMs: 0,
    createdAt: db.serverDate(),
    createdAtMs: now,
    updatedAtMs: now,
    expiresAtMs: now + ROOM_LIFETIME_MS
  };
  const result = await db.collection(ROOMS_COLLECTION).add({ data });
  const room = {
    ...data,
    _id: result._id
  };
  return {
    ok: true,
    room: publicRoom(room, openId, now)
  };
}

async function joinRoom(event, openId, now) {
  const roomId = cleanText(event.roomId, 80);
  const profile = normalizeProfile(event.profile);
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(ROOMS_COLLECTION).doc(roomId);
    const result = await ref.get();
    const room = result.data;
    if (!room || Number(room.expiresAtMs || 0) < now) throw new Error("房间已经失效");
    const existingIndex = (room.players || [])
      .findIndex((player) => player.openId === openId);
    if (existingIndex >= 0) {
      const players = room.players.slice();
      players[existingIndex] = {
        ...players[existingIndex],
        profile
      };
      await ref.update({ data: { players, updatedAtMs: now } });
      return;
    }
    if (normalizeRoomType(room.roomType) === "solo") {
      throw new Error("这是一个单人练习房间");
    }
    if (
      room.status !== "waiting"
      || (room.players || []).length >= maximumPlayers(room)
    ) {
      throw new Error("这间房已经坐满了");
    }
    await ref.update({
      data: {
        players: [
          ...(room.players || []),
          {
            openId,
            profile,
            score: 0,
            answers: [],
            readyQuestionId: ""
          }
        ],
        updatedAtMs: now
      }
    });
  });
  const room = await getRoom(roomId);
  return {
    ok: true,
    room: publicRoom(room, openId, now)
  };
}

async function startRoom(event, openId, now) {
  const roomId = cleanText(event.roomId, 80);
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(ROOMS_COLLECTION).doc(roomId);
    const result = await ref.get();
    const room = result.data;
    if (!room) throw new Error("房间不存在或已经失效");
    if (room.hostOpenId !== openId) throw new Error("只有房主可以开始");
    if (room.status !== "waiting") return;
    if ((room.players || []).length < minimumPlayers(room)) {
      throw new Error("人数还没有达到开局要求");
    }
    await ref.update({
      data: {
        status: "playing",
        currentIndex: 0,
        questionStartedAtMs: 0,
        questionAudioEndsAtMs: 0,
        questionEndsAtMs: 0,
        preparingStartedAtMs: now,
        revealUntilMs: 0,
        players: (room.players || []).map((player) => ({
          ...player,
          score: 0,
          answers: [],
          readyQuestionId: ""
        })),
        updatedAtMs: now
      }
    });
  });
  const room = await getRoom(roomId);
  return {
    ok: true,
    room: publicRoom(room, openId, now)
  };
}

async function readyRoom(event, openId, now) {
  const roomId = cleanText(event.roomId, 80);
  const questionId = cleanText(event.questionId, 30);
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(ROOMS_COLLECTION).doc(roomId);
    const result = await ref.get();
    const room = result.data;
    if (!room || room.status !== "playing") throw new Error("本局还没有开始");
    const question = (room.questions || [])[room.currentIndex];
    if (!question || question.id !== questionId) throw new Error("题目已经切换");
    if (room.questionStartedAtMs) return;
    const players = (room.players || []).map((player) => ({ ...player }));
    const playerIndex = players.findIndex((player) => player.openId === openId);
    if (playerIndex < 0) throw new Error("你不在这间房里");
    players[playerIndex].readyQuestionId = questionId;
    const everyoneReady = players.length >= minimumPlayers(room)
      && players.every((player) => player.readyQuestionId === questionId);
    const data = {
      players,
      updatedAtMs: now
    };
    if (everyoneReady) {
      const questionStartedAtMs = now + QUESTION_LEAD_IN_MS;
      const questionAudioEndsAtMs = questionStartedAtMs
        + normalizeQuestionDurationMs(room.questionDurationMs);
      data.questionStartedAtMs = questionStartedAtMs;
      data.questionAudioEndsAtMs = questionAudioEndsAtMs;
      data.questionEndsAtMs = questionAudioEndsAtMs + answerDurationMs(room);
    }
    await ref.update({ data });
  });
  const room = await getRoom(roomId);
  return {
    ok: true,
    room: publicRoom(room, openId, now)
  };
}

async function answerRoom(event, openId, now) {
  const roomId = cleanText(event.roomId, 80);
  const questionId = cleanText(event.questionId, 30);
  const optionId = cleanText(event.optionId, 80);

  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(ROOMS_COLLECTION).doc(roomId);
    const result = await ref.get();
    const room = result.data;
    if (!room || room.status !== "playing") throw new Error("本局已经结束");
    if (room.revealUntilMs) throw new Error("本题已经揭晓");
    const question = (room.questions || [])[room.currentIndex];
    if (!question || question.id !== questionId) throw new Error("题目已经切换");
    if (!room.questionStartedAtMs || now < room.questionStartedAtMs) {
      throw new Error("还没开始播放");
    }
    if (
      normalizeRoomType(room.roomType) !== "solo"
      &&
      answerDurationMs(room)
      && room.questionAudioEndsAtMs
      && now < room.questionAudioEndsAtMs
    ) {
      throw new Error("请听完片段再作答");
    }
    if (now > room.questionEndsAtMs) throw new Error("作答时间已结束");
    if (!(question.options || []).some((option) => option.id === optionId)) {
      throw new Error("选项无效");
    }

    const players = (room.players || []).map((player) => ({
      ...player,
      answers: (player.answers || []).slice()
    }));
    const playerIndex = players.findIndex((player) => player.openId === openId);
    if (playerIndex < 0) throw new Error("你不在这间房里");
    if (playerAnswerForQuestion(players[playerIndex], questionId)) return;

    const correct = optionId === question.correctOptionId;
    players[playerIndex].answers.push({
      questionId,
      optionId,
      correct,
      answeredAtMs: now,
      responseMs: Math.max(0, now - room.questionStartedAtMs)
    });
    if (correct) players[playerIndex].score = Number(players[playerIndex].score || 0) + 1;
    const data = {
      players,
      updatedAtMs: now
    };
    if (normalizeRoomType(room.roomType) === "solo") {
      if (correct) {
        const nextIndex = room.currentIndex + 1;
        if (nextIndex >= (room.questions || []).length) {
          data.status = "finished";
          data.finishedAtMs = now;
          data.revealUntilMs = 0;
        } else {
          data.currentIndex = nextIndex;
          data.questionStartedAtMs = 0;
          data.questionAudioEndsAtMs = 0;
          data.questionEndsAtMs = 0;
          data.preparingStartedAtMs = now;
          data.revealUntilMs = 0;
        }
      } else {
        data.revealUntilMs = now + REVEAL_DURATION_MS;
      }
    }
    await ref.update({ data });
  });

  let room = await getRoom(roomId);
  room = await settleRoom(room, now);
  return {
    ok: true,
    room: publicRoom(room, openId, now)
  };
}

async function roomState(event, openId, now) {
  let room = await getRoom(event.roomId);
  if (room.expiresAtMs < now) throw new Error("房间已经失效");
  if (!(room.players || []).some((player) => player.openId === openId)) {
    throw new Error("请先加入房间");
  }
  room = await settleRoom(room, now);
  return {
    ok: true,
    room: publicRoom(room, openId, now)
  };
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  const now = Date.now();
  try {
    if (event.action === "create") return await createRoom(event, openId, now);
    if (event.action === "join") return await joinRoom(event, openId, now);
    if (event.action === "start") return await startRoom(event, openId, now);
    if (event.action === "ready") return await readyRoom(event, openId, now);
    if (event.action === "answer") return await answerRoom(event, openId, now);
    if (event.action === "state") return await roomState(event, openId, now);
    return {
      ok: false,
      message: "不支持的操作"
    };
  } catch (error) {
    console.error("introQuiz failed", {
      action: event.action,
      roomId: event.roomId || "",
      message: error && error.message
    });
    return {
      ok: false,
      message: (error && error.message) || "片段猜歌挑战暂时不可用"
    };
  }
};
