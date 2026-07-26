const {
  buildTournamentColumns,
  deriveTournament,
  getActiveTournament,
  getSongKey,
  getSongName,
  getTournamentRecord
} = require("../../utils/songTournament");

function decorateColumns(tournament, derived) {
  const championKey = derived.complete && derived.champion ? getSongKey(derived.champion) : "";
  return buildTournamentColumns(tournament, derived).map((column) => ({
    ...column,
    cells: column.cells.map((cell, index) => ({
      ...cell,
      key: `${column.key}-${index}`,
      displayName: cell.song ? getSongName(cell.song) : "待选择",
      height: cell.span * 54,
      emptyClass: cell.song ? "" : "empty",
      championClass: championKey && cell.song && getSongKey(cell.song) === championKey ? "champion-path" : "",
      hasSong: Boolean(cell.song),
      cover: cell.song ? (cell.song.cover || cell.song.coverUrl || "") : "",
      fallbackText: cell.song ? (getSongName(cell.song).slice(0, 1) || "音") : "",
      layoutClass: cell.span >= 4 ? "large-cell" : "compact-cell",
      coverSize: cell.span === 1 ? 38 : (cell.span === 2 ? 72 : Math.min(150, cell.span * 54 - 64))
    }))
  }));
}

Page({
  data: {
    invalid: false,
    artistName: "",
    size: 16,
    progressText: "",
    columns: [],
    tableWidth: 0,
    complete: false,
    championName: ""
  },

  onLoad(options = {}) {
    this.recordId = options.id ? decodeURIComponent(options.id) : "";
    this.loadTournament();
  },

  onShow() {
    if (this.loadedOnce) this.loadTournament();
    this.loadedOnce = true;
  },

  loadTournament() {
    const tournament = this.recordId ? getTournamentRecord(this.recordId) : getActiveTournament();
    const derived = tournament ? deriveTournament(tournament) : null;
    if (!tournament || !derived || !derived.valid) {
      this.setData({ invalid: true });
      return;
    }
    const columns = decorateColumns(tournament, derived);
    this.setData({
      invalid: false,
      artistName: (tournament.artist || {}).name || "",
      size: tournament.size,
      progressText: derived.complete
        ? "决选已完成"
        : `已完成 ${derived.decisionCount} / ${derived.totalDecisions} 组选择`,
      columns,
      tableWidth: columns.length * 230,
      complete: derived.complete,
      championName: derived.champion ? getSongName(derived.champion) : ""
    });
  },

  onTableCoverError(event) {
    const columnKey = event.currentTarget.dataset.columnKey;
    const cellKey = event.currentTarget.dataset.cellKey;
    this.setData({
      columns: this.data.columns.map((column) => column.key === columnKey ? {
        ...column,
        cells: column.cells.map((cell) => cell.key === cellKey ? { ...cell, cover: "" } : cell)
      } : column)
    });
  }
});
