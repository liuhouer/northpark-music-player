const { ipcRenderer } = require('electron')
const { $, convertDuration } = require('./helper')

// 读取歌曲标签
const jsmediatags = require('jsmediatags')

let musicAudio = new Audio()
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

  // 查找并播放对应歌曲（从头播放）
  const track = playlist.tracks.find(t => t.id === trackId)
  if (track) {
    currentTrack = track
    musicAudio.src = track.path
    // 不自动播放，只加载并定位
    musicAudio.load()
    renderPlayerHTML(track.fileName, 0)
    renderListHTML(getCurrentTracks(), true)
  }
}

// ========================= 渲染歌曲列表 =========================
let metaLoadedForTracks = null

const getCurrentTracks = () => {
  const playlist = playlists.find(p => p.id === currentPlaylistId)
  return playlist ? playlist.tracks : []
}

const renderListHTML = (tracks, skipMeta = false) => {
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

  const tracksListHTML = tracks.map((track, index) => {
    const isCurrent = currentTrack && currentTrack.path === track.path
    const isTrackPlaying = isCurrent && isPlaying
    const meta = trackMetaCache[track.path] || {}
    return `
      <div class="track-row ${isCurrent ? 'playing' : ''}" data-id="${track.id}" draggable="true">
        <div class="drag-handle" title="拖动排序">
          <i class="fas fa-grip-vertical"></i>
        </div>
        <div class="track-index">
          <span>${index + 1}</span>
          <i class="fas fa-play play-icon" data-id="${track.id}"></i>
          <div class="playing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class="track-title">
          <div class="cover-placeholder" data-cover-id="${track.id}"><i class="fas fa-music"></i></div>
          <span>${track.fileName.replace(/\.mp3$/i, '')}</span>
        </div>
        <div class="track-artist" data-artist-id="${track.id}">${meta.artist || '--'}</div>
        <div class="track-album" data-album-id="${track.id}">${meta.album || '--'}</div>
        <div class="track-duration" data-duration-id="${track.id}">${meta.duration || '--:--'}</div>
        <div class="track-actions">
          <button class="btn-icon btn-play-track" data-id="${track.id}" title="${isTrackPlaying ? '暂停' : '播放'}">
            <i class="fas ${isTrackPlaying ? 'fa-pause' : 'fa-play'}"></i>
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
  }).join('')

  tracksList.innerHTML = `<div class="tracks-list-content">${tracksListHTML}</div>`

  // 绑定事件
  bindTrackEvents()
  bindDragEvents()

  // 异步读取元数据（仅当tracks变化时）
  const tracksKey = tracks.map(t => t.id).join(',')
  if (!skipMeta && metaLoadedForTracks !== tracksKey && tracks.length > 0) {
    metaLoadedForTracks = tracksKey
    loadTracksMeta(tracks)
  }
}

// 批量异步读取歌曲元数据
const loadTracksMeta = async (tracks) => {
  const mm = require('music-metadata')
  for (const track of tracks) {
    if (trackMetaCache[track.path]) continue // 已缓存则跳过
    try {
      const metadata = await mm.parseFile(track.path)
      const { common, format } = metadata
      const artist = common.artist || common.artists?.join(', ') || '--'
      const album = common.album || '--'
      const duration = format.duration ? convertDuration(format.duration) : '--:--'

      trackMetaCache[track.path] = { artist, album, duration }

      const artistEl = document.querySelector(`[data-artist-id="${track.id}"]`)
      const albumEl = document.querySelector(`[data-album-id="${track.id}"]`)
      const durationEl = document.querySelector(`[data-duration-id="${track.id}"]`)

      if (artistEl) artistEl.textContent = artist
      if (albumEl) albumEl.textContent = album
      if (durationEl) durationEl.textContent = duration
    } catch (e) {
      trackMetaCache[track.path] = { artist: '--', album: '--', duration: '--:--' }
    }
  }
}

const bindTrackEvents = () => {
  // 点击整行播放
  document.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('dblclick', (e) => {
      const id = row.dataset.id
      if (id) playTrack(id)
    })
  })

  // 播放按钮
  document.querySelectorAll('.btn-play-track, .play-icon').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      if (!id) return
      const clickedTrack = getCurrentTracks().find(t => t.id === id)
      if (currentTrack && clickedTrack && currentTrack.path === clickedTrack.path && isPlaying) {
        pauseTrack()
      } else {
        playTrack(id)
      }
    })
  })

  // 删除按钮
  document.querySelectorAll('.btn-delete-track').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      if (!id) return
      if (currentPlaylistId === 'all') {
        ipcRenderer.send('delete-track', { id, playlistId: currentPlaylistId })
      } else {
        ipcRenderer.send('remove-from-playlist', { playlistId: currentPlaylistId, trackId: id })
      }
    })
  })

  // 添加到歌单按钮
  document.querySelectorAll('.btn-add-to-playlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      if (id) showPlaylistMenu(e.target.closest('.btn-add-to-playlist'), id)
    })
  })
}

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

  titleEl.textContent = name.replace(/\.mp3$/i, '')
  artistEl.textContent = '--'
  $('total-time').textContent = convertDuration(duration)
  updatePlayButton(isPlaying)
  updateCoverRotation(isPlaying)

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
    renderListHTML(getCurrentTracks(), true) // 刷新列表图标
    return
  }

  // 播放新歌
  currentTrack = track
  musicAudio.src = track.path
  musicAudio.play()
  isPlaying = true
  updatePlayButton(true)
  updateCoverRotation(true)
  renderListHTML(getCurrentTracks(), true) // 刷新列表图标
  savePlaybackState()
}

const pauseTrack = () => {
  musicAudio.pause()
  isPlaying = false
  updatePlayButton(false)
  updateCoverRotation(false)
  renderListHTML(getCurrentTracks(), true) // 刷新列表图标
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

const initAudioContext = () => {
  if (audioContext) return
  audioContext = new (window.AudioContext || window.webkitAudioContext)()
  analyser = audioContext.createAnalyser()
  const source = audioContext.createMediaElementSource(musicAudio)
  source.connect(analyser)
  analyser.connect(audioContext.destination)
  analyser.fftSize = 2048
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
  renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
  if (!sourceConnected) initAudioContext()
  updateProgressHTML(musicAudio.currentTime, musicAudio.duration)
  curLyrics = await loadLrc()
})

musicAudio.addEventListener('timeupdate', () => {
  updateProgressHTML(musicAudio.currentTime, musicAudio.duration)
  updateSpectrumCtx()

  // 歌词处理（简化版，保留在播放器状态中）
  if (curLyrics && curLyrics.length) {
    const currentLyricTime = currentLyricIndex >= curLyrics.length
      ? musicAudio.duration
      : curLyrics[currentLyricIndex].time

    if (musicAudio.currentTime >= currentLyricTime) {
      try {
        currentLyricIndexAnimationDuration = (curLyrics[currentLyricIndex + 1].time - curLyrics[currentLyricIndex].time)
      } catch (e) {
        currentLyricIndexAnimationDuration = musicAudio.duration - curLyrics[currentLyricIndex].time
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
  if (isLooping) {
    musicAudio.currentTime = 0
    musicAudio.play()
    await loadLrc()
  } else if (isRandom) {
    const randomIndex = Math.floor(Math.random() * currentTracks.length)
    currentTrack = currentTracks[randomIndex]
    musicAudio.src = currentTrack.path
    musicAudio.play()
    renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
    renderListHTML(getCurrentTracks())
  } else {
    const currentIndex = currentTracks.findIndex(track => track.id === currentTrack.id)
    const nextIndex = (currentIndex + 1) % currentTracks.length
    currentTrack = currentTracks[nextIndex]
    musicAudio.src = currentTrack.path
    musicAudio.play()
    renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
    renderListHTML(getCurrentTracks())
  }
})

musicAudio.addEventListener('play', () => {
  isPlaying = true
  updatePlayButton(true)
  updateCoverRotation(true)
  renderListHTML(getCurrentTracks(), true)
})

musicAudio.addEventListener('pause', () => {
  isPlaying = false
  updatePlayButton(false)
  updateCoverRotation(false)
  renderListHTML(getCurrentTracks(), true)
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
  const currentIndex = currentTracks.findIndex(track => track.id === currentTrack.id)
  const previousIndex = (currentIndex - 1 + currentTracks.length) % currentTracks.length
  playTrack(currentTracks[previousIndex].id)
})

// 下一曲
$('next-button').addEventListener('click', () => {
  const currentTracks = getCurrentTracks()
  if (!currentTracks || !currentTracks.length || !currentTrack) return
  const currentIndex = currentTracks.findIndex(track => track.id === currentTrack.id)
  const nextIndex = (currentIndex + 1) % currentTracks.length
  playTrack(currentTracks[nextIndex].id)
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
  if (!musicAudio.duration) return
  const rect = $('progress-bar').getBoundingClientRect()
  const percentage = (event.clientX - rect.left) / rect.width
  musicAudio.currentTime = musicAudio.duration * percentage
  updateProgressHTML(musicAudio.currentTime, musicAudio.duration)
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
  if (isRandom && isLooping) {
    isLooping = false
    loopButton.classList.remove('active')
    ipcRenderer.send('isLooping', false)
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
  const mm = require('music-metadata')
  const metadata = await mm.parseFile(currentTrack.path)
  const { common } = metadata
  const songTitle = common.title || currentTrack.fileName.replace(/\.mp3$/i, '')
  const artistName = common.artist || ''
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

// 定位当前歌曲
const locateCurrentTrack = () => {
  if (!currentTrack) return
  const row = document.querySelector(`.track-row[data-id="${currentTrack.id}"]`)
  if (!row) {
    // 如果不在当前视图，切换到全部歌曲再试
    if (currentPlaylistId !== 'all') {
      switchPlaylist('all')
      setTimeout(() => {
        const r = document.querySelector(`.track-row[data-id="${currentTrack.id}"]`)
        if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
    return
  }
  row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // 高亮闪烁效果
  row.style.transition = 'none'
  row.style.background = 'var(--active-bg)'
  setTimeout(() => {
    row.style.transition = ''
    row.style.background = ''
  }, 800)
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

// ========================= 修改现有事件 =========================

// 修改搜索，在当前歌单内搜索
const searchInput = document.getElementById('search-input')
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.trim().toLowerCase()
    if (!keyword) {
      renderListHTML(getCurrentTracks())
      return
    }
    const filtered = getCurrentTracks().filter(track =>
      track.fileName.toLowerCase().includes(keyword)
    )
    renderListHTML(filtered)
  })
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
