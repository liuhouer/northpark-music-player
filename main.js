
//引入了Electron模块中的app、BrowserWindow、ipcMain和dialog对象，并引入了自定义的MusicDataStore模块。
const { app, BrowserWindow, ipcMain, dialog, ipcRenderer} = require('electron')
const DataStore = require('./renderer/MusicDataStore')


//创建了一个名为myStore的DataStore实例，用于管理音乐数据。
const myStore = new DataStore({'name': 'Music Data'})


/**
 * 这是一个自定义的AppWindow类，继承自BrowserWindow类。
 */
class AppWindow extends BrowserWindow {
  // 构造函数，继承自Electron的BrowserWindow类
  // 接收一个配置对象和文件位置参数
  // 将配置对象与基本配置进行合并，并传递给父类构造函数
  // 加载指定文件位置的HTML文件
  // 当窗口准备好显示时，调用show方法显示窗口
  constructor(config, fileLocation) {
    const basicConfig = {
      width: 1200,
      height: 700,
      minWidth: 900,
      minHeight: 500,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
      }
    }
    const finalConfig = { ...basicConfig, ...config }
    super(finalConfig)
    this.loadFile(fileLocation)
    this.once('ready-to-show', () => {
      this.show()
    })

   this.setMenu(null); // 移除菜单栏

  }
}


let lyricWindow = null; // 歌词窗口的引用
let deskMouseCheckInterval = null; // 桌面歌词鼠标穿透定时检测
let deskMouseEventsIgnored = false; // 当前是否处于鼠标穿透状态

// 启动桌面歌词鼠标区域检测：锁定后默认完全穿透，鼠标移到控制栏区域时恢复交互
const startDeskMouseCheck = () => {
  if (deskMouseCheckInterval) return;
  const { screen } = require('electron');
  deskMouseCheckInterval = setInterval(() => {
    if (!lyricWindow) return;
    try {
      const cursor = screen.getCursorScreenPoint();
      const bounds = lyricWindow.getBounds();
      // 控制栏区域：窗口底部 44px（控制栏高度 + 边距）
      const ctrlBarTop = bounds.y + bounds.height - 44;
      const inCtrlBar = cursor.x >= bounds.x &&
                        cursor.x <= bounds.x + bounds.width &&
                        cursor.y >= ctrlBarTop &&
                        cursor.y <= bounds.y + bounds.height;
      if (inCtrlBar && deskMouseEventsIgnored) {
        lyricWindow.setIgnoreMouseEvents(false);
        deskMouseEventsIgnored = false;
      } else if (!inCtrlBar && !deskMouseEventsIgnored) {
        lyricWindow.setIgnoreMouseEvents(true);
        deskMouseEventsIgnored = true;
      }
    } catch (e) {
      // 窗口可能正在关闭，忽略错误
    }
  }, 80);
};

// 停止桌面歌词鼠标区域检测
const stopDeskMouseCheck = () => {
  if (deskMouseCheckInterval) {
    clearInterval(deskMouseCheckInterval);
    deskMouseCheckInterval = null;
  }
  deskMouseEventsIgnored = false;
};


app.on('ready', () => {


  // 在 Electron 主进程中打印 app.getAppPath()
  console.log(app.getAppPath());

  console.log(app.getPath('userData'))

  // 当应用程序准备就绪时触发的事件回调函数
  // 创建主窗口实例，并加载主页HTML文件
  const mainWindow = new AppWindow({}, './renderer/index.html')

  // 在主窗口的webContents完成加载后，发送获取音乐数据的请求
  mainWindow.webContents.on('did-finish-load',() => {
    //恢复歌单列表（包含默认和各歌单的tracks）
    mainWindow.send('playlists-data', myStore.getPlaylists())
    //恢复播放状态
    mainWindow.send('playback-state', myStore.getPlaybackState())
    //恢复桌面歌词
    mainWindow.send('LyricWindowStatus', myStore.getShowLyricWindow())
    //启动时恢复随机播放状态
    mainWindow.send('RandomStatus', myStore.getIsRandom())
    //启动时恢复单曲循环状态
    mainWindow.send('LoopStatus', myStore.getIsLooping())
    //启动时恢复暗色模式
    mainWindow.send('DarkStatus', myStore.getIsDarkMode())
  })

  //关闭时
  mainWindow.on('closed', () => {
    if(lyricWindow){
      lyricWindow.close();
    }

     addWindowInstance = null;
  });


  let addWindowInstance = null;
  let addWindowPlaylistId = 'all';
  // 监听'add-music-window'事件，创建添加音乐窗口实例
  ipcMain.on('add-music-window',(event, isDarkMode, playlistId) => {
    addWindowPlaylistId = playlistId || 'all'
    if (addWindowInstance === null) {
      const addWindow = new BrowserWindow({
        width: 500,
        height: 400,
        parent: mainWindow,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        }
      });

      addWindow.loadFile('./renderer/add.html');

      addWindow.once('ready-to-show', () => {
        addWindow.show();
        addWindowInstance = addWindow;
      });

      addWindow.on('closed', () => {
        addWindowInstance = null;
      });

      addWindow.webContents.on('did-finish-load',() => {
        addWindow.send('apply-dark-mode', isDarkMode);
        addWindow.send('playlist-context', addWindowPlaylistId);
      })

      addWindow.setMenu(null);
    }

    console.log('add-music-window:::' + isDarkMode + ', playlist:' + addWindowPlaylistId);

  })

  // 监听'add-tracks'事件，添加音乐到指定歌单
  ipcMain.on('add-tracks', (event, tracks, playlistId) => {
    const targetPlaylistId = playlistId || addWindowPlaylistId || 'all'
    console.log('add-tracks received, count:', tracks ? tracks.length : 0, 'playlist:', targetPlaylistId)
    myStore.addTracks(tracks, targetPlaylistId)
    mainWindow.send('playlists-updated', myStore.getPlaylists())

    mainWindow.focus();

    if (addWindowInstance !== null) {
      addWindowInstance.close();
    }
  })

  // 监听'clean-tracks'事件，清空指定歌单
  ipcMain.on('clean-tracks', (event, playlistId) => {
    console.log('监听到clean-tracks事件, playlist:', playlistId)
    myStore.cleanTracks(playlistId || 'all')
    mainWindow.send('playlists-updated', myStore.getPlaylists())
  })

  // 监听'delete-track'事件，从指定歌单删除音乐
  ipcMain.on('delete-track', (event, { id, playlistId }) => {
    myStore.deleteTrack(id, playlistId || 'all')
    mainWindow.send('playlists-updated', myStore.getPlaylists())
  })

  // 监听'open-music-file'事件，打开文件对话框选择音乐文件，并发送选中的文件给渲染进程
  ipcMain.on('open-music-file', async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Music', extensions: ['mp3'] }]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        console.log('选了文件', result.filePaths);
        event.sender.send('selected-file', result.filePaths);
      }
    } catch (error) {
      console.error('打开文件对话框时出错:', error);
    }
  });


  // 监听来自渲染进程的 toggle-dark-mode 消息
  ipcMain.on('toggle-dark-mode', (event, isDarkMode) => {
    // 在这里处理切换深色模式的逻辑
    // 例如，通过窗口对象进行样式的修改
    mainWindow.webContents.send('apply-dark-mode', isDarkMode);

    //保存到配置文件
    myStore.saveIsDarkMode(isDarkMode);

  });


  // 监听来自桌面歌词窗口的关闭请求
  ipcMain.on('closeLyricWindow', () => {
    console.log('closeLyricWindow---->  lyricWindow states',lyricWindow);
    if (lyricWindow) {
      lyricWindow.close();
      myStore.saveShowLyricWindow(false);
    }
    mainWindow.webContents.send('updateLyricWindowStatus', false);
  });

  // 监听来自桌面歌词窗口的打开
  ipcMain.on('showLyricWindow', (event) => {
    myStore.saveShowLyricWindow(true);
    console.log('showLyricWindow---->   lyricWindow states', lyricWindow);
    if (!lyricWindow) {
      const { screen } = require('electron');
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      const lrcConfig = myStore.getLyricConfig();
      const savedPos = myStore.getLyricPosition();

      // 使用保存的位置，如果没有则使用默认位置
      let winX = savedPos ? savedPos.x : (width - 900) / 2;
      let winY = savedPos ? savedPos.y : height - 140;

      // 确保窗口在屏幕可视区域内
      if (winX < 0) winX = 0;
      if (winY < 0) winY = 0;
      if (winX > width - 200) winX = width - 200;
      if (winY > height - 60) winY = height - 60;

      lyricWindow = new BrowserWindow({
        width: 900,
        height: 120,
        x: winX,
        y: winY,
        alwaysOnTop: true,
        transparent: true,
        frame: false,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false,
        }
      });

      lyricWindow.setMenu(null);
      lyricWindow.loadFile('./renderer/lyric.html');

      // 加载完成后发送配置
      lyricWindow.webContents.on('did-finish-load', () => {
        lyricWindow.send('desk-lrc-init', lrcConfig);
        // 根据锁定状态启动鼠标区域检测
        if (lrcConfig && lrcConfig.locked) {
          lyricWindow.setIgnoreMouseEvents(true);
          deskMouseEventsIgnored = true;
          startDeskMouseCheck();
        }
      });

      // 窗口移动后保存位置（使用 moved 事件，拖动结束后触发）
      lyricWindow.on('moved', () => {
        if (lyricWindow) {
          const pos = lyricWindow.getPosition();
          myStore.saveLyricPosition(pos[0], pos[1]);
        }
      });

      lyricWindow.on('closed', () => {
        lyricWindow = null;
        stopDeskMouseCheck();
      });
    }
    mainWindow.webContents.send('updateLyricWindowStatus', true);
  });

  // 监听更新桌面歌词
  ipcMain.on('updateDeskLyric', (event, curLrc) => {
    if (lyricWindow) {
      lyricWindow.send('updateDeskLc', curLrc)
    }
  });

  // 监听桌面歌词配置变化
  ipcMain.on('desk-lrc-config', (event, config) => {
    myStore.saveLyricConfig(config);
  });

  // 监听桌面歌词锁定切换：锁定后完全穿透，鼠标移到控制栏区域时恢复交互
  ipcMain.on('toggle-desk-lock', (event, locked) => {
    const config = myStore.getLyricConfig();
    config.locked = locked;
    myStore.saveLyricConfig(config);
    if (lyricWindow) {
      if (locked) {
        lyricWindow.setIgnoreMouseEvents(true);
        deskMouseEventsIgnored = true;
        startDeskMouseCheck();
      } else {
        stopDeskMouseCheck();
        lyricWindow.setIgnoreMouseEvents(false);
      }
    }
  });


  // 监听随机播放的状态
  ipcMain.on('isRandom', (event, isRandom) => {
      //保存到配置文件
      myStore.saveIsRandom(isRandom);
  });

  // 监听单曲循环状态
  ipcMain.on('isLooping', (event, isLooping) => {
    //保存到配置文件
    myStore.saveIsLooping(isLooping);
  });

  // ========================= 歌单管理 IPC =========================
  ipcMain.on('get-playlists', (event) => {
    event.sender.send('playlists-updated', myStore.getPlaylists())
  })

  ipcMain.on('create-playlist', (event, name) => {
    const playlist = myStore.addPlaylist(name)
    event.sender.send('playlists-updated', myStore.getPlaylists())
    event.sender.send('playlist-created', playlist)
  })

  ipcMain.on('rename-playlist', (event, { id, name }) => {
    myStore.renamePlaylist(id, name)
    event.sender.send('playlists-updated', myStore.getPlaylists())
  })

  ipcMain.on('delete-playlist', (event, id) => {
    myStore.deletePlaylist(id)
    event.sender.send('playlists-updated', myStore.getPlaylists())
  })

  ipcMain.on('add-to-playlist', (event, { sourcePlaylistId, targetPlaylistId, trackId }) => {
    myStore.addTrackToPlaylist(sourcePlaylistId, targetPlaylistId, trackId)
    event.sender.send('playlists-updated', myStore.getPlaylists())
  })

  ipcMain.on('remove-from-playlist', (event, { playlistId, trackId }) => {
    myStore.removeTrackFromPlaylist(playlistId, trackId)
    event.sender.send('playlists-updated', myStore.getPlaylists())
  })

  ipcMain.on('reorder-playlist', (event, { playlistId, trackIds }) => {
    myStore.reorderPlaylist(playlistId, trackIds)
    event.sender.send('playlists-updated', myStore.getPlaylists())
  })

  ipcMain.on('reorder-tracks', (event, { playlistId, trackIds }) => {
    myStore.reorderTracks(trackIds, playlistId || 'all')
    event.sender.send('playlists-updated', myStore.getPlaylists())
  })

  ipcMain.on('save-playback-state', (event, { playlistId, trackId }) => {
    myStore.savePlaybackState(playlistId, trackId)
  })









})
