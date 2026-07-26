function normalizeSongKeyText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s·・.。'’`"“”\-_/\\()（）[\]【】:：,，]+/g, "");
}

function getSongName(song) {
  return String((song && (song.name || song.trackName)) || "").trim();
}

function getSongKey(song) {
  if (!song) return "";
  const trackId = String(song.trackId || "").trim();
  if (trackId) return `id:${trackId}`;
  const artistName = normalizeSongKeyText(song.artistName || "");
  const songName = normalizeSongKeyText(getSongName(song));
  return artistName || songName ? `name:${artistName}:${songName}` : "";
}

module.exports = {
  getSongKey,
  getSongName,
  normalizeSongKeyText
};
