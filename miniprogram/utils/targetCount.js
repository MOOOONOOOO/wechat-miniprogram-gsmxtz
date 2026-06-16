const DEFAULT_TARGET_COUNT = 9;
const MIN_TARGET_COUNT = 3;
const MAX_TARGET_COUNT = 18;
const TARGET_COUNT_STEP = 3;
const FLEX_TARGET_MODES = ["artist", "album", "top9"];

function isFlexTargetMode(mode) {
  return FLEX_TARGET_MODES.indexOf(String(mode || "")) >= 0;
}

function isValidTargetCount(count) {
  const value = Number(count || 0);
  return Number.isInteger(value)
    && value >= MIN_TARGET_COUNT
    && value <= MAX_TARGET_COUNT
    && value % TARGET_COUNT_STEP === 0;
}

function normalizeTargetCount(count, fallback = DEFAULT_TARGET_COUNT) {
  const value = Number(count || 0);
  if (isValidTargetCount(value)) return value;
  return isValidTargetCount(fallback) ? Number(fallback) : DEFAULT_TARGET_COUNT;
}

function getTargetCountFromChallenge(challenge = {}, fallback = DEFAULT_TARGET_COUNT) {
  if (isValidTargetCount(challenge.targetCount)) return Number(challenge.targetCount);
  const mode = challenge.mode || "";
  if (mode === "top9") {
    return normalizeTargetCount((challenge.creatorTopSongs || []).length, fallback);
  }
  if (mode === "album") {
    return normalizeTargetCount((challenge.albums || []).length, fallback);
  }
  if (mode === "artist") {
    return normalizeTargetCount((challenge.artists || []).length, fallback);
  }
  return normalizeTargetCount(fallback);
}

function getNextValidTargetCount(count) {
  const value = Math.max(0, Number(count || 0));
  if (value >= MAX_TARGET_COUNT) return MAX_TARGET_COUNT;
  return Math.ceil(value / TARGET_COUNT_STEP) * TARGET_COUNT_STEP || MIN_TARGET_COUNT;
}

function getTargetCountHint(count, unit = "个") {
  const value = Number(count || 0);
  if (isValidTargetCount(value)) return `可用 ${value} ${unit}开始`;
  if (value >= MAX_TARGET_COUNT) return `最多选择 ${MAX_TARGET_COUNT} ${unit}`;
  const next = getNextValidTargetCount(value);
  const need = Math.max(0, next - value);
  return `再选 ${need} ${unit}，组成 ${next} ${unit}挑战项`;
}

function getTargetCountStartText(count, unit = "个", subject = "项目") {
  const value = Number(count || 0);
  if (!isValidTargetCount(value)) return `请选择${subject}`;
  if (value >= MAX_TARGET_COUNT) return `最多选择${MAX_TARGET_COUNT}${unit}`;
  return `可用${value}${unit}开始，或者继续选择到${value + TARGET_COUNT_STEP}${unit}`;
}

module.exports = {
  DEFAULT_TARGET_COUNT,
  MAX_TARGET_COUNT,
  MIN_TARGET_COUNT,
  TARGET_COUNT_STEP,
  getNextValidTargetCount,
  getTargetCountFromChallenge,
  getTargetCountHint,
  getTargetCountStartText,
  isFlexTargetMode,
  isValidTargetCount,
  normalizeTargetCount
};
