
//这部分代码引入了Electron模块中的ipcRenderer对象，并引入了自定义的helper模块。
//它还创建了一个Audio对象musicAudio用于播放音乐，以及用于存储音乐数据的变量allTracks和当前播放的音乐currentTrack。
const { ipcRenderer } = require('electron')
const { $, convertDuration } = require('./helper')

//读取歌曲标签
const jsmediatags = require('jsmediatags');


let musicAudio = new Audio()
let allTracks
let currentTrack
let currentLyricIndex = 0 //用于跟踪当前歌词的索引。
let currentLyricIndexAnimationDuration = 1  //用于跟踪当前歌词的动画时间

let curLyrics //当前播放歌曲的歌词

let curLyricDisplayText


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
  }, '');
  const emptyTrackHTML = '<div class="alert alert-primary">还没有添加任何音乐</div>'
  tracksList.innerHTML = tracks.length ? `<ul class="list-group">${tracksListHTML}</ul>` : emptyTrackHTML

}

// 渲染播放器状态的HTML代码
const renderPlayerHTML = (name, duration) => {
  const player = $('player-status')
  const html = `

                <div class="col-1">
                  <span ><img id="current-cover" src=""/></span>
                </div>
                
                <div class="col-4 font-weight-bold">
                  正在播放：${name}
                </div>
                <div class="col-3">
                  <span id="current-seeker">00:00</span> / ${convertDuration(duration)}
                </div>
                
                <div class="col-4">
                <p id="current-lyric" class="lyric-text"></p>
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


// 读取 MP3 文件的封面图像
const readMP3Cover = async (filePath) => {

  jsmediatags.read(filePath, {
    onSuccess: async function (tag) {
      const {picture} = tag.tags;
      if (picture) {
        const base64String = arrayBufferToBase64(picture.data);
        const coverImageSrc = `data:${picture.format};base64,${base64String}`;
        // 这里可以使用 coverImageSrc 来展示或处理封面图像

        $('current-cover').src = coverImageSrc;

      } else {
        try {
          const songInfo = await fetchSongInfo();
          console.log('读取歌曲标签songInfo', songInfo)

          const cover = await getCover(songInfo.id);
          console.log('读取歌曲标签cover', cover)
          if (cover) {
            $('current-cover').src = cover;
          }
        } catch (ee) {
          $('current-cover').src = 'defaultCover.ico';
        }


      }
    },
    onError: function (error) {
      console.error('Error reading MP3 tags:', error);
    }
  });
};

// 辅助函数：将 ArrayBuffer 转换为 Base64 字符串
const arrayBufferToBase64 = (buffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};


//加载封面
const loadCover = async ()=>{
  // 调用 readMP3Cover 函数来读取 MP3 文件的封面图像
  const filePath = currentTrack.path;
  readMP3Cover(filePath);
}

//加载歌词
const loadLrc = async ()=>{
  currentLyricIndex = 0 //重置当前歌词索引
  const lyricsPath = currentTrack.path.replace('.mp3', '.lrc');
  return  await parseLyricsFile(lyricsPath);//拿到解析的歌词
  //console.log('拿到解析的歌词', curLyrics)
}

// 判断 musicAudio 是否正在播放
const isMusicPlaying = () => {
  return !musicAudio.paused;
};

//通过ipcRenderer对象监听名为'getTracks'的事件。
// 当接收到该事件时，将音乐数据赋值给allTracks变量，并调用renderListHTML函数渲染音乐列表的HTML代码。
ipcRenderer.on('getTracks', (event, tracks) => {

  allTracks = tracks

  console.log('receive tracks', tracks)

  renderListHTML(tracks)

  //刷新后，有正在播放的歌曲，改变歌曲播放图标
  console.log("正在播放？" + isMusicPlaying())
  console.log("currentTrack？" + currentTrack)
  if(currentTrack && isMusicPlaying()){
    const tracksList = document.getElementById('tracksList');
    const currentTrackElement = tracksList.querySelector(`[data-id="${currentTrack.id}"]`);

    if (currentTrackElement) {
      currentTrackElement.classList.replace('fa-play', 'fa-pause');
    }
  }


})

//当音频元数据加载完成时，调用renderPlayerHTML函数渲染播放器状态的HTML代码。
musicAudio.addEventListener('loadedmetadata', async () => {
  //渲染播放器状态
  renderPlayerHTML(currentTrack.fileName, musicAudio.duration)

  //加载歌词
  curLyrics = await loadLrc();

  //在这里调用updateProgressHTML函数
  updateProgressHTML(musicAudio.currentTime, musicAudio.duration);

  //加载封面
  loadCover();

})


// 当音频播放进度更新时，调用 updateProgressHTML 函数更新播放进度的 HTML 代码。
musicAudio.addEventListener('timeupdate', () => {
  // 更新播放器状态
  updateProgressHTML(musicAudio.currentTime, musicAudio.duration);

  // 更新歌词的滚动显示
  if (curLyrics && curLyrics.length) {
    const currentLyricElement = $('current-lyric');
    const currentLyricTime = currentLyricIndex>=curLyrics.length  ? musicAudio.duration:curLyrics[currentLyricIndex].time;

    if (musicAudio.currentTime >= currentLyricTime) {
      //currentLyricElement.textContent = curLyrics[currentLyricIndex].text;

      //=============================================变色计算=======================================
      // 在这里计算这句的延时--设置每个字母的颜色变化
      try {
        currentLyricIndexAnimationDuration = (curLyrics[currentLyricIndex+1].time - curLyrics[currentLyricIndex].time); // 动画持续时间，单位秒
      } catch (exception) {
        // 处理异常情况
        currentLyricIndexAnimationDuration = musicAudio.duration - curLyrics[currentLyricIndex].time;
      }

      // 构建当前歌词的 HTML 代码，每个字母都包裹在一个 <span> 元素中
      const currentLyricHTML = curLyrics[currentLyricIndex].text
          .split('')
          .map((char, index) => {
            if (char === ' ') {
              return ' '; // 保留空格
            }
            return `<span class="char-${index}">${char}</span>`;
          })
          .join('');

      const nextLyricText = curLyrics[currentLyricIndex+1] ? curLyrics[currentLyricIndex+1].text : '';
      const lyricDisplayText = currentLyricHTML + '<br>' + nextLyricText;

      // 更新当前歌词的 HTML
      currentLyricElement.innerHTML = lyricDisplayText;

      // 获取当前歌词中每个字母的 <span> 元素
      const currentLyricLetters = currentLyricElement.querySelectorAll('span');


      const letterDelay = currentLyricIndexAnimationDuration / currentLyricLetters.length; // 计算每个字母的延迟时间

      currentLyricLetters.forEach((letter, index) => {
        letter.style.animation = `colorChange ${currentLyricIndexAnimationDuration}s linear infinite`;
        letter.style.animationDelay = `${index * letterDelay}s`;
      });
      //=============================================变色计算=======================================

      // 发送当前歌词给桌面歌词窗口
      ipcRenderer.send('updateDeskLyric', currentLyricElement.innerHTML);

      curLyricDisplayText = currentLyricElement.innerHTML;//设置到环境变量中，歌词点击显示&隐藏时 触发一次发送消息

      currentLyricIndex++;
      currentLyricElement.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  }


});



// 我们添加了一个ended事件的监听器。
// 当歌曲播放完成时触发该事件，我们通过找到当前歌曲在allTracks数组中的索引，计算出下一首歌曲的索引。
// 然后，使用下一首歌曲的路径更新musicAudio对象的src属性，并调用play()方法开始播放下一首歌曲。
musicAudio.addEventListener('ended', async () => {
  // 歌曲播放完成后的逻辑
  const currentIndex = allTracks.findIndex(track => track.id === currentTrack.id)
  const nextIndex = (currentIndex + 1) % allTracks.length
  currentTrack = allTracks[nextIndex]

  renderPlayerHTML(currentTrack.fileName, musicAudio.duration)

  //加载歌词
  //curLyrics = await loadLrc();

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



})

// 点击音乐列表中的播放图标或暂停图标时，根据图标状态进行音乐的播放或暂停，并更新图标状态。
// 点击音乐列表中的垃圾桶图标时，通过ipcRenderer对象发送一个名为'delete-track'的事件，用于删除对应的音乐。
$('tracksList').addEventListener('click', async (event) => {
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
    //curLyrics = await loadLrc();

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
$('previous-button').addEventListener('click', async () => {
  if( allTracks && allTracks.length && currentTrack){
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
    //curLyrics = await loadLrc();

    renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
  }


})

//下一曲
$('next-button').addEventListener('click', async () => {
  if( allTracks && allTracks.length && currentTrack) {
    const currentIndex = allTracks.findIndex(track => track.id === currentTrack.id)
    const nextIndex = (currentIndex + 1) % allTracks.length
    currentTrack = allTracks[nextIndex]
    musicAudio.src = currentTrack.path
    musicAudio.play()

    // 还原上次播放图标
    const resetIconEle = document.querySelector('.fa-pause')
    console.log("下一曲resetIconEle", resetIconEle);
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
    //curLyrics = await loadLrc();


    renderPlayerHTML(currentTrack.fileName, musicAudio.duration)
  }
})


// 添加进度条事件监听器
const progressBar = $('progress-bar')
$('progress-bar').addEventListener('click', (event) => {
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


//根据歌曲来获取歌曲信息，包含标签和网易云id等
const fetchSongInfo = async()=> {
  const mm = require('music-metadata');
  const metadata = await mm.parseFile(currentTrack.path);
  const {common} = metadata;

  // 获取歌曲名和歌手名
  const songTitle = common.title;
  const artistName = common.artist;

  console.log('歌曲名:', songTitle);
  console.log('歌手名:', artistName);

  // 如果文件不存在,则调用网易云音乐API获取歌词
  const songInfo = await getSong(songTitle, artistName);
  return songInfo;
}


//从文件读取歌词 || 从网易云读取歌词
const parseLyricsFile = async (path) => {
  const fs = require('fs');
  const jschardet = require('jschardet');
  const iconv = require('iconv-lite');

  try {
    // 检查文件是否存在
    if (fs.existsSync(path)) {
      const buffer = fs.readFileSync(path);
      const detectedEncoding = jschardet.detect(buffer);
      const encoding = detectedEncoding.encoding;
      console.log('LRC encoding:', encoding);

      const lyricsContent = iconv.decode(buffer, encoding);
      return parseLyrics(lyricsContent);
    }
    const songInfo = await fetchSongInfo();
    const lyrics = await getLyrics(songInfo.id);
    // 将歌词写入文件
    fs.writeFileSync(path, lyrics);

    return parseLyrics(lyrics);

  } catch (error) {
    console.error('Error reading lyrics file:', error);
    return [];
  }
};

// 从网易云音乐API获取歌曲ID
const getSong = async (songName, artistName) => {
  const searchUrl = `http://music.163.com/api/search/get/?s=${encodeURIComponent(`${artistName} ${songName}`)}&limit=1&type=1&offset=0`;
  const response = await fetch(searchUrl);
  const data = await response.json();

  if (data.code === 200 && data.result.songs.length > 0) {
    return data.result.songs[0];
  }

  throw new Error('Failed to get song List');
};

// 从网易云音乐API获取歌词
const getLyrics = async (songId) => {
  const lyricsUrl = `http://music.163.com/api/song/lyric?os=osx&id=${songId}&lv=-1&kv=-1&tv=-1`;
  const response = await fetch(lyricsUrl);
  const data = await response.json();
  console.log('从网易云音乐API获取歌词', data)
  if (data.code === 200 && data.lrc && data.lrc.lyric) {
    return data.lrc.lyric;
  }

  throw new Error('Failed to get lyrics');
};

// 从网易云音乐API获取专辑图
const getCover = async (songId) => {
  const detailUrl = `http://music.163.com/api/song/detail?id=${songId}&ids=[${songId}]&csrf_token=`;
  const response = await fetch(detailUrl);
  const data = await response.json();

  console.log('从网易云音乐API获取专辑图',data)
  console.log('从网易云音乐API获取专辑图',data.songs)

  if (data.code === 200 && data.songs && data.songs[0].album.blurPicUrl) {
    return data.songs[0].album.blurPicUrl;
  }

  throw new Error('Failed to get Cover');
};


// 歌词解析为时间+文本
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
      if(line.trim()){
        lyrics.push({ "time": 0.00+lyrics.length,  "text": line.trim()});
      }

    }
  }

  console.log("时间+歌词", lyrics);
  return lyrics;
};



// 监听 Dark Mode 按钮的点击事件
$('dark-mode-button').addEventListener('click', () => {
  const body = document.body;

  const icon = document.querySelector('#dark-mode-button i');

  // 切换深色模式的 CSS 类
  body.classList.toggle('dark-mode');

  // 切换图标的类名
  if (body.classList.contains('dark-mode')) {
    icon.classList.remove('fa-moon');
    icon.classList.add('fa-sun');
    $('dark-mode-button').title = '亮色模式';
  } else {
    icon.classList.remove('fa-sun');
    icon.classList.add('fa-moon');
    $('dark-mode-button').title = '暗色模式';
  }

  // 在主进程中发送消息通知切换主题
  ipcRenderer.send('toggle-dark-mode', body.classList.contains('dark-mode'));
});

//"add-music-button"元素添加了一个点击事件监听器。当按钮被点击时，通过ipcRenderer对象发送一个名为'add-music-window'的事件，用于打开添加音乐窗口。
$('add-music-button').addEventListener('click', () => {
  const body = document.body;
  ipcRenderer.send('add-music-window', body.classList.contains('dark-mode'))
})

// 监听来自主进程的 apply-dark-mode 消息
ipcRenderer.on('apply-dark-mode', (event, isDarkMode) => {
  // 在这里根据 isDarkMode 变量应用深色模式的样式
  const body = document.body;
  if (isDarkMode) {
    body.classList.add('dark-mode');
  } else {
    body.classList.remove('dark-mode');
  }
});


// 停止按钮点击事件
$('stop-button').addEventListener('click', () => {

  if(allTracks && allTracks.length) {
    musicAudio.pause(); // 暂停音乐播放
    musicAudio.currentTime = 0; // 将音频的当前时间设置为0，停止播放

    // 还原上次播放图标
    const resetIconEle = document.querySelector('.fa-pause')
    console.log("下一曲resetIconEle", resetIconEle);
    if (resetIconEle) {
      resetIconEle.classList.replace('fa-pause', 'fa-play')
    }

    //清空当前歌词
    curLyrics = null;

    //清空当前音轨
    currentTrack = null;

    //清空播放信息
    const player = $('player-status')
    player.innerHTML = '';
  }

})


// 清空歌单按钮点击事件
$('clean-list-button').addEventListener('click', () => {
  if(allTracks && allTracks.length){
    $('stop-button').click();//停止播放

    allTracks = [] // 清空歌单数据

    renderListHTML(allTracks) // 重新渲染空的音乐列表

    ipcRenderer.send('clean-tracks');//发送消息 清空缓存配置文件
  }

})


let isLyricWindowOpen = false; // 标记歌词窗口是否已打开


// 桌面歌词
document.getElementById('show-lrc').addEventListener('click', () => {
  if (isLyricWindowOpen) {
    // 关闭歌词窗口
    ipcRenderer.send('closeLyricWindow');
  } else {
    // 打开歌词窗口
    ipcRenderer.send('showLyricWindow');
    //设置到环境变量中，歌词点击显示&隐藏时 触发一次发送消息
    ipcRenderer.send('updateDeskLyric', curLyricDisplayText?curLyricDisplayText:'歌词加载中...');
  }
});


// 桌面歌词样式
ipcRenderer.on('updateLyricWindowStatus', (event, isOpen) => {
  isLyricWindowOpen = isOpen;

  const showLrcButton = document.getElementById('show-lrc');
  if (isOpen) {
    //打开了
    showLrcButton.classList.remove('btn-outline-secondary');
    showLrcButton.classList.add('btn-secondary');

  } else {
    //没打开
    showLrcButton.classList.remove('btn-secondary');
    showLrcButton.classList.add('btn-outline-secondary');

  }
});
