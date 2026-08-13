const { ipcRenderer } = require('electron')
const { $, convertDuration } = require('./helper')

// 读取歌曲标签
const jsmediatags = require('jsmediatags')
const musicMetadata = require('music-metadata')

// HTML 转义（用于 title 属性等）
const escapeHtml = (str) => {
  if (!str) return ''
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
}

let musicAudio = new Audio()
musicAudio.preload = 'metadata'
let currentTrack
let currentLyricIndex = 0
let currentLyricIndexAnimationDuration = 1
let curLyrics
let curLyricDisplayText
let isPlaying = false
const trackMetaCache = {}

// 歌单状态
let playlists = []
let currentPlaylistId = 'all'
let dragSrcEl = null
let pendingPlaybackState = null

// 保存播放状态
const savePlaybackState = () => {
  if (currentPlaylistId && currentTrack) {
    ipcRenderer.send('save-playback-state', { playlistId: currentPlaylistId, trackId: currentTrack.id })
  }
}

// 恢复播放状态
const restorePlaybackState = (state) => {
  if (!state || !playlists.length) return
  const { playlistId, trackId } = state
  if (!playlistId || !trackId) return

  // 切换到对应歌单
  const playlist = playlists.find(p => p.id === playlistId)
  if (!playlist) return

  switchPlaylist(playlistId)

  // 查找并播放对应歌曲（只恢复UI状态，不加载音频数据，等用户点击播放时再加载）
  const track = playlist.tracks.find(t => t.id === trackId)
  if (track) {
    currentTrack = track
    musicAudio.src = track.path
    // 不调用 load()，preload='metadata' 只会加载元数据，不占用大量内存
    renderPlayerHTML(track.fileName, 0)
    renderListHTML(getCurrentTracks(), true)
  }
}

// ========================= 虚拟滚动配置 =========================
const ITEM_HEIGHT = 48
const VIRTUAL_BUFFER = 10
let currentRenderedTracks = []
let virtualScrollBound = false
let metaLoadedForTracks = null

const getCurrentTracks = () => {
  const playlist = playlists.find(p => p.id === currentPlaylistId)
  return playlist ? playlist.tracks : []
}

// 渲染单行的 HTML（供虚拟滚动调用）
const renderTrackRowHTML = (track, index) => {
  const isCurrent = currentTrack && currentTrack.path === track.path
  const isTrackPlaying = isCurrent && isPlaying
  const meta = trackMetaCache[track.path] || {}
  const ext = track.fileName.split('.').pop().toLowerCase()
  return `
    <div class="track-row ${isCurrent ? 'playing' : ''}" data-id="${track.id}" data-index="${index}" draggable="true">
      <div class="drag-handle" title="拖动排序">
        <i class="fas fa-grip-vertical"></i>
      </div>
      <div class="track-index">
        <span>${index + 1}</span>
        <i class="fas fa-info-circle info-icon" data-id="${track.id}" title="查看标签信息"></i>
        <div class="playing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="track-title">
        <div class="cover-placeholder" data-cover-id="${track.id}"><i class="fas fa-music"></i></div>
        <span title="${escapeHtml(track.fileName.replace(/\.(mp3|flac|wav|aac|ogg|m4a)$/i, ''))}">${track.fileName.replace(/\.(mp3|flac|wav|aac|ogg|m4a)$/i, '')}</span>
      </div>
      <div class="track-artist" data-artist-id="${track.id}">${meta.artist || '--'}</div>
      <div class="track-album" data-album-id="${track.id}">${meta.album || '--'}</div>
      <div class="track-duration" data-duration-id="${track.id}">${meta.duration || '--:--'}</div>
      <div class="track-actions">
        <button class="btn-icon btn-play-track" data-id="${track.id}" title="${isTrackPlaying ? '暂停' : '播放'}">
          <i class="fas ${isTrackPlaying ? 'fa-pause' : 'fa-play'}"></i>
        </button>
        <button class="btn-icon btn-edit-tag" data-id="${track.id}" data-ext="${ext}" title="编辑标签">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icon btn-add-to-playlist" data-id="${track.id}" title="添加到歌单">
          <i class="fas fa-folder-plus"></i>
        </button>
        <button class="btn-icon btn-delete-track" data-id="${track.id}" title="${currentPlaylistId === 'all' ? '删除' : '从歌单移除'}">
          <i class="fas ${currentPlaylistId === 'all' ? 'fa-trash-alt' : 'fa-minus'}"></i>
        </button>
      </div>
    </div>
  `
}

// ========================= 渲染歌曲列表（虚拟滚动） =========================
const renderListHTML = (tracks, skipMeta = false) => {
  currentRenderedTracks = tracks
  const tracksList = $('tracksList')
  $('song-count').textContent = `${tracks.length} 首歌曲`

  if (!tracks.length) {
    tracksList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-music"></i>
        <p>还没有添加任何音乐</p>
        <button type="button" id="empty-add-btn" class="btn btn-primary">添加歌曲</button>
      </div>
    `
    const emptyAddBtn = document.getElementById('empty-add-btn')
    if (emptyAddBtn) {
      emptyAddBtn.addEventListener('click', () => {
        ipcRenderer.send('add-music-window', document.body.classList.contains('dark-mode'), currentPlaylistId)
      })
    }
    return
  }

  const contentBody = document.querySelector('.content-body')
  const scrollTop = contentBody.scrollTop
  const viewportHeight = contentBody.clientHeight

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - VIRTUAL_BUFFER)
  const endIndex = Math.min(tracks.length, Math.ceil((scrollTop + viewportHeight) / ITEM_HEIGHT) + VIRTUAL_BUFFER)

  const topSpacer = startIndex * ITEM_HEIGHT
  const bottomSpacer = (tracks.length - endIndex) * ITEM_HEIGHT
  const visibleTracks = tracks.slice(startIndex, endIndex)

  tracksList.innerHTML = `
    <div class="tracks-list-content">
      <div class="virtual-spacer" style="height: ${topSpacer}px"></div>
      ${visibleTracks.map((track, i) => renderTrackRowHTML(track, startIndex + i)).join('')}
      <div class="virtual-spacer" style="height: ${bottomSpacer}px"></div>
    </div>
  `

  bindVirtualScrollEvents()

  // 按需读取可见歌曲的元数据（不再全量读取）
  loadVisibleTracksMeta(visibleTracks)
}

// 滚动时更新可见行
const updateVirtualViewport = () => {
  if (!currentRenderedTracks.length) return
  const tracks = currentRenderedTracks
  const contentBody = document.querySelector('.content-body')
  const scrollTop = contentBody.scrollTop
  const viewportHeight = contentBody.clientHeight

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - VIRTUAL_BUFFER)
  const endIndex = Math.min(tracks.length, Math.ceil((scrollTop + viewportHeight) / ITEM_HEIGHT) + VIRTUAL_BUFFER)

  const topSpacer = startIndex * ITEM_HEIGHT
  const bottomSpacer = (tracks.length - endIndex) * ITEM_HEIGHT
  const visibleTracks = tracks.slice(startIndex, endIndex)

  const tracksList = $('tracksList')
  const listContent = tracksList.querySelector('.tracks-list-content')
  if (!listContent) return

  // 只更新内容，不重建整个容器（保留事件委托绑定）
  const spacers = listContent.querySelectorAll('.virtual-spacer')
  if (spacers.length === 2) {
    spacers[0].style.height = topSpacer + 'px'
    spacers[1].style.height = bottomSpacer + 'px'
  }

  const rowsContainer = document.createElement('div')
  rowsContainer.innerHTML = visibleTracks.map((track, i) => renderTrackRowHTML(track, startIndex + i)).join('')

  // 移除旧的 track-row，插入新的
  const oldRows = listContent.querySelectorAll('.track-row')
  oldRows.forEach(row => row.remove())

  const bottomSpacerEl = listContent.querySelector('.virtual-spacer:last-child')
  const newRows = Array.from(rowsContainer.children)
  newRows.forEach(row => {
    listContent.insertBefore(row, bottomSpacerEl)
  })

  // 滚动后按需读取新可见歌曲的元数据
  loadVisibleTracksMeta(visibleTracks)
}

// 按需读取可见歌曲的元数据（避免全量扫描所有文件）
const loadVisibleTracksMeta = (visibleTracks) => {
  const uncached = visibleTracks.filter(t => !trackMetaCache[t.path])
  if (uncached.length > 0) {
    loadTracksMetaBatch(uncached)
  }
}

// 绑定虚拟滚动事件（只执行一次）
const bindVirtualScrollEvents = () => {
  if (virtualScrollBound) return
  virtualScrollBound = true

  const contentBody = document.querySelector('.content-body')
  let scrollTicking = false
  contentBody.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        updateVirtualViewport()
        scrollTicking = false
      })
      scrollTicking = true
    }
  }, { passive: true })

  const tracksList = $('tracksList')

  // 事件委托：双击播放
  tracksList.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.track-row')
    if (row) playTrack(row.dataset.id)
  })

  // 事件委托：按钮点击
  tracksList.addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn) {
      // info-icon 点击
      const icon = e.target.closest('.info-icon')
      if (icon) {
        e.stopPropagation()
        const id = icon.dataset.id
        if (!id) return
        const track = getCurrentTracks().find(t => t.id === id)
        if (track) showId3Info(track)
      }
      return
    }

    if (btn.classList.contains('btn-play-track')) {
      e.stopPropagation()
      const id = btn.dataset.id
      if (!id) return
      const clickedTrack = getCurrentTracks().find(t => t.id === id)
      if (currentTrack && clickedTrack && currentTrack.path === clickedTrack.path && isPlaying) {
        pauseTrack()
      } else {
        playTrack(id)
      }
    } else if (btn.classList.contains('btn-edit-tag')) {
      e.stopPropagation()
      const id = btn.dataset.id
      if (!id) return
      const track = getCurrentTracks().find(t => t.id === id)
      if (track) showId3Edit(track)
    } else if (btn.classList.contains('btn-delete-track')) {
      e.stopPropagation()
      const id = btn.dataset.id
      if (!id) return
      if (currentPlaylistId === 'all') {
        ipcRenderer.send('delete-track', { id, playlistId: currentPlaylistId })
      } else {
        ipcRenderer.send('remove-from-playlist', { playlistId: currentPlaylistId, trackId: id })
      }
    } else if (btn.classList.contains('btn-add-to-playlist')) {
      e.stopPropagation()
      const id = btn.dataset.id
      if (id) showPlaylistMenu(btn, id)
    }
  })

  // 拖拽事件委托
  tracksList.addEventListener('dragstart', handleDragStart)
  tracksList.addEventListener('dragover', handleDragOver)
  tracksList.addEventListener('dragleave', handleDragLeave)
  tracksList.addEventListener('drop', handleDrop)
  tracksList.addEventListener('dragend', handleDragEnd)
}

// 分批异步读取歌曲元数据（降低CPU峰值）
const loadTracksMetaBatch = async (tracks) => {
  const BATCH_SIZE = 20

  const loadBatch = async (start) => {
    const end = Math.min(start + BATCH_SIZE, tracks.length)
    const batch = tracks.slice(start, end)

    for (const track of batch) {
      if (trackMetaCache[track.path]) continue
      try {
        const metadata = await musicMetadata.parseFile(track.path, { skipCovers: true, duration: true })
        const { common, format } = metadata
        const artist = common.artist || common.artists?.join(', ') || '--'
        const album = common.album || '--'
        const duration = format.duration ? convertDuration(format.duration) : '--:--'
        const durationSec = format.duration || 0
        const title = common.title || ''
        const year = common.year ? String(common.year) : ''
        const genre = common.genre?.[0] || ''
        const comment = common.comment?.[0]?.text || ''

        trackMetaCache[track.path] = { artist, album, duration, durationSec, title, year, genre, comment }

        const artistEl = document.querySelector(`[data-artist-id="${track.id}"]`)
        const albumEl = document.querySelector(`[data-album-id="${track.id}"]`)
        const durationEl = document.querySelector(`[data-duration-id="${track.id}"]`)

        if (artistEl) artistEl.textContent = artist
        if (albumEl) albumEl.textContent = album
        if (durationEl) durationEl.textContent = duration
      } catch (e) {
        trackMetaCache[track.path] = { artist: '--', album: '--', duration: '--:--', durationSec: 0, title: '', year: '', genre: '', comment: '' }
      }
    }

    if (end < tracks.length) {
      setTimeout(() => loadBatch(end), 0)
    }
  }

  loadBatch(0)
}

// 局部更新播放状态（避免全量重渲染）
const updateTrackRowPlayingState = (prevTrack, newTrack) => {
  if (prevTrack && prevTrack.id !== (newTrack?.id)) {
    const prevRow = document.querySelector(`.track-row[data-id="${prevTrack.id}"]`)
    if (prevRow) {
      prevRow.classList.remove('playing')
      const btn = prevRow.querySelector('.btn-play-track')
      if (btn) {
        btn.title = '播放'
        btn.innerHTML = '<i class="fas fa-play"></i>'
      }
    }
  }
  if (newTrack) {
    const newRow = document.querySelector(`.track-row[data-id="${newTrack.id}"]`)
    if (newRow) {
      newRow.classList.add('playing')
      const btn = newRow.querySelector('.btn-play-track')
      if (btn) {
        btn.title = isPlaying ? '暂停' : '播放'
        btn.innerHTML = `<i class="fas ${isPlaying ? 'fa-pause' : 'fa-play'}"></i>`
      }
    }
  }
}

// ========================= ID3 标签弹窗 =========================

let currentEditingTrack = null

const showId3Info = async (track) => {
  const dialog = $('id3-info-dialog')
  const body = $('id3-info-body')

  // 优先使用缓存，如果没有则实时读取
  let meta = trackMetaCache[track.path]
  if (!meta) {
    try {
      const metadata = await musicMetadata.parseFile(track.path)
      const { common, format } = metadata
      meta = {
        title: common.title || '',
        artist: common.artist || common.artists?.join(', ') || '--',
        album: common.album || '--',
        year: common.year ? String(common.year) : '',
        genre: common.genre?.[0] || '',
        comment: common.comment?.[0]?.text || '',
        duration: format.duration ? convertDuration(format.duration) : '--:--'
      }
    } catch (e) {
      meta = {}
    }
  }

  // 对于 MP3，尝试用 node-id3 读取更详细的原始标签
  let rawTags = null
  const ext = track.fileName.split('.').pop().toLowerCase()
  if (ext === 'mp3') {
    try {
      const NodeID3 = require('node-id3')
      rawTags = NodeID3.read(track.path)
    } catch (e) { /* ignore */ }
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return '--'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  let fileSize = '--'
  try {
    const fs = require('fs')
    const stat = fs.statSync(track.path)
    fileSize = formatFileSize(stat.size)
  } catch (e) { /* ignore */ }

  const rows = [
    { label: '文件名', value: track.fileName },
    { label: '标题', value: rawTags?.title || meta.title || '--' },
    { label: '艺术家', value: rawTags?.artist || meta.artist || '--' },
    { label: '专辑', value: rawTags?.album || meta.album || '--' },
    { label: '年份', value: rawTags?.year || meta.year || '--' },
    { label: '流派', value: rawTags?.genre || meta.genre || '--' },
    { label: '注释', value: (rawTags?.comment?.text || rawTags?.comment || meta.comment || '--') },
    { label: '时长', value: meta.duration || '--' },
    { label: '文件大小', value: fileSize },
    { label: '文件路径', value: track.path },
  ]

  body.innerHTML = rows.map(r => `
    <div class="id3-info-row">
      <div class="id3-label">${r.label}</div>
      <div class="id3-value">${r.value}</div>
    </div>
  `).join('')

  dialog.classList.remove('hidden')
}

const showId3Edit = async (track) => {
  currentEditingTrack = track
  const dialog = $('id3-edit-dialog')
  const ext = track.fileName.split('.').pop().toLowerCase()

  // 非 MP3 提示不支持
  if (ext !== 'mp3') {
    alert('当前仅支持编辑 MP3 格式的 ID3 标签')
    return
  }

  // 读取现有标签
  let tags = { title: '', artist: '', album: '', year: '', genre: '', comment: '' }
  try {
    const NodeID3 = require('node-id3')
    const raw = NodeID3.read(track.path)
    if (raw) {
      tags.title = raw.title || ''
      tags.artist = raw.artist || ''
      tags.album = raw.album || ''
      tags.year = raw.year || ''
      tags.genre = raw.genre || ''
      tags.comment = raw.comment?.text || raw.comment || ''
    }
  } catch (e) {
    console.error('读取 ID3 标签失败:', e)
  }

  $('id3-edit-title').value = tags.title
  $('id3-edit-artist').value = tags.artist
  $('id3-edit-album').value = tags.album
  $('id3-edit-year').value = tags.year
  $('id3-edit-genre').value = tags.genre
  $('id3-edit-comment').value = tags.comment
  $('id3-edit-path').textContent = track.path
  $('id3-edit-format').textContent = ext.toUpperCase()

  dialog.classList.remove('hidden')
}

const closeId3Edit = () => {
  $('id3-edit-dialog').classList.add('hidden')
  currentEditingTrack = null
}

const saveId3Tags = () => {
  if (!currentEditingTrack) return

  const tags = {
    title: $('id3-edit-title').value.trim(),
    artist: $('id3-edit-artist').value.trim(),
    album: $('id3-edit-album').value.trim(),
    year: $('id3-edit-year').value.trim(),
    genre: $('id3-edit-genre').value.trim(),
    comment: $('id3-edit-comment').value.trim()
  }

  try {
    const NodeID3 = require('node-id3')
    const success = NodeID3.update(tags, currentEditingTrack.path)
    if (success) {
      alert('标签保存成功')
      // 刷新缓存和列表显示
      delete trackMetaCache[currentEditingTrack.path]
      loadTracksMetaBatch([currentEditingTrack])
      closeId3Edit()
    } else {
      alert('标签保存失败')
    }
  } catch (e) {
    console.error('保存 ID3 标签失败:', e)
    alert('保存失败: ' + e.message)
  }
}

// ID3 弹窗事件绑定
$('id3-info-close').addEventListener('click', () => {
  $('id3-info-dialog').classList.add('hidden')
})

$('id3-info-dialog').addEventListener('click', (e) => {
  if (e.target === $('id3-info-dialog')) $('id3-info-dialog').classList.add('hidden')
})

$('id3-edit-cancel').addEventListener('click', closeId3Edit)
$('id3-edit-save').addEventListener('click', saveId3Tags)

$('id3-edit-dialog').addEventListener('click', (e) => {
  if (e.target === $('id3-edit-dialog')) closeId3Edit()
})

// ========================= 播放器状态渲染 =========================
const renderPlayerHTML = (name, duration) => {
  const titleEl = $('current-title')
  const artistEl = $('current-artist')
  const coverWrapper = document.querySelector('.cover-wrapper')

  if (!currentTrack) {
    titleEl.textContent = '未在播放'
    artistEl.textContent = '--'
    coverWrapper.innerHTML = '<div class="cover-placeholder"><i class="fas fa-music"></i></div>'
    updatePlayButton(false)
    updateCoverRotation(false)
    return
  }

  const cleanName = name.replace(/\.(mp3|flac|wav|aac|ogg|m4a)$/i, '')
  titleEl.textContent = cleanName
  artistEl.textContent = '--'
  $('total-time').textContent = convertDuration(duration)
  updatePlayButton(isPlaying)
  updateCoverRotation(isPlaying)
  // 歌曲切换时更新托盘 tooltip
  ipcRenderer.send('playback-status-changed', { isPlaying, title: cleanName })

  // 重置封面为placeholder
  coverWrapper.innerHTML = '<div class="cover-placeholder"><i class="fas fa-music"></i></div>'

  // 加载封面
  loadCover()
  // 尝试读取标签显示艺术家和专辑
  readTrackMeta(currentTrack.path)
}

const updatePlayButton = (playing) => {
  const btn = $('play-pause-button')
  const icon = btn.querySelector('i')
  if (playing) {
    icon.classList.remove('fa-play')
    icon.classList.add('fa-pause')
  } else {
    icon.classList.remove('fa-pause')
    icon.classList.add('fa-play')
  }
}

const updateCoverRotation = (playing) => {
  const wrapper = document.querySelector('.cover-wrapper')
  if (playing) {
    wrapper.classList.add('playing')
  } else {
    wrapper.classList.remove('playing')
  }
}

// ========================= 进度条更新 =========================
const updateProgressHTML = (currentTime, duration) => {
  const progress = duration ? Math.floor(currentTime / duration * 100) : 0
  const bar = $('player-progress')
  bar.style.width = progress + '%'
  $('current-time').textContent = convertDuration(currentTime)
  if (duration) {
    $('total-time').textContent = convertDuration(duration)
  }
}

// ========================= 播放控制 =========================
let prevPlayingTrack = null

// 随机播放队列
let shuffleQueue = []
let shuffleIndex = -1

// 生成随机播放队列（Fisher-Yates 洗牌）
const generateShuffleQueue = (tracks) => {
  if (!tracks || tracks.length <= 1) {
    shuffleQueue = tracks ? [...tracks] : []
    shuffleIndex = -1
    return
  }
  shuffleQueue = [...tracks]
  for (let i = shuffleQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffleQueue[i], shuffleQueue[j]] = [shuffleQueue[j], shuffleQueue[i]]
  }
  // 如果当前有播放歌曲，定位到该歌曲在队列中的位置
  if (currentTrack) {
    const idx = shuffleQueue.findIndex(t => t.id === currentTrack.id)
    shuffleIndex = idx !== -1 ? idx : 0
  } else {
    shuffleIndex = 0
  }
}

// 随机模式下一首
const getShuffleNext = () => {
  if (!shuffleQueue.length) return null
  shuffleIndex = (shuffleIndex + 1) % shuffleQueue.length
  return shuffleQueue[shuffleIndex]
}

// 随机模式上一首
const getShufflePrev = () => {
  if (!shuffleQueue.length || shuffleIndex < 0) return null
  shuffleIndex = (shuffleIndex - 1 + shuffleQueue.length) % shuffleQueue.length
  return shuffleQueue[shuffleIndex]
}

// 更新随机队列中的当前位置（手动切歌时调用）
const updateShuffleIndex = (trackId) => {
  if (!isRandom || !shuffleQueue.length) return
  const idx = shuffleQueue.findIndex(t => t.id === trackId)
  if (idx !== -1) {
    shuffleIndex = idx
  }
}

const playTrack = (id) => {
  const currentTracks = getCurrentTracks()
  const track = currentTracks.find(t => t.id === id)
  if (!track) return

  if (currentTrack && currentTrack.path === track.path) {
    // 继续播放
    musicAudio.play()
    isPlaying = true
    updatePlayButton(true)
    updateCoverRotation(true)
    updateTrackRowPlayingState(prevPlayingTrack, currentTrack)
    prevPlayingTrack = currentTrack
    return
  }

  // 播放新歌
  const oldTrack = currentTrack
  currentTrack = track
  musicAudio.src = track.path
  musicAudio.play()
  isPlaying = true
  updatePlayButton(true)
  updateCoverRotation(true)
  updateTrackRowPlayingState(oldTrack, currentTrack)
  prevPlayingTrack = currentTrack
  updateShuffleIndex(track.id)
  savePlaybackState()
}

const pauseTrack = () => {
  musicAudio.pause()
  isPlaying = false
  updatePlayButton(false)
  updateCoverRotation(false)
  updateTrackRowPlayingState(null, currentTrack)
}

// ========================= 封面与标签读取 =========================
const setPlayerCover = (src) => {
  const coverWrapper = document.querySelector('.cover-wrapper')
  if (coverWrapper) {
    coverWrapper.innerHTML = `<img src="${src}" alt="cover" id="current-cover">`
  }
}

const readMP3Cover = (filePath) => {
  jsmediatags.read(filePath, {
    onSuccess: function (tag) {
      const { picture } = tag.tags
      if (picture) {
        const base64String = arrayBufferToBase64(picture.data)
        const coverImageSrc = `data:${picture.format};base64,${base64String}`
        setPlayerCover(coverImageSrc)
        updateListCover(currentTrack.id, coverImageSrc)
      } else {
        fetchSongInfo().then(songInfo => {
          return getCover(songInfo.id)
        }).then(cover => {
          setPlayerCover(cover)
          updateListCover(currentTrack.id, cover)
        }).catch(() => {
          // 保持placeholder
        })
      }
    },
    onError: function (error) {
      console.error('Error reading MP3 tags:', error)
    }
  })
}

const arrayBufferToBase64 = (buffer) => {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

const updateListCover = (trackId, src) => {
  const placeholder = document.querySelector(`[data-cover-id="${trackId}"]`)
  if (placeholder) {
    placeholder.outerHTML = `<img src="${src}" alt="" data-cover-id="${trackId}">`
  }
}

const loadCover = () => {
  if (!currentTrack) return
  readMP3Cover(currentTrack.path)
}

const readTrackMeta = (filePath) => {
  jsmediatags.read(filePath, {
    onSuccess: function (tag) {
      const { title, artist, album } = tag.tags
      if (artist) $('current-artist').textContent = artist
      // 更新列表中的艺术家和专辑
      const row = document.querySelector(`.track-row[data-id="${currentTrack.id}"]`)
      if (row) {
        const artistCell = row.querySelector('.track-artist')
        const albumCell = row.querySelector('.track-album')
        if (artistCell && artist) artistCell.textContent = artist
        if (albumCell && album) albumCell.textContent = album
      }
    },
    onError: function () {
      // 静默失败
    }
  })
}

// ========================= 歌词 =========================
const loadLrc = async () => {
  currentLyricIndex = 0
  const lyricsPath = currentTrack.path.replace(/\.mp3$/i, '.lrc')
  return await parseLyricsFile(lyricsPath)
}

// ========================= 频谱图 =========================
let analyser
let dataArray
let bufferLength
let audioContext
let sourceConnected = false

// 获取当前曲目的准确时长（优先使用 music-metadata 预读值，解决 FLAC duration 为 Infinity 的问题）
const getTrackDuration = () => {
  if (!currentTrack) return 0
  const cached = trackMetaCache[currentTrack.path]
  if (cached && cached.durationSec && isFinite(cached.durationSec)) {
    return cached.durationSec
  }
  return musicAudio.duration && isFinite(musicAudio.duration) ? musicAudio.duration : 0
}

const initAudioContext = () => {
  if (audioContext) return
  audioContext = new (window.AudioContext || window.webkitAudioContext)()
  analyser = audioContext.createAnalyser()
  const source = audioContext.createMediaElementSource(musicAudio)
  source.connect(analyser)
  analyser.connect(audioContext.destination)
  analyser.fftSize = 512
  bufferLength = analyser.frequencyBinCount
  dataArray = new Uint8Array(bufferLength)
  sourceConnected = true
}

const updateSpectrumCtx = () => {
  if (!analyser) return
  analyser.getByteFrequencyData(dataArray)

  const canvas = document.getElementById('music-spectrum')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const w = canvas.clientWidth || canvas.width
  const h = canvas.clientHeight || canvas.height
  ctx.clearRect(0, 0, w, h)

  // 迷你频谱条（根据宽度自适应条数）
  const bars = Math.min(64, Math.max(24, Math.floor(w / 4)))
  const step = Math.floor(bufferLength / bars)
  const barW = (w / bars) * 0.65
  const gap = (w / bars) * 0.35

  for (let i = 0; i < bars; i++) {
    let sum = 0
    for (let j = 0; j < step; j++) {
      sum += dataArray[i * step + j]
    }
    const avg = sum / step
    const barHeight = Math.max(1, (avg / 255) * h)

    const x = i * (barW + gap) + gap / 2
    const y = h - barHeight

    ctx.fillStyle = 'rgb(231, 76, 60)'
    ctx.fillRect(x, y, barW, barHeight)
  }
}

// ========================= 音频事件监听 =========================
musicAudio.addEventListener('loadedmetadata', async () => {
  const duration = getTrackDuration() || musicAudio.duration
  renderPlayerHTML(currentTrack.fileName, duration)
  if (!sourceConnected) initAudioContext()
  updateProgressHTML(musicAudio.currentTime, duration)
  curLyrics = await loadLrc()
})

musicAudio.addEventListener('timeupdate', () => {
  const duration = getTrackDuration()
  updateProgressHTML(musicAudio.currentTime, duration)
  updateSpectrumCtx()

  // 歌词处理（简化版，保留在播放器状态中）
  if (curLyrics && curLyrics.length) {
    const currentLyricTime = currentLyricIndex >= curLyrics.length
      ? duration
      : curLyrics[currentLyricIndex].time

    if (musicAudio.currentTime >= currentLyricTime) {
      try {
        currentLyricIndexAnimationDuration = (curLyrics[currentLyricIndex + 1].time - curLyrics[currentLyricIndex].time)
      } catch (e) {
        currentLyricIndexAnimationDuration = duration - curLyrics[currentLyricIndex].time
      }

      const currentText = curLyrics[currentLyricIndex].text
      const nextLyricText = curLyrics[currentLyricIndex + 1] ? curLyrics[currentLyricIndex + 1].text : ''
      const duration = currentLyricIndexAnimationDuration

      curLyricDisplayText = currentText
      ipcRenderer.send('updateDeskLyric', {
        text: currentText,
        duration: duration,
        next: nextLyricText
      })
      currentLyricIndex++
    }
  }
})

musicAudio.addEventListener('ended', async () => {
  const currentTracks = getCurrentTracks()
  const oldTrack = currentTrack
  if (isLooping) {
    musicAudio.currentTime = 0
    musicAudio.play()
    await loadLrc()
  } else if (isRandom) {
    const nextTrack = getShuffleNext()
    if (nextTrack) {
      currentTrack = nextTrack
      musicAudio.src = currentTrack.path
      musicAudio.play()
      renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
      updateTrackRowPlayingState(oldTrack, currentTrack)
      prevPlayingTrack = currentTrack
    }
  } else {
    const currentIndex = currentTracks.findIndex(track => track.id === currentTrack.id)
    const nextIndex = (currentIndex + 1) % currentTracks.length
    currentTrack = currentTracks[nextIndex]
    musicAudio.src = currentTrack.path
    musicAudio.play()
    renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
    updateTrackRowPlayingState(oldTrack, currentTrack)
    prevPlayingTrack = currentTrack
  }
})

musicAudio.addEventListener('play', () => {
  isPlaying = true
  updatePlayButton(true)
  updateCoverRotation(true)
  updateTrackRowPlayingState(prevPlayingTrack, currentTrack)
  prevPlayingTrack = currentTrack
  const title = currentTrack ? currentTrack.fileName.replace(/\.(mp3|flac|wav|aac|ogg|m4a)$/i, '') : ''
  ipcRenderer.send('playback-status-changed', { isPlaying: true, title })
})

musicAudio.addEventListener('pause', () => {
  isPlaying = false
  updatePlayButton(false)
  updateCoverRotation(false)
  updateTrackRowPlayingState(null, currentTrack)
  const title = currentTrack ? currentTrack.fileName.replace(/\.(mp3|flac|wav|aac|ogg|m4a)$/i, '') : ''
  ipcRenderer.send('playback-status-changed', { isPlaying: false, title })
})

// ========================= 按钮事件绑定 =========================

// 播放/暂停按钮
$('play-pause-button').addEventListener('click', () => {
  const currentTracks = getCurrentTracks()
  if (!currentTracks || !currentTracks.length) return
  if (!currentTrack) {
    playTrack(currentTracks[0].id)
  } else if (isPlaying) {
    pauseTrack()
  } else {
    musicAudio.play()
  }
})

// 上一曲
$('previous-button').addEventListener('click', () => {
  const currentTracks = getCurrentTracks()
  if (!currentTracks || !currentTracks.length || !currentTrack) return
  if (isRandom) {
    const prevTrack = getShufflePrev()
    if (prevTrack) playTrack(prevTrack.id)
  } else {
    const currentIndex = currentTracks.findIndex(track => track.id === currentTrack.id)
    const previousIndex = (currentIndex - 1 + currentTracks.length) % currentTracks.length
    playTrack(currentTracks[previousIndex].id)
  }
})

// 下一曲
$('next-button').addEventListener('click', () => {
  const currentTracks = getCurrentTracks()
  if (!currentTracks || !currentTracks.length || !currentTrack) return
  if (isRandom) {
    const nextTrack = getShuffleNext()
    if (nextTrack) playTrack(nextTrack.id)
  } else {
    const currentIndex = currentTracks.findIndex(track => track.id === currentTrack.id)
    const nextIndex = (currentIndex + 1) % currentTracks.length
    playTrack(currentTracks[nextIndex].id)
  }
})

// 停止
const stopButton = document.getElementById('stop-button')
if (stopButton) {
  stopButton.addEventListener('click', () => {
    const currentTracks = getCurrentTracks()
    if (!currentTracks || !currentTracks.length) return
    musicAudio.pause()
    musicAudio.currentTime = 0
    isPlaying = false
    currentTrack = null
    curLyrics = null
    updatePlayButton(false)
    updateCoverRotation(false)
    renderPlayerHTML(null, 0)
    renderListHTML(getCurrentTracks())
  })
}

// 进度条点击
$('progress-bar').addEventListener('click', (event) => {
  const duration = getTrackDuration()
  if (!duration) return
  const rect = $('progress-bar').getBoundingClientRect()
  const percentage = (event.clientX - rect.left) / rect.width
  musicAudio.currentTime = duration * percentage
  updateProgressHTML(musicAudio.currentTime, duration)
})

// 音量控制
let currentVolume = 0.7
musicAudio.volume = currentVolume

const updateVolumeUI = (vol) => {
  $('volume-fill').style.width = (vol * 100) + '%'
  const muteBtn = $('mute-button')
  const muteIcon = muteBtn.querySelector('i')
  if (vol === 0) {
    muteIcon.className = 'fas fa-volume-mute'
  } else if (vol < 0.5) {
    muteIcon.className = 'fas fa-volume-down'
  } else {
    muteIcon.className = 'fas fa-volume-up'
  }
}

updateVolumeUI(currentVolume)

$('volume-slider').addEventListener('click', (event) => {
  const rect = $('volume-slider').getBoundingClientRect()
  const percentage = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  currentVolume = percentage
  musicAudio.volume = currentVolume
  updateVolumeUI(currentVolume)
})

let isMuted = false
let preMuteVolume = 0.7

$('mute-button').addEventListener('click', () => {
  if (isMuted) {
    musicAudio.volume = preMuteVolume
    currentVolume = preMuteVolume
    isMuted = false
  } else {
    preMuteVolume = currentVolume
    musicAudio.volume = 0
    currentVolume = 0
    isMuted = true
  }
  updateVolumeUI(currentVolume)
})

// 单曲循环
const loopButton = $('loop-button')
let isLooping = false

loopButton.addEventListener('click', () => {
  isLooping = !isLooping
  loopButton.classList.toggle('active', isLooping)
  ipcRenderer.send('isLooping', isLooping)
  if (isLooping && isRandom) {
    isRandom = false
    randomButton.classList.remove('active')
    ipcRenderer.send('isRandom', false)
  }
})

// 随机播放
const randomButton = $('random-button')
let isRandom = false

randomButton.addEventListener('click', () => {
  isRandom = !isRandom
  randomButton.classList.toggle('active', isRandom)
  ipcRenderer.send('isRandom', isRandom)
  if (isRandom) {
    // 开启随机时生成队列
    generateShuffleQueue(getCurrentTracks())
    if (isLooping) {
      isLooping = false
      loopButton.classList.remove('active')
      ipcRenderer.send('isLooping', false)
    }
  } else {
    // 关闭随机时清空队列
    shuffleQueue = []
    shuffleIndex = -1
  }
})

// 暗色模式
$('dark-mode-button').addEventListener('click', () => {
  const body = document.body
  const icon = $('dark-mode-button').querySelector('i')
  body.classList.toggle('dark-mode')

  if (body.classList.contains('dark-mode')) {
    icon.classList.remove('fa-moon')
    icon.classList.add('fa-sun')
    $('dark-mode-button').title = '亮色模式'
  } else {
    icon.classList.remove('fa-sun')
    icon.classList.add('fa-moon')
    $('dark-mode-button').title = '暗色模式'
  }

  ipcRenderer.send('toggle-dark-mode', body.classList.contains('dark-mode'))
})

ipcRenderer.on('apply-dark-mode', (event, isDarkMode) => {
  const body = document.body
  const icon = $('dark-mode-button').querySelector('i')
  if (isDarkMode) {
    body.classList.add('dark-mode')
    icon.classList.remove('fa-moon')
    icon.classList.add('fa-sun')
    $('dark-mode-button').title = '亮色模式'
  } else {
    body.classList.remove('dark-mode')
    icon.classList.remove('fa-sun')
    icon.classList.add('fa-moon')
    $('dark-mode-button').title = '暗色模式'
  }
})

// 桌面歌词
let isLyricWindowOpen = false
$('show-lrc').addEventListener('click', () => {
  if (isLyricWindowOpen) {
    ipcRenderer.send('closeLyricWindow')
  } else {
    ipcRenderer.send('showLyricWindow')
    ipcRenderer.send('updateDeskLyric', {
      text: curLyricDisplayText || '歌词加载中...',
      duration: 3,
      next: ''
    })
  }
})

ipcRenderer.on('updateLyricWindowStatus', (event, isOpen) => {
  isLyricWindowOpen = isOpen
  $('show-lrc').classList.toggle('active', isOpen)
})

// 添加歌曲
$('add-music-button').addEventListener('click', () => {
  ipcRenderer.send('add-music-window', document.body.classList.contains('dark-mode'), currentPlaylistId)
})

// 启动状态恢复
ipcRenderer.on('LyricWindowStatus', (event, isOpen) => {
  if (isOpen) $('show-lrc').click()
})

ipcRenderer.on('RandomStatus', (event, isOpen) => {
  if (isOpen) randomButton.click()
})

ipcRenderer.on('LoopStatus', (event, isOpen) => {
  if (isOpen) loopButton.click()
})

ipcRenderer.on('DarkStatus', (event, isOpen) => {
  if (isOpen) $('dark-mode-button').click()
})

// ========================= 网易云API =========================
const fetchSongInfo = async () => {
  let songTitle = ''
  let artistName = ''

  // 1. 优先从已缓存的元数据获取
  const cached = trackMetaCache[currentTrack.path]
  if (cached) {
    songTitle = cached.title || ''
    artistName = (cached.artist && cached.artist !== '--') ? cached.artist : ''
  }

  // 2. 缓存没有或信息不全，尝试用 jsmediatags 轻量读取
  if (!songTitle || !artistName) {
    try {
      const tags = await new Promise((resolve, reject) => {
        jsmediatags.read(currentTrack.path, {
          onSuccess: (tag) => resolve(tag.tags),
          onError: (error) => reject(error)
        })
      })
      if (tags) {
        if (!songTitle) songTitle = tags.title || ''
        if (!artistName) artistName = tags.artist || ''
      }
    } catch (e) {
      // 静默失败，继续用文件名兜底
    }
  }

  // 3. 标签拿不到，通过文件名截取
  if (!songTitle) {
    songTitle = currentTrack.fileName.replace(/\.(mp3|flac|wav|aac|ogg|m4a)$/i, '')
  }

  const songInfo = await getSong(songTitle, artistName)
  return songInfo
}

const getSong = async (songName, artistName) => {
  const searchUrl = `http://music.163.com/api/search/get/?s=${encodeURIComponent(`${artistName} ${songName}`)}&limit=1&type=1&offset=0`
  const response = await fetch(searchUrl)
  const data = await response.json()
  if (data.code === 200 && data.result.songs.length > 0) {
    return data.result.songs[0]
  }
  throw new Error('Failed to get song List')
}

const getLyrics = async (songId) => {
  const lyricsUrl = `http://music.163.com/api/song/lyric?os=osx&id=${songId}&lv=-1&kv=-1&tv=-1`
  const response = await fetch(lyricsUrl)
  const data = await response.json()
  if (data.code === 200 && data.lrc && data.lrc.lyric) {
    return data.lrc.lyric
  }
  throw new Error('Failed to get lyrics')
}

const getCover = async (songId) => {
  const detailUrl = `http://music.163.com/api/song/detail?id=${songId}&ids=[${songId}]&csrf_token=`
  const response = await fetch(detailUrl)
  const data = await response.json()
  if (data.code === 200 && data.songs && data.songs[0].album.blurPicUrl) {
    return data.songs[0].album.blurPicUrl
  }
  throw new Error('Failed to get Cover')
}

// ========================= 歌词解析 =========================
const parseLyricsFile = async (path) => {
  const fs = require('fs')
  const jschardet = require('jschardet')
  const iconv = require('iconv-lite')

  try {
    if (fs.existsSync(path)) {
      const buffer = fs.readFileSync(path)
      const detectedEncoding = jschardet.detect(buffer)
      const encoding = detectedEncoding.encoding
      const lyricsContent = iconv.decode(buffer, encoding)
      return parseLyrics(lyricsContent)
    }
    const songInfo = await fetchSongInfo()
    const lyrics = await getLyrics(songInfo.id)
    fs.writeFileSync(path, lyrics)
    return parseLyrics(lyrics)
  } catch (error) {
    console.error('Error reading lyrics file:', error)
    return []
  }
}

const parseLyrics = (lyricsText) => {
  const lines = lyricsText.toString().split('\n')
  const lyrics = []

  for (let line of lines) {
    const timeMatches = line.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?]/)
    const metadataMatches = line.match(/^\[([^\]]+)\]/)

    if (timeMatches) {
      const minutes = parseInt(timeMatches[1])
      const seconds = parseInt(timeMatches[2])
      let milliseconds = 0
      if (timeMatches[3]) {
        milliseconds = parseInt(timeMatches[3])
        if (timeMatches[3].length === 2) milliseconds *= 10
      }
      const time = minutes * 60 + seconds + milliseconds / 1000
      const text = line.replace(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?]/, '').trim()
      if (time && text) lyrics.push({ time, text })
    } else if (metadataMatches) {
      const text = metadataMatches[1].trim()
      if (text) lyrics.push({ time: 0.00, text })
    } else {
      if (line.trim()) lyrics.push({ time: 0.00 + lyrics.length, text: line.trim() })
    }
  }
  return lyrics
}

// ========================= 歌单管理 =========================

const renderPlaylists = () => {
  const container = document.getElementById('playlists-container')
  if (!container) return

  const html = playlists.map(pl => {
    const isActive = currentPlaylistId === pl.id
    return `
      <div class="playlist-item ${isActive ? 'active' : ''}" data-id="${pl.id}">
        <i class="fas fa-list-music"></i>
        <span class="playlist-name">${pl.name}</span>
        <div class="playlist-actions">
          <button class="btn-icon btn-edit-playlist" data-id="${pl.id}" title="重命名">
            <i class="fas fa-pen"></i>
          </button>
          <button class="btn-icon btn-delete-playlist" data-id="${pl.id}" title="删除">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
    `
  }).join('')

  container.innerHTML = html

  // 绑定歌单点击事件
  container.querySelectorAll('.playlist-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-icon')) return
      const id = item.dataset.id
      if (!id) return
      switchPlaylist(id)
    })
  })

  // 绑定删除歌单
  container.querySelectorAll('.btn-delete-playlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      const pl = playlists.find(p => p.id === id)
      if (pl && confirm(`确定删除歌单「${pl.name}」吗？`)) {
        ipcRenderer.send('delete-playlist', id)
        if (currentPlaylistId === id) {
          switchPlaylist('all')
        }
      }
    })
  })

  // 绑定重命名歌单
  container.querySelectorAll('.btn-edit-playlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      const pl = playlists.find(p => p.id === id)
      if (pl) showPlaylistDialog('rename', id, pl.name)
    })
  })
}

const switchPlaylist = (id) => {
  currentPlaylistId = id
  savePlaybackState()

  // 更新侧边栏激活状态
  document.querySelectorAll('.nav-item, .playlist-item').forEach(el => el.classList.remove('active'))
  const activeEl = document.querySelector(`[data-id="${id}"]`)
  if (activeEl) activeEl.classList.add('active')

  // 更新页面标题
  const pageTitle = document.querySelector('.page-title')
  if (pageTitle) {
    if (id === 'all') {
      pageTitle.textContent = '默认'
    } else {
      const pl = playlists.find(p => p.id === id)
      pageTitle.textContent = pl ? pl.name : '歌单'
    }
  }

  // 重新渲染列表
  renderListHTML(getCurrentTracks())
  // 切换歌单后重置随机队列
  if (isRandom) generateShuffleQueue(getCurrentTracks())
}

// ========================= 拖拽排序 =========================

const bindDragEvents = () => {
  const rows = document.querySelectorAll('.track-row')
  rows.forEach(row => {
    row.addEventListener('dragstart', handleDragStart)
    row.addEventListener('dragover', handleDragOver)
    row.addEventListener('dragleave', handleDragLeave)
    row.addEventListener('drop', handleDrop)
    row.addEventListener('dragend', handleDragEnd)
  })
}

const handleDragStart = (e) => {
  dragSrcEl = e.target.closest('.track-row')
  if (!dragSrcEl) {
    e.preventDefault()
    return
  }
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', dragSrcEl.dataset.id)
  dragSrcEl.classList.add('dragging')
}

const handleDragOver = (e) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  const row = e.target.closest('.track-row')
  if (row && row !== dragSrcEl) {
    row.classList.add('drag-over')
  }
}

const handleDragLeave = (e) => {
  const row = e.target.closest('.track-row')
  if (row) row.classList.remove('drag-over')
}

const handleDrop = (e) => {
  e.preventDefault()
  const dropTarget = e.target.closest('.track-row')
  if (!dropTarget || !dragSrcEl || dropTarget === dragSrcEl) return

  const draggedId = dragSrcEl.dataset.id
  const targetId = dropTarget.dataset.id

  // 获取当前 tracks
  const currentTracks = getCurrentTracks()
  const draggedIndex = currentTracks.findIndex(t => t.id === draggedId)
  const targetIndex = currentTracks.findIndex(t => t.id === targetId)

  if (draggedIndex === -1 || targetIndex === -1) return

  // 如果是全部歌曲，需要重新排序当前歌单的 tracks
  if (currentPlaylistId === 'all') {
    const playlist = playlists.find(p => p.id === 'all')
    if (playlist) {
      const [moved] = playlist.tracks.splice(draggedIndex, 1)
      playlist.tracks.splice(targetIndex, 0, moved)
      // 保存到 store
      ipcRenderer.send('reorder-tracks', { playlistId: 'all', trackIds: playlist.tracks.map(t => t.id) })
    }
  } else {
    // 如果是歌单，重新排序歌单的 tracks
    const playlist = playlists.find(p => p.id === currentPlaylistId)
    if (playlist) {
      const [moved] = playlist.tracks.splice(draggedIndex, 1)
      playlist.tracks.splice(targetIndex, 0, moved)
      ipcRenderer.send('reorder-tracks', { playlistId: currentPlaylistId, trackIds: playlist.tracks.map(t => t.id) })
    }
  }

  renderListHTML(getCurrentTracks(), true)
}

const handleDragEnd = (e) => {
  document.querySelectorAll('.track-row').forEach(row => {
    row.classList.remove('dragging', 'drag-over')
  })
  dragSrcEl = null
}

// ========================= 添加到歌单菜单 =========================

let menuTrackId = null

const showPlaylistMenu = (btn, trackId) => {
  menuTrackId = trackId
  const menu = document.getElementById('playlist-menu')
  const list = document.getElementById('playlist-menu-list')
  if (!menu || !list) return

  // 渲染歌单列表（排除已包含该歌曲的歌单）
  const availablePlaylists = playlists.filter(pl => {
    if (pl.id === 'all') return false
    return !pl.tracks.some(t => t.path === currentTrack?.path)
  })

  if (availablePlaylists.length === 0) {
    list.innerHTML = '<div class="playlist-menu-item" style="color:var(--text-muted)">没有可添加的歌单</div>'
  } else {
    list.innerHTML = availablePlaylists.map(pl =>
      `<div class="playlist-menu-item" data-playlist-id="${pl.id}">${pl.name}</div>`
    ).join('')
  }

  // 定位菜单
  const rect = btn.getBoundingClientRect()
  menu.style.left = rect.left + 'px'
  menu.style.top = (rect.bottom + 4) + 'px'
  menu.classList.remove('hidden')

  // 绑定点击
  list.querySelectorAll('.playlist-menu-item[data-playlist-id]').forEach(item => {
    item.addEventListener('click', () => {
      const targetPlaylistId = item.dataset.playlistId
      ipcRenderer.send('add-to-playlist', { sourcePlaylistId: currentPlaylistId, targetPlaylistId, trackId: menuTrackId })
      hidePlaylistMenu()
    })
  })

  // 点击外部关闭
  setTimeout(() => {
    document.addEventListener('click', hidePlaylistMenuOnClick, { once: true })
  }, 10)
}

const hidePlaylistMenu = () => {
  const menu = document.getElementById('playlist-menu')
  if (menu) menu.classList.add('hidden')
  menuTrackId = null
}

const hidePlaylistMenuOnClick = (e) => {
  const menu = document.getElementById('playlist-menu')
  if (menu && !menu.contains(e.target)) {
    hidePlaylistMenu()
  }
}

// ========================= 歌单对话框 =========================

let dialogMode = 'create' // 'create' | 'rename'
let editingPlaylistId = null

const showPlaylistDialog = (mode, playlistId = null, currentName = '') => {
  dialogMode = mode
  editingPlaylistId = playlistId
  const dialog = document.getElementById('playlist-dialog')
  const title = document.getElementById('dialog-title')
  const input = document.getElementById('playlist-name-input')

  if (!dialog || !title || !input) return

  title.textContent = mode === 'create' ? '新建歌单' : '重命名歌单'
  input.value = currentName
  dialog.classList.remove('hidden')
  input.focus()
}

const hidePlaylistDialog = () => {
  const dialog = document.getElementById('playlist-dialog')
  const input = document.getElementById('playlist-name-input')
  if (dialog) dialog.classList.add('hidden')
  if (input) input.value = ''
  editingPlaylistId = null
}

// 定位当前歌曲（仅在当前歌单内查找，不切换歌单）
const locateCurrentTrack = () => {
  if (!currentTrack) return

  const tracks = getCurrentTracks()
  const trackIndex = tracks.findIndex(t => t.id === currentTrack.id)
  if (trackIndex === -1) return

  // 计算目标滚动位置，使歌曲进入虚拟视口
  const contentBody = document.querySelector('.content-body')
  const targetScrollTop = trackIndex * ITEM_HEIGHT
  contentBody.scrollTop = targetScrollTop

  // 同步更新虚拟视口，确保目标行渲染到 DOM 中
  updateVirtualViewport()

  // 现在目标行应该在 DOM 中
  const row = document.querySelector(`.track-row[data-id="${currentTrack.id}"]`)
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 高亮闪烁效果
    row.style.transition = 'none'
    row.style.background = 'var(--active-bg)'
    setTimeout(() => {
      row.style.transition = ''
      row.style.background = ''
    }, 800)
  }
}

// ========================= 歌单事件绑定 =========================

// 全部歌曲导航项点击
document.querySelectorAll('.nav-item[data-id]').forEach(item => {
  item.addEventListener('click', (e) => {
    const id = item.dataset.id
    if (id && id !== currentPlaylistId) {
      switchPlaylist(id)
    }
  })
})

// 新建歌单按钮
document.getElementById('btn-new-playlist')?.addEventListener('click', () => {
  showPlaylistDialog('create')
})

// 对话框确认
document.getElementById('dialog-confirm')?.addEventListener('click', (e) => {
  e.stopPropagation()
  const input = document.getElementById('playlist-name-input')
  const name = input?.value.trim()
  if (!name) return

  if (dialogMode === 'create') {
    ipcRenderer.send('create-playlist', name)
  } else if (dialogMode === 'rename' && editingPlaylistId) {
    ipcRenderer.send('rename-playlist', { id: editingPlaylistId, name })
  }
  hidePlaylistDialog()
})

// 对话框取消
document.getElementById('dialog-cancel')?.addEventListener('click', (e) => {
  e.stopPropagation()
  hidePlaylistDialog()
})

// 回车确认
document.getElementById('playlist-name-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('dialog-confirm')?.click()
  if (e.key === 'Escape') hidePlaylistDialog()
})

// 定位按钮
document.getElementById('locate-track')?.addEventListener('click', locateCurrentTrack)

// 歌单更新 IPC
ipcRenderer.on('playlists-data', (event, data) => {
  playlists = data
  renderPlaylists()
  renderListHTML(getCurrentTracks())
  // 歌单变化后重置随机队列
  if (isRandom) generateShuffleQueue(getCurrentTracks())
  // 如果有待恢复的播放状态，执行恢复
  if (pendingPlaybackState) {
    restorePlaybackState(pendingPlaybackState)
    pendingPlaybackState = null
  }
})

ipcRenderer.on('playlists-updated', (event, updatedPlaylists) => {
  playlists = updatedPlaylists
  renderPlaylists()
  renderListHTML(getCurrentTracks())
  // 歌单变化后重置随机队列
  if (isRandom) generateShuffleQueue(getCurrentTracks())
})

ipcRenderer.on('playback-state', (event, state) => {
  if (playlists.length > 0) {
    restorePlaybackState(state)
  } else {
    pendingPlaybackState = state
  }
})

ipcRenderer.on('playlist-created', (event, playlist) => {
  // 自动切换到新歌单
  switchPlaylist(playlist.id)
})

// 监听外部文件打开（系统文件关联/命令行传入）
ipcRenderer.on('open-external-file', (event, filePath) => {
  // 确保歌单数据已加载
  const playlist = playlists.find(p => p.id === 'all')
  if (!playlist) return
  const track = playlist.tracks.find(t => t.path === filePath)
  if (track) {
    switchPlaylist('all')
    playTrack(track.id)
  }
})

// ========================= 修改现有事件 =========================

// 修改搜索，在当前歌单内搜索（带防抖）
const searchInput = document.getElementById('search-input')
let searchDebounceTimer = null
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(() => {
      const keyword = e.target.value.trim().toLowerCase()
      if (!keyword) {
        renderListHTML(getCurrentTracks())
        return
      }
      const filtered = getCurrentTracks().filter(track =>
        track.fileName.toLowerCase().includes(keyword)
      )
      renderListHTML(filtered)
    }, 150)
  })
}

// ========================= 系统托盘控制 =========================

// 监听托盘发来的播放/暂停指令
ipcRenderer.on('tray-play-pause', () => {
  const currentTracks = getCurrentTracks()
  if (!currentTracks || !currentTracks.length) return
  if (!currentTrack) {
    playTrack(currentTracks[0].id)
  } else if (isPlaying) {
    pauseTrack()
  } else {
    musicAudio.play()
  }
})

// 监听托盘发来的下一曲指令
ipcRenderer.on('tray-next', () => {
  const currentTracks = getCurrentTracks()
  if (!currentTracks || !currentTracks.length || !currentTrack) return
  if (isRandom) {
    const nextTrack = getShuffleNext()
    if (nextTrack) playTrack(nextTrack.id)
  } else {
    const currentIndex = currentTracks.findIndex(track => track.id === currentTrack.id)
    const nextIndex = (currentIndex + 1) % currentTracks.length
    playTrack(currentTracks[nextIndex].id)
  }
})

// ========================= 设为默认播放器 =========================

const defaultPlayerBtn = document.getElementById('set-default-player')

const updateDefaultPlayerBtn = (isDefault) => {
  if (!defaultPlayerBtn) return
  if (isDefault) {
    defaultPlayerBtn.classList.add('active')
    defaultPlayerBtn.title = '已是默认音乐播放器'
  } else {
    defaultPlayerBtn.classList.remove('active')
    defaultPlayerBtn.title = '打开默认应用设置，手动设为默认播放器'
  }
}

if (defaultPlayerBtn) {
  // 非 Windows 系统隐藏该按钮
  if (process.platform !== 'win32') {
    defaultPlayerBtn.style.display = 'none'
  } else {
    defaultPlayerBtn.addEventListener('click', () => {
      // 先写入注册表确保 Northpark 出现在默认应用列表中，再打开设置界面
      ipcRenderer.send('set-default-player')
    })
  }
}

// 监听默认播放器设置结果
ipcRenderer.on('default-player-result', (event, { success, message }) => {
  if (success) {
    updateDefaultPlayerBtn(true)
    // 打开 Windows 默认应用设置界面
    ipcRenderer.send('open-default-apps-settings')
    alert('Northpark 已注册到默认应用列表，即将打开系统设置。\n\n请在"默认应用"设置中，将"音乐播放器"手动设为 Northpark。')
  } else {
    alert('设置失败: ' + message)
  }
})

// 监听默认播放器状态
ipcRenderer.on('default-player-status', (event, isDefault) => {
  updateDefaultPlayerBtn(isDefault)
})

// 启动时检测是否已是默认播放器
if (process.platform === 'win32') {
  ipcRenderer.send('check-default-player')
}

// ========================= 生成托盘图标 =========================

const drawMusicNoteFallback = (ctx, color) => {
  // 完全不依赖外部字体，用 Canvas 路径手动绘制一个简洁的八分音符
  ctx.fillStyle = color

  // 音符头部（椭圆）
  ctx.beginPath()
  ctx.ellipse(10, 23, 6.5, 5, -0.4, 0, Math.PI * 2)
  ctx.fill()

  // 符杆
  ctx.fillRect(14.5, 5, 2.5, 19)

  // 符尾（贝塞尔曲线填充）
  ctx.beginPath()
  ctx.moveTo(17, 5)
  ctx.bezierCurveTo(25, 8, 27, 14, 23, 19)
  ctx.lineTo(23, 17)
  ctx.bezierCurveTo(25, 13, 23, 9, 17, 7)
  ctx.closePath()
  ctx.fill()
}

const canvasHasVisibleContent = (ctx, width, height) => {
  try {
    const imageData = ctx.getImageData(0, 0, width, height)
    // 检查是否存在非透明像素（alpha > 10，避免抗锯齿边缘误判）
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] > 10) return true
    }
  } catch (e) { /* ignore */ }
  return false
}

const generateTrayIcon = async () => {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    const color = document.body.classList.contains('dark-mode') ? '#8b5cf6' : '#e74c3c'

    // 清除画布（透明背景）
    ctx.clearRect(0, 0, 32, 32)

    // 先尝试用 Font Awesome 字体渲染
    await document.fonts.ready
    try {
      await document.fonts.load('900 22px "Font Awesome 5 Free"')
    } catch (e) { /* ignore */ }

    ctx.font = '900 22px "Font Awesome 5 Free", "FontAwesome", sans-serif'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('\uf001', 16, 16)

    // 检测字体是否真正渲染成功（打包后无网络时字体可能加载失败）
    if (!canvasHasVisibleContent(ctx, 32, 32)) {
      // 字体渲染失败，使用路径回退绘制
      ctx.clearRect(0, 0, 32, 32)
      drawMusicNoteFallback(ctx, color)
    }

    const dataUrl = canvas.toDataURL('image/png')
    ipcRenderer.send('tray-icon-data', dataUrl)
  } catch (e) {
    console.error('生成托盘图标失败:', e)
  }
}

// 页面加载后生成并发送托盘图标
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', generateTrayIcon)
} else {
  generateTrayIcon()
}

// 修改清空按钮：如果是歌单视图，只清空当前歌单
const cleanBtn = document.getElementById('clean-list-button')
if (cleanBtn) {
  cleanBtn.addEventListener('click', () => {
    const currentTracks = getCurrentTracks()
    if (!currentTracks || !currentTracks.length) return

    if (currentPlaylistId !== 'all') {
      // 清空当前歌单
      const playlist = playlists.find(p => p.id === currentPlaylistId)
      if (playlist && confirm(`确定清空歌单「${playlist.name}」吗？`)) {
        ipcRenderer.send('clean-tracks', currentPlaylistId)
      }
      return
    }

    // 全部歌曲清空（原有逻辑）
    musicAudio.pause()
    musicAudio.currentTime = 0
    isPlaying = false
    currentTrack = null
    curLyrics = null
    // 清空缓存
    for (const key in trackMetaCache) delete trackMetaCache[key]
    metaLoadedForTracks = null
    updatePlayButton(false)
    updateCoverRotation(false)
    renderPlayerHTML(null, 0)
    renderListHTML(getCurrentTracks())
    ipcRenderer.send('clean-tracks', 'all')
  })
}
