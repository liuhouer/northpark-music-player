const { ipcRenderer } = require('electron')
const { $ } = require('./helper')
const path = require('path')
const fs = require('fs')

let musicFilesPath = []
let currentPlaylistId = 'all'

const formatIcons = {
  mp3:  { color: '#3498db', label: 'MP3' },
  flac: { color: '#2ecc71', label: 'FLAC' },
  wav:  { color: '#9b59b6', label: 'WAV' },
  aac:  { color: '#e67e22', label: 'AAC' },
  ogg:  { color: '#e74c3c', label: 'OGG' },
  m4a:  { color: '#1abc9c', label: 'M4A' },
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getFileSize = (filePath) => {
  try { return fs.statSync(filePath).size } catch (e) { return 0 }
}

const getFileExt = (filePath) => {
  return path.extname(filePath).toLowerCase().slice(1)
}

const updateStats = () => {
  const count = musicFilesPath.length
  let totalSize = 0
  musicFilesPath.forEach(p => { totalSize += getFileSize(p) })

  $('stats-count').textContent = count + ' 首'
  $('stats-size').textContent = formatFileSize(totalSize)
  $('add-music').disabled = count === 0
  $('clear-list').style.display = count > 0 ? 'flex' : 'none'
}

const renderEmptyState = () => {
  $('musicList').innerHTML = `
    <div class="empty-state">
      <i class="fas fa-music"></i>
      <p>您还未选择任何音乐文件</p>
      <p class="empty-hint">点击下方按钮选择文件或导入文件夹</p>
    </div>
  `
}

const renderListHTML = (pathes) => {
  if (!pathes || pathes.length === 0) {
    renderEmptyState()
    updateStats()
    return
  }

  const musicList = $('musicList')
  const itemsHTML = pathes.map((music, index) => {
    const ext = getFileExt(music)
    const iconInfo = formatIcons[ext] || { color: '#999', label: ext.toUpperCase() }
    const size = formatFileSize(getFileSize(music))
    const name = path.basename(music)

    return `
      <div class="file-item" data-index="${index}">
        <div class="file-icon" style="background:${iconInfo.color}15;color:${iconInfo.color};">
          <i class="fas fa-music"></i>
        </div>
        <div class="file-info">
          <div class="file-name" title="${name}">${name}</div>
          <div class="file-meta">${iconInfo.label} · ${size}</div>
        </div>
        <button class="file-remove" data-index="${index}" title="移除">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `
  }).join('')

  musicList.innerHTML = itemsHTML

  musicList.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const index = parseInt(btn.dataset.index)
      removeFile(index)
    })
  })

  updateStats()
}

const removeFile = (index) => {
  musicFilesPath.splice(index, 1)
  renderListHTML(musicFilesPath)
}

// 选择文件
$('select-music').addEventListener('click', () => {
  ipcRenderer.send('open-music-file')
})

// 选择文件夹
$('select-folder').addEventListener('click', () => {
  ipcRenderer.send('open-music-folder')
})

// 清空列表
$('clear-list').addEventListener('click', () => {
  musicFilesPath = []
  renderEmptyState()
  updateStats()
})

// 导入音乐
$('add-music').addEventListener('click', () => {
  if (musicFilesPath.length === 0) return
  ipcRenderer.send('add-tracks', musicFilesPath, currentPlaylistId)
})

// 接收歌单上下文
ipcRenderer.on('playlist-context', (event, playlistId) => {
  currentPlaylistId = playlistId || 'all'
  console.log('add window playlist context:', currentPlaylistId)
})

// 接收选择的文件（追加模式，支持多次选择）
ipcRenderer.on('selected-file', (event, paths) => {
  if (Array.isArray(paths)) {
    const existing = new Set(musicFilesPath)
    paths.forEach(p => { if (!existing.has(p)) musicFilesPath.push(p) })
    renderListHTML(musicFilesPath)
  }
})

// 深色模式
ipcRenderer.on('apply-dark-mode', (event, isDarkMode) => {
  const body = document.body
  if (isDarkMode) {
    body.classList.add('dark-mode')
  } else {
    body.classList.remove('dark-mode')
  }
})
