const Store = require('electron-store')
const uuidv4 = require('uuid/v4')
const path = require('path')
class DataStore extends Store {

  //构造函数
  constructor(settings) {
    super(settings)
    this.migrateData()
    this.playlists = this.get('playlists') || []
    // 确保有默认的 'all' 歌单
    if (!this.playlists.find(p => p.id === 'all')) {
      this.playlists.unshift({
        id: 'all',
        name: '默认',
        tracks: []
      })
      this.savePlaylists(this.playlists)
    }
  }

  // 从旧格式迁移数据
  migrateData() {
    const oldTracks = this.get('tracks')
    const oldPlaylists = this.get('playlists')

    // 旧格式：全局 tracks + playlists 含 trackIds
    if (oldTracks && Array.isArray(oldTracks) && oldPlaylists && Array.isArray(oldPlaylists)) {
      const isOldFormat = oldPlaylists.length > 0 && oldPlaylists[0].trackIds !== undefined
      if (isOldFormat) {
        const newPlaylists = oldPlaylists.map(pl => ({
          id: pl.id,
          name: pl.name,
          tracks: pl.trackIds.map(id => oldTracks.find(t => t.id === id)).filter(Boolean)
        }))
        // 添加 'all' 歌单
        newPlaylists.unshift({
          id: 'all',
          name: '默认',
          tracks: [...oldTracks]
        })
        this.set('playlists', newPlaylists)
        this.set('tracks', null)
        return
      }
    }

    // 只有旧 tracks，没有 playlists
    if (oldTracks && Array.isArray(oldTracks)) {
      this.set('playlists', [{
        id: 'all',
        name: '默认',
        tracks: [...oldTracks]
      }])
      this.set('tracks', null)
    }
  }

  //======================================歌单=======================================
  getPlaylists() {
    return this.get('playlists') || []
  }

  savePlaylists(playlists) {
    this.set('playlists', playlists)
    return this
  }

  getTracks(playlistId = 'all') {
    const playlists = this.getPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)
    return playlist ? playlist.tracks : []
  }

  addTracks(tracks, playlistId = 'all') {
    const playlists = this.getPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)
    const targetPlaylist = playlist || playlists.find(p => p.id === 'all')
    if (!targetPlaylist) return this

    const tracksWithProps = tracks.map(track => {
      return {
        id: uuidv4(),
        path: track,
        fileName: path.basename(track)
      }
    }).filter(track => {
      const currentTracksPath = targetPlaylist.tracks.map(track => track.path)
      return currentTracksPath.indexOf(track.path) < 0
    })

    targetPlaylist.tracks = [ ...targetPlaylist.tracks, ...tracksWithProps ]
    return this.savePlaylists(playlists)
  }

  deleteTrack(deletedId, playlistId = 'all') {
    const playlists = this.getPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)
    if (playlist) {
      playlist.tracks = playlist.tracks.filter(item => item.id !== deletedId)
      this.savePlaylists(playlists)
    }
    return this
  }

  cleanTracks(playlistId = 'all') {
    const playlists = this.getPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)
    if (playlist) {
      playlist.tracks = []
      this.savePlaylists(playlists)
    }
    return this
  }

  reorderTracks(trackIds, playlistId = 'all') {
    const playlists = this.getPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)
    if (playlist) {
      const orderMap = new Map(trackIds.map((id, index) => [id, index]))
      playlist.tracks.sort((a, b) => {
        const orderA = orderMap.get(a.id)
        const orderB = orderMap.get(b.id)
        if (orderA !== undefined && orderB !== undefined) return orderA - orderB
        if (orderA !== undefined) return -1
        if (orderB !== undefined) return 1
        return 0
      })
      this.savePlaylists(playlists)
    }
    return this
  }

  addPlaylist(name) {
    const playlists = this.getPlaylists()
    const newPlaylist = {
      id: uuidv4(),
      name: name || '新建歌单',
      tracks: []
    }
    playlists.push(newPlaylist)
    this.savePlaylists(playlists)
    return newPlaylist
  }

  renamePlaylist(id, name) {
    const playlists = this.getPlaylists()
    const playlist = playlists.find(p => p.id === id)
    if (playlist) {
      playlist.name = name
      this.savePlaylists(playlists)
    }
    return this
  }

  deletePlaylist(id) {
    let playlists = this.getPlaylists()
    playlists = playlists.filter(p => p.id !== id)
    this.savePlaylists(playlists)
    return this
  }

  addTrackToPlaylist(sourcePlaylistId, targetPlaylistId, trackId) {
    const playlists = this.getPlaylists()
    const source = playlists.find(p => p.id === sourcePlaylistId)
    const target = playlists.find(p => p.id === targetPlaylistId)
    if (source && target) {
      const track = source.tracks.find(t => t.id === trackId)
      if (track) {
        const exists = target.tracks.some(t => t.path === track.path)
        if (!exists) {
          target.tracks.push({ ...track })
          this.savePlaylists(playlists)
        }
      }
    }
    return this
  }

  removeTrackFromPlaylist(playlistId, trackId) {
    const playlists = this.getPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)
    if (playlist) {
      playlist.tracks = playlist.tracks.filter(t => t.id !== trackId)
      this.savePlaylists(playlists)
    }
    return this
  }

  reorderPlaylist(playlistId, trackIds) {
    const playlists = this.getPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)
    if (playlist) {
      const orderMap = new Map(trackIds.map((id, index) => [id, index]))
      playlist.tracks.sort((a, b) => {
        const orderA = orderMap.get(a.id)
        const orderB = orderMap.get(b.id)
        if (orderA !== undefined && orderB !== undefined) return orderA - orderB
        if (orderA !== undefined) return -1
        if (orderB !== undefined) return 1
        return 0
      })
      this.savePlaylists(playlists)
    }
    return this
  }
  //======================================歌单=======================================

  //======================================其他配置=======================================
  //1 桌面歌词是否显示 showLyricWindow

  saveShowLyricWindow(showLyricWindow) {
    this.set('showLyricWindow', showLyricWindow)
    return this
  }

  getShowLyricWindow() {
    return this.get('showLyricWindow') || false
  }

  //2 单曲循环和随机播放状态 isLooping isRandom

  saveIsLooping(isLooping) {
    this.set('isLooping', isLooping)
    return this
  }

  getIsLooping() {
    return this.get('isLooping') || false
  }

  saveIsRandom(isRandom) {
    this.set('isRandom', isRandom)
    return this
  }

  getIsRandom() {
    return this.get('isRandom') || false
  }

  saveIsDarkMode(isDarkMode) {
    this.set('isDarkMode', isDarkMode)
    return this
  }

  getIsDarkMode() {
    return this.get('isDarkMode') || false
  }

  //3 桌面歌词配置
  saveLyricConfig(config) {
    this.set('lyricConfig', config)
    return this
  }

  getLyricConfig() {
    return this.get('lyricConfig') || { fontSize: 28, color: '#e74c3c', locked: false }
  }

  //4 桌面歌词窗口位置
  saveLyricPosition(x, y) {
    this.set('lyricPosition', { x, y })
    return this
  }

  getLyricPosition() {
    return this.get('lyricPosition') || null
  }

  //5 播放状态
  savePlaybackState(playlistId, trackId) {
    this.set('playbackState', { playlistId, trackId })
    return this
  }

  getPlaybackState() {
    return this.get('playbackState') || null
  }
  //======================================其他配置=======================================
}

module.exports = DataStore
