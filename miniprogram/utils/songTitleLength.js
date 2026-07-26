function getSongTitleUnits(value) {
  return Array.from(String(value || "").trim()).reduce((total, char) => {
    const codePoint = char.codePointAt(0);
    return total + (codePoint <= 0x7f || (codePoint >= 0xff61 && codePoint <= 0xff9f) ? 0.5 : 1);
  }, 0);
}

function matchesSongTitleCount(value, targetCount) {
  const actualCount = getSongTitleUnits(value);
  const expectedCount = Number(targetCount || 0);
  if (expectedCount === 9) return actualCount === 9;
  if (expectedCount === 10 || expectedCount === 11) {
    return actualCount >= 9 && actualCount <= 11;
  }
  return actualCount === expectedCount;
}

module.exports = {
  getSongTitleUnits,
  matchesSongTitleCount
};
