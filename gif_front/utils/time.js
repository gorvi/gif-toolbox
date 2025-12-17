function pad2(n) {
  const s = String(Math.floor(Math.max(0, n)))
  return s.length >= 2 ? s : `0${s}`
}

function formatHms(totalSeconds) {
  const sec = Math.floor(Math.max(0, totalSeconds))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

module.exports = {
  formatHms,
}







