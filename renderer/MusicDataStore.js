const Store = require('electron-store')
const uuidv4 = require('uuid/v4')
const path = require('path')
class DataStore extends Store {

  //构造函数
  constructor(settings) {
    super(settings)
    this.tracks = this.get('tracks') || []
  }

  //======================================列表=======================================
  saveTracks() {
    this.set('tracks', this.tracks)
    return this
  }
  getTracks() {
    return this.get('tracks') || []
  }
  addTracks(tracks) {
    const tracksWithProps = tracks.map(track => {
      return {
        id: uuidv4(),
        path: track,
        fileName: path.basename(track)
      }
    }).filter(track => {
      const currentTracksPath = this.getTracks().map(track => track.path)
      return currentTracksPath.indexOf(track.path) < 0
    })
    this.tracks = [ ...this.tracks, ...tracksWithProps ]
    return this.saveTracks()
  }
  deleteTrack(deletedId) {
    this.tracks = this.tracks.filter(item => item.id !== deletedId)
    return this.saveTracks()
  }

  cleanTracks() {
    this.tracks = []
    return this.saveTracks()
  }
  //======================================列表=======================================

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
  //======================================其他配置=======================================
}

module.exports = DataStore
