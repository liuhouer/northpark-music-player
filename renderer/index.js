
//这部分代码引入了Electron模块中的ipcRenderer对象，并引入了自定义的helper模块。
//它还创建了一个Audio对象musicAudio用于播放音乐，以及用于存储音乐数据的变量allTracks和当前播放的音乐currentTrack。
const { ipcRenderer } = require('electron')
const { $, convertDuration } = require('./helper')
let musicAudio = new Audio()
let allTracks
let currentTrack
let currentLyricIndex = 0 //用于跟踪当前歌词的索引。

let curLyrics //当前播放歌曲的歌词

//"add-music-button"元素添加了一个点击事件监听器。当按钮被点击时，通过ipcRenderer对象发送一个名为'add-music-window'的事件，用于打开添加音乐窗口。
$('add-music-button').addEventListener('click', () => {
  ipcRenderer.send('add-music-window')
})

// 渲染音乐列表的HTML代码
const renderListHTML = (tracks) => {
  const tracksList = $('tracksList')
  const tracksListHTML = tracks.reduce((html, track) => {
    html += `<li class="row music-track list-group-item d-flex justify-content-between align-items-center">
      <div class="col-10">
        <i class="fas fa-music mr-2 text-secondary"></i>
        <b>${track.fileName}</b>
      </div>
      <div class="col-2">
        <i class="fas fa-play mr-3" data-id="${track.id}"></i>
        <i class="fas fa-trash-alt" data-id="${track.id}"></i>
      </div>
    </li>`
    return html
  }, '')
  const emptyTrackHTML = '<div class="alert alert-primary">还没有添加任何音乐</div>'
  tracksList.innerHTML = tracks.length ? `<ul class="list-group">${tracksListHTML}</ul>` : emptyTrackHTML

}

// 渲染播放器状态的HTML代码
const renderPlayerHTML = (name, duration) => {
  const player = $('player-status')
  const html = `<div class="col-4 font-weight-bold">
                  正在播放：${name}
                </div>
                <div class="col-3">
                  <span id="current-seeker">00:00</span> / ${convertDuration(duration)}
                </div>
                
                <div class="col-5">
                <p id="current-lyric"></p>
                </div>

`
  player.innerHTML = html
}

// 更新播放进度的HTML代码
const updateProgressHTML = (currentTime, duration) => {
  // 计算 progress 是当前要解决的问题
  const progress = Math.floor(currentTime / duration * 100)
  const bar = $('player-progress')
  bar.innerHTML = progress + '%'
  bar.style.width = progress + '%'
  const seeker = $('current-seeker')
  seeker.innerHTML = convertDuration(currentTime)

}

//加载歌词
const loadLrc = async ()=>{
  const lyricsPath = currentTrack.path.replace('.mp3', '.lrc');
  curLyrics =  await parseLyricsFile(lyricsPath);//拿到解析的歌词
  //console.log('拿到解析的歌词', curLyrics)
}

//通过ipcRenderer对象监听名为'getTracks'的事件。
// 当接收到该事件时，将音乐数据赋值给allTracks变量，并调用renderListHTML函数渲染音乐列表的HTML代码。
ipcRenderer.on('getTracks', (event, tracks) => {

  allTracks = tracks

  console.log('receive tracks', tracks)

  renderListHTML(tracks)
})

//当音频元数据加载完成时，调用renderPlayerHTML函数渲染播放器状态的HTML代码。
musicAudio.addEventListener('loadedmetadata', async () => {
  //渲染播放器状态
  renderPlayerHTML(currentTrack.fileName, musicAudio.duration)

  //加载歌词
  await loadLrc();

  //在这里调用updateProgressHTML函数
  updateProgressHTML(musicAudio.currentTime, musicAudio.duration);

})

//当音频播放进度更新时，调用updateProgressHTML函数更新播放进度的HTML代码。
musicAudio.addEventListener('timeupdate', () => {
  //更新播放器状态
  updateProgressHTML(musicAudio.currentTime, musicAudio.duration)

 //更新歌词的滚动显示：
    if(curLyrics && curLyrics.length) {
      const currentLyricElement = $('current-lyric');
      const currentTime = musicAudio.currentTime;
      let nextLyricIndex = currentLyricIndex + 1;

      // 寻找下一句歌词的时间
      while (nextLyricIndex < curLyrics.length && curLyrics[nextLyricIndex].time <= currentTime) {
        nextLyricIndex++;
      }

      // 更新当前歌词
      const currentLyricText = curLyrics[currentLyricIndex].text;
      const nextLyricText = curLyrics[nextLyricIndex] ? curLyrics[nextLyricIndex].text : '';
      const lyricDisplayText = currentLyricText + '<br>' + nextLyricText;
      currentLyricElement.innerHTML = lyricDisplayText;

      // 滚动显示当前歌词
      currentLyricElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // 更新当前歌词索引
      if (nextLyricIndex > currentLyricIndex) {
        currentLyricIndex = nextLyricIndex - 1;
      }

    }


})

// 我们添加了一个ended事件的监听器。
// 当歌曲播放完成时触发该事件，我们通过找到当前歌曲在allTracks数组中的索引，计算出下一首歌曲的索引。
// 然后，使用下一首歌曲的路径更新musicAudio对象的src属性，并调用play()方法开始播放下一首歌曲。
musicAudio.addEventListener('ended', () => {
  // 歌曲播放完成后的逻辑
  const currentIndex = allTracks.findIndex(track => track.id === currentTrack.id)
  const nextIndex = (currentIndex + 1) % allTracks.length
  currentTrack = allTracks[nextIndex]
  musicAudio.src = currentTrack.path
  musicAudio.play()

  //加载歌词
  loadLrc();

  const resetIconEle = document.querySelector('.fa-pause')
  if (resetIconEle) {
    resetIconEle.classList.replace('fa-pause', 'fa-play')
  }
  renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
})

// 点击音乐列表中的播放图标或暂停图标时，根据图标状态进行音乐的播放或暂停，并更新图标状态。
// 点击音乐列表中的垃圾桶图标时，通过ipcRenderer对象发送一个名为'delete-track'的事件，用于删除对应的音乐。
$('tracksList').addEventListener('click', (event) => {
  event.preventDefault()
  const { dataset, classList } = event.target
  const id = dataset && dataset.id
  if(id && classList.contains('fa-play')) {
    // 这里要开始播放音乐
    if (currentTrack && currentTrack.id === id) {
      // 继续播放音乐
      musicAudio.play()
    } else {
      // 播放新的歌曲，注意还原之前的图标
      currentTrack = allTracks.find(track => track.id === id)
      musicAudio.src = currentTrack.path
      musicAudio.play()
      const resetIconEle = document.querySelector('.fa-pause')
      if (resetIconEle) {
        resetIconEle.classList.replace('fa-pause', 'fa-play')
      }
    }
    classList.replace('fa-play', 'fa-pause')

    //加载歌词
    loadLrc();
  } else if (id && classList.contains('fa-pause')) {
    // 处理暂停逻辑
    musicAudio.pause()
    classList.replace('fa-pause', 'fa-play')
  } else if (id && classList.contains('fa-trash-alt')) {
    // 发送事件 删除这条音乐
    ipcRenderer.send('delete-track', id)
  }
})

//上一曲
$('previous-button').addEventListener('click', () => {
  const currentIndex = allTracks.findIndex(track => track.id === currentTrack.id)
  const previousIndex = (currentIndex - 1 + allTracks.length) % allTracks.length
  currentTrack = allTracks[previousIndex]
  musicAudio.src = currentTrack.path
  musicAudio.play()

  // 还原上次播放图标
  const resetIconEle = document.querySelector('.fa-pause')
  console.log("下一曲resetIconEle",resetIconEle);
  if (resetIconEle) {
    resetIconEle.classList.replace('fa-pause', 'fa-play')
  }

  // 替换最新播放图标
  const tracksList = document.getElementById('tracksList');
  const currentTrackElement = tracksList.querySelector(`[data-id="${currentTrack.id}"]`);
  if (currentTrackElement) {
    currentTrackElement.classList.replace('fa-play', 'fa-pause');
  }

  //加载歌词
  loadLrc();

  renderPlayerHTML(currentTrack.fileName, musicAudio.duration)


})

//下一曲
$('next-button').addEventListener('click', () => {
  const currentIndex = allTracks.findIndex(track => track.id === currentTrack.id)
  const nextIndex = (currentIndex + 1) % allTracks.length
  currentTrack = allTracks[nextIndex]
  musicAudio.src = currentTrack.path
  musicAudio.play()

  // 还原上次播放图标
  const resetIconEle = document.querySelector('.fa-pause')
  console.log("下一曲resetIconEle",resetIconEle);
  if (resetIconEle) {
    resetIconEle.classList.replace('fa-pause', 'fa-play')
  }

  // 替换最新播放图标
  const tracksList = document.getElementById('tracksList');
  const currentTrackElement = tracksList.querySelector(`[data-id="${currentTrack.id}"]`);
  if (currentTrackElement) {
    currentTrackElement.classList.replace('fa-play', 'fa-pause');
  }

  //加载歌词
  loadLrc();

  renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
})


// 获取进度条元素
const progressBar = $('progress-bar');

// 添加点击事件监听器
progressBar.addEventListener('click', (event) => {
  // 计算鼠标点击位置相对于进度条的百分比位置
  const clickPosition = event.clientX - progressBar.getBoundingClientRect().left;
  const progressBarWidth = progressBar.clientWidth;
  const percentage = clickPosition / progressBarWidth;

  // 计算音乐的播放时间
  const duration = musicAudio.duration;
  const currentTime = duration * percentage;

  // 设置音乐的播放时间
  musicAudio.currentTime = currentTime;

  // 更新进度条的显示
  updateProgressHTML(currentTime, duration);
});



const parseLyricsFile = async (path) => {
  try {
    const response = await fetch(path);
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('GBK');
    const lyricsContent = decoder.decode(buffer);
    //console.log('lyricsContent', lyricsContent);
    return parseLyrics(lyricsContent);
  } catch (error) {
    console.error('Error reading lyrics file:', error);
    return [];
  }
};


const parseLyrics = (lyricsText) => {
  // 解析歌词文本，返回歌词数据
  // 将歌词文本按行分割成数组
  // 遍历每一行歌词，提取时间和文本信息
  // 返回包含时间和歌词文本的数组
  const lines = lyricsText.toString().split('\n');
  const lyrics = [];
  let timeRegex = null;

  for (let line of lines) {
    const timeMatches = line.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?]/);
    const metadataMatches = line.match(/^\[([^\]]+)\]/);
    //匹配到时间戳
    if (timeMatches) {
      const minutes = parseInt(timeMatches[1]);
      const seconds = parseInt(timeMatches[2]);
      let milliseconds = 0;
      if (timeMatches[3]) {
        milliseconds = parseInt(timeMatches[3]);
        if (timeMatches[3].length === 2) {
          milliseconds *= 10; // 将两位数的毫秒转换为三位数
        }
      }
      const time = minutes * 60 + seconds + milliseconds / 1000;
      const text = line.replace(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?]/, '').trim();

      if (time && text) {
        lyrics.push({ time, text });
      }

    } else if(metadataMatches){//匹配到标签

        const text = metadataMatches[1].trim();
        if (text) {
          lyrics.push({ "time": 0.00,  "text": text});
        }

    } else {//其他默认处理
      //console.log("其他默认处理",line)
      // Fallback for unrecognized lines (treat as plain text)
      if (lyrics.length > 0) {
        lyrics[lyrics.length - 1].text += '\n' + line.trim();
      }
    }
  }

  console.log("时间+歌词", lyrics);
  return lyrics;
};
