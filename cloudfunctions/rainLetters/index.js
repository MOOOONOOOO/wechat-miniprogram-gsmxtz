const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const LETTERS_COLLECTION = "rainLetters";
const FUNCTION_ENABLED = process.env.RAIN_LETTERS_ENABLED !== "false";
const DEVELOPMENT_BYPASS_ENABLED = process.env.RAIN_LETTERS_ALLOW_PREVIEW_BYPASS === "true";
const DEFAULT_SIGNATURE = "神秘人";
const WELCOME_TEMPLATE_ID = "seed-rain-box-welcome";
const RANDOM_CANDIDATE_LIMIT = 20;
const RANDOM_CLAIM_ATTEMPTS = 3;
const MAILBOX_SYNC_LIMIT = 99;

const FALLBACK_WELCOME_LETTER = {
  clientId: "seed-letter-rain-box-20260726",
  title: "即使在最值得一提的下午。",
  body: [
    "最近爱听这首《雨水一盒》,在爱的人面前流眼泪是不容易的。青峰写“沉没前清醒的爱人”，会不会是在描述告别时哭泣的恋人沉没在名为眼泪的湖中？嗯，悲伤逆流成河，完全学杂了。",
    "陈绮贞说：“我很喜欢水的意象，虽然水滴看起来微不足道，但汇聚成海洋的时候，它又具有吞噬人的力量。在《雨水一盒》中，随着一颗一颗雨水，唱出女孩最深沉又最炽热的表白。雨水，就像是我们共有的美好回忆。盒子，就是装着我们的容器，一旦出现裂缝，装满的雨水还是会一滴一滴地流逝消失。”",
    "即使在最值得一提的下午，对于告别我还是显得粗鲁。我理解这首歌是从热恋到结束，推荐给你，就这样，愿你的日子浑圆饱满而不一筹莫展。:D"
  ].join("\n"),
  signature: DEFAULT_SIGNATURE,
  dateText: "7月26日晚上",
  song: {
    trackId: "789600921",
    name: "雨水一盒",
    trackName: "雨水一盒",
    artistName: "陈绮贞",
    album: "时间的歌",
    collectionName: "时间的歌",
    cover: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/9e/78/07/9e7807ae-f751-e110-3c3e-64c02183bc4e/1105_4000x4000.jpg/600x600bb.jpg",
    lyrics: []
  },
  createdAtMs: Date.parse("2026-07-26T20:00:00+08:00")
};

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function chinaDayKey(timestamp = Date.now()) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isDevelopmentPreview(event = {}) {
  return DEVELOPMENT_BYPASS_ENABLED
    && cleanText(event.clientEnvVersion, 16) !== "release";
}

function cleanUrl(value) {
  const url = cleanText(value, 1200);
  return /^(https:\/\/|cloud:\/\/)/.test(url) ? url : "";
}

function normalizeSong(song = {}) {
  const lyrics = (Array.isArray(song.lyrics) ? song.lyrics : [])
    .map((line) => cleanText(line, 100))
    .filter(Boolean)
    .slice(0, 6);
  return {
    trackId: cleanText(song.trackId || song.songId, 100),
    name: cleanText(song.name || song.trackName, 120),
    trackName: cleanText(song.trackName || song.name, 120),
    artistName: cleanText(song.artistName, 120),
    album: cleanText(song.album || song.collectionName, 160),
    collectionName: cleanText(song.collectionName || song.album, 160),
    cover: cleanUrl(song.cover || song.artworkUrl600 || song.artworkUrl100 || song.albumCover),
    lyrics
  };
}

function normalizeLetterInput(letter = {}) {
  const signature = cleanText(letter.signature, 24);
  const normalized = {
    clientId: cleanText(letter.id, 100),
    title: cleanText(letter.title, 30),
    body: cleanText(letter.body, 600),
    signature: signature || DEFAULT_SIGNATURE,
    dateText: cleanText(letter.dateText, 40),
    song: normalizeSong(letter.song || {})
  };
  if (!normalized.body) throw new Error("请输入信件正文");
  return normalized;
}

function reviewTextForLetter(letter = {}) {
  return [
    letter.title ? `标题：${letter.title}` : "",
    `正文：${letter.body || ""}`,
    `落款：${letter.signature || DEFAULT_SIGNATURE}`,
    letter.song && letter.song.name
      ? `歌曲：${letter.song.artistName || ""}《${letter.song.name}》`
      : ""
  ].filter(Boolean).join("\n").slice(0, 2500);
}

async function reviewLetterContent(letter, openId) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: reviewTextForLetter(letter),
      version: 2,
      scene: 3,
      openid: openId
    });
    const result = (res && res.result) || {};
    const suggest = cleanText(result.suggest, 20).toLowerCase();
    if (suggest !== "pass") {
      return {
        ok: false,
        reason: "CONTENT_REJECTED",
        message: "这封信暂时没有通过内容审核，请修改后再试"
      };
    }
    return {
      ok: true,
      suggest: "pass",
      label: Number(result.label || 0),
      checkedAtMs: Date.now()
    };
  } catch (error) {
    console.error("rain letter content review failed", error);
    return {
      ok: false,
      reason: "CONTENT_REVIEW_UNAVAILABLE",
      message: "暂时无法完成内容审核，请稍后再试"
    };
  }
}

function publicLetter(record = {}, direction) {
  return {
    id: record._id || record.clientId || "",
    cloudId: record._id || "",
    clientId: record.clientId || "",
    title: record.title || "",
    body: record.body || "",
    signature: cleanText(record.signature, 24) || DEFAULT_SIGNATURE,
    dateText: record.dateText || "",
    song: record.song || {},
    createdAt: record.createdAt || record.createdAtMs || 0,
    createdAtMs: Number(record.createdAtMs || 0),
    deliveredAt: record.deliveredAt || null,
    deliveryStatus: record.status || "pending",
    direction: direction || ""
  };
}

function welcomeDocumentId(openId) {
  const digest = crypto.createHash("sha256").update(openId).digest("hex").slice(0, 32);
  return `welcome_${digest}`;
}

async function getWelcomeLetterTemplate() {
  try {
    const res = await db.collection(LETTERS_COLLECTION).doc(WELCOME_TEMPLATE_ID).get();
    if (res && res.data) {
      return {
        ...FALLBACK_WELCOME_LETTER,
        ...res.data,
        song: normalizeSong((res.data && res.data.song) || FALLBACK_WELCOME_LETTER.song)
      };
    }
  } catch (error) {
    console.warn("rain welcome template fallback", error && error.message);
  }
  return FALLBACK_WELCOME_LETTER;
}

async function findAnyReceivedLetter(openId) {
  const res = await db.collection(LETTERS_COLLECTION)
    .where({ recipientOpenId: openId })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

async function createWelcomeLetter(openId, recipientDay, now) {
  const documentId = welcomeDocumentId(openId);
  const document = db.collection(LETTERS_COLLECTION).doc(documentId);
  try {
    const existing = await document.get();
    if (existing && existing.data) return existing.data;
  } catch (error) {}

  const template = await getWelcomeLetterTemplate();
  const record = {
    clientId: template.clientId || FALLBACK_WELCOME_LETTER.clientId,
    title: cleanText(template.title, 30),
    body: cleanText(template.body, 600),
    signature: cleanText(template.signature, 24) || DEFAULT_SIGNATURE,
    dateText: cleanText(template.dateText, 40),
    song: normalizeSong(template.song || {}),
    senderOpenId: "system:welcome",
    senderDay: "2026-07-26",
    status: "delivered",
    recipientOpenId: openId,
    recipientDay,
    randomKey: 0,
    developmentPreview: false,
    templateKey: "rain-box-welcome",
    createdAt: db.serverDate(),
    createdAtMs: Number(template.createdAtMs || FALLBACK_WELCOME_LETTER.createdAtMs),
    deliveredAt: db.serverDate(),
    deliveredAtMs: now
  };
  await document.set({ data: record });
  return { ...record, _id: documentId };
}

async function sendLetter(event, openId) {
  const letter = normalizeLetterInput(event.letter || {});
  const now = Date.now();
  const senderDay = chinaDayKey(now);
  const developmentPreview = isDevelopmentPreview(event);

  if (!developmentPreview) {
    const existing = await db.collection(LETTERS_COLLECTION)
      .where({ senderOpenId: openId, senderDay })
      .limit(1)
      .get();
    if ((existing.data || []).length) {
      return {
        ok: false,
        reason: "DAILY_SEND_LIMIT",
        message: "今天已经寄出过一封信"
      };
    }
  }

  const contentReview = await reviewLetterContent(letter, openId);
  if (!contentReview.ok) return contentReview;

  const record = {
    ...letter,
    senderOpenId: openId,
    senderDay,
    status: "pending",
    recipientOpenId: "",
    recipientDay: "",
    randomKey: Math.random(),
    contentReview: {
      suggest: contentReview.suggest,
      label: contentReview.label,
      checkedAtMs: contentReview.checkedAtMs
    },
    developmentPreview,
    createdAt: db.serverDate(),
    createdAtMs: now
  };
  const res = await db.collection(LETTERS_COLLECTION).add({ data: record });
  return {
    ok: true,
    letterId: res._id || "",
    developmentPreview
  };
}

async function findExistingReceivedLetter(openId, recipientDay) {
  const res = await db.collection(LETTERS_COLLECTION)
    .where({ recipientOpenId: openId, recipientDay })
    .orderBy("deliveredAtMs", "asc")
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

function shuffled(items) {
  const result = (items || []).slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    const value = result[index];
    result[index] = result[target];
    result[target] = value;
  }
  return result;
}

async function randomPendingCandidates() {
  const pivot = Math.random();
  const first = await db.collection(LETTERS_COLLECTION)
    .where({
      status: "pending",
      randomKey: _.gte(pivot)
    })
    .orderBy("randomKey", "asc")
    .limit(RANDOM_CANDIDATE_LIMIT)
    .get();
  const candidates = (first.data || []).slice();

  if (candidates.length < RANDOM_CANDIDATE_LIMIT) {
    const wrapped = await db.collection(LETTERS_COLLECTION)
      .where({
        status: "pending",
        randomKey: _.lt(pivot)
      })
      .orderBy("randomKey", "asc")
      .limit(RANDOM_CANDIDATE_LIMIT - candidates.length)
      .get();
    candidates.push(...(wrapped.data || []));
  }

  return shuffled(candidates);
}

async function claimRandomPendingLetter(openId, recipientDay, now, developmentPreview) {
  for (let attempt = 0; attempt < RANDOM_CLAIM_ATTEMPTS; attempt += 1) {
    const candidates = (await randomPendingCandidates()).filter((letter) => (
      !letter.developmentPreview
      && (developmentPreview || letter.senderOpenId !== openId)
    ));

    for (const candidate of candidates) {
      const claim = await db.collection(LETTERS_COLLECTION)
        .where({
          _id: candidate._id,
          status: "pending"
        })
        .update({
          data: {
            status: "delivered",
            recipientOpenId: openId,
            recipientDay,
            deliveredAt: db.serverDate(),
            deliveredAtMs: now
          }
        });
      if (claim && claim.stats && claim.stats.updated === 1) {
        return {
          ...candidate,
          status: "delivered",
          recipientOpenId: openId,
          recipientDay,
          deliveredAtMs: now
        };
      }
    }
  }
  return null;
}

async function reserveTemplates() {
  const res = await db.collection(LETTERS_COLLECTION)
    .where({ status: "template" })
    .limit(50)
    .get();
  return (res.data || []).filter((letter) => letter.templateKind === "reserve");
}

async function recentlyReceivedTemplateIds(openId) {
  const res = await db.collection(LETTERS_COLLECTION)
    .where({ recipientOpenId: openId })
    .orderBy("deliveredAtMs", "desc")
    .limit(50)
    .get();
  return new Set((res.data || [])
    .map((letter) => letter.sourceTemplateId)
    .filter(Boolean));
}

async function createReserveLetter(openId, recipientDay, now, developmentPreview) {
  const templates = await reserveTemplates();
  if (!templates.length) return null;

  const seenTemplateIds = await recentlyReceivedTemplateIds(openId);
  const unseenTemplates = templates.filter((template) => !seenTemplateIds.has(template._id));
  const availableTemplates = unseenTemplates.length ? unseenTemplates : templates;
  const selectionIdentity = developmentPreview
    ? `${openId}:${recipientDay}:${now}`
    : `${openId}:${recipientDay}`;
  const selectionHash = crypto.createHash("sha256")
    .update(selectionIdentity)
    .digest("hex")
    .slice(0, 8);
  const source = availableTemplates[
    parseInt(selectionHash, 16) % availableTemplates.length
  ];
  if (!source) return null;

  const identity = developmentPreview
    ? `${openId}:${recipientDay}:${now}:${Math.random()}`
    : `${openId}:${recipientDay}`;
  const documentId = `reserve_${crypto.createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 32)}`;
  const record = {
    clientId: source.clientId || source._id || "",
    title: cleanText(source.title, 30),
    body: cleanText(source.body, 600),
    signature: cleanText(source.signature, 24) || DEFAULT_SIGNATURE,
    dateText: cleanText(source.dateText, 40),
    song: normalizeSong(source.song || {}),
    senderOpenId: "system:reserve",
    senderDay: cleanText(source.senderDay, 20),
    status: "delivered",
    recipientOpenId: openId,
    recipientDay,
    randomKey: Number(source.randomKey || Math.random()),
    developmentPreview,
    templateKind: "deliveredReserve",
    templateKey: cleanText(source.templateKey || source._id, 100),
    sourceTemplateId: source._id || "",
    createdAt: db.serverDate(),
    createdAtMs: Number(source.createdAtMs || now),
    deliveredAt: db.serverDate(),
    deliveredAtMs: now
  };
  await db.collection(LETTERS_COLLECTION).doc(documentId).set({ data: record });
  return { ...record, _id: documentId };
}

async function receiveLetter(event, openId) {
  const now = Date.now();
  const recipientDay = chinaDayKey(now);
  const developmentPreview = isDevelopmentPreview(event);

  if (!developmentPreview) {
    const existing = await findExistingReceivedLetter(openId, recipientDay);
    if (existing) {
      return {
        ok: true,
        letter: publicLetter(existing, "inbox"),
        reused: true
      };
    }
  }

  const previousLetter = await findAnyReceivedLetter(openId);
  if (!previousLetter) {
    const welcomeLetter = await createWelcomeLetter(openId, recipientDay, now);
    return {
      ok: true,
      letter: publicLetter(welcomeLetter, "inbox"),
      reused: false,
      welcome: true
    };
  }

  const claimedLetter = await claimRandomPendingLetter(
    openId,
    recipientDay,
    now,
    developmentPreview
  );
  if (claimedLetter) {
    return {
      ok: true,
      letter: publicLetter(claimedLetter, "inbox"),
      reused: false,
      source: "publicPool"
    };
  }

  const reserveLetter = await createReserveLetter(
    openId,
    recipientDay,
    now,
    developmentPreview
  );
  if (reserveLetter) {
    return {
      ok: true,
      letter: publicLetter(reserveLetter, "inbox"),
      reused: false,
      source: "systemReserve"
    };
  }

  return {
    ok: true,
    letter: null,
    empty: true
  };
}

async function listLetters(openId) {
  const [outboxRes, inboxRes] = await Promise.all([
    db.collection(LETTERS_COLLECTION)
      .where({ senderOpenId: openId })
      .orderBy("createdAtMs", "desc")
      .limit(MAILBOX_SYNC_LIMIT)
      .get(),
    db.collection(LETTERS_COLLECTION)
      .where({ recipientOpenId: openId })
      .orderBy("deliveredAtMs", "desc")
      .limit(MAILBOX_SYNC_LIMIT)
      .get()
  ]);
  return {
    ok: true,
    outbox: (outboxRes.data || []).map((letter) => publicLetter(letter, "outbox")),
    inbox: (inboxRes.data || []).map((letter) => publicLetter(letter, "inbox"))
  };
}

exports.main = async (event = {}) => {
  if (!FUNCTION_ENABLED) {
    return {
      ok: false,
      reason: "SERVICE_DISABLED",
      message: "雨水信箱暂时关闭"
    };
  }

  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID || "";
  if (!openId) return { ok: false, message: "暂时无法确认你的身份" };

  try {
    if (event.action === "send") return await sendLetter(event, openId);
    if (event.action === "receive") return await receiveLetter(event, openId);
    if (event.action === "list") return await listLetters(openId);
    return { ok: false, message: "未知的雨水信件操作" };
  } catch (error) {
    console.error("rain letters failed", event.action, error);
    return {
      ok: false,
      message: error && error.message ? error.message : "雨水信箱暂时没有回应"
    };
  }
};
