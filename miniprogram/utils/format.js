/**
 * 格式化工具
 */

function formatChange(value) {
  if (value === null || value === undefined || isNaN(value)) return '0.00'
  return (value > 0 ? '+' : '') + Number(value).toFixed(2)
}

function formatPrice(value) {
  if (!value || isNaN(value)) return '0.00'
  return Number(value).toFixed(2)
}

function formatMarketCap(value) {
  if (!value || isNaN(value)) return '--'
  if (value >= 10000) return (value / 10000).toFixed(1) + '万亿'
  if (value >= 100) return value.toFixed(0) + '亿'
  return value.toFixed(1) + '亿'
}

function formatAmount(value) {
  if (!value || isNaN(value)) return '--'
  if (value >= 100000000) return (value / 100000000).toFixed(2) + '亿'
  if (value >= 10000) return (value / 10000).toFixed(2) + '万'
  return value.toFixed(0)
}

function priceClass(value) {
  if (value > 0) return 'price-up'
  if (value < 0) return 'price-down'
  return 'price-flat'
}

function scoreClass(value) {
  if (value >= 80) return 'theme-green'
  if (value >= 60) return 'theme-blue'
  if (value >= 40) return 'theme-orange'
  return 'theme-gray'
}

function formatTime(date) {
  if (!date) return ''
  const d = new Date(date)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function formatDate(date) {
  if (!date) return ''
  const d = new Date(date)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}`
}

function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '--'
  return Number(value).toFixed(2) + '%'
}

module.exports = {
  formatChange, formatPrice, formatMarketCap, formatAmount,
  priceClass, scoreClass, formatTime, formatDate, formatPercent,
}
