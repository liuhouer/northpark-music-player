
//引入了Electron模块中的app、BrowserWindow、ipcMain和dialog对象，并引入了自定义的MusicDataStore模块。
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const DataStore = require('./renderer/MusicDataStore')

// 支持的音频格式
const SUPPORTED_AUDIO_EXTS = ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a']

// 从命令行参数中提取音频文件路径
const extractAudioFiles = (args) => {
  return args.filter(arg => {
    const ext = path.extname(arg).toLowerCase().slice(1)
    return SUPPORTED_AUDIO_EXTS.includes(ext)
  })
}

// 缓存待处理的外部文件（macOS open-file 可能在 ready 前触发）
let pendingExternalFiles = []

// 递归扫描文件夹中的音频文件
const scanMusicFiles = (dirPath) => {
  const results = []
  try {
    const items = fs.readdirSync(dirPath)
    for (const item of items) {
      const fullPath = path.join(dirPath, item)
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        results.push(...scanMusicFiles(fullPath))
      } else {
        const ext = path.extname(fullPath).toLowerCase().slice(1)
        if (SUPPORTED_AUDIO_EXTS.includes(ext)) {
          results.push(fullPath)
        }
      }
    }
  } catch (e) {
    console.error('扫描文件夹出错:', dirPath, e.message)
  }
  return results
}


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


let mainWindow = null; // 主窗口的引用
let lyricWindow = null; // 歌词窗口的引用
let tray = null; // 系统托盘引用
let isQuitting = false; // 是否正在退出
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


// 设置托盘图标和菜单的公共逻辑
const setupTray = (trayIcon) => {
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Northpark Music Player')

  const buildContextMenu = () => {
    return Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      { type: 'separator' },
      {
        label: '播放 / 暂停',
        click: () => {
          if (mainWindow) mainWindow.webContents.send('tray-play-pause')
        }
      },
      {
        label: '下一曲',
        click: () => {
          if (mainWindow) mainWindow.webContents.send('tray-next')
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  }

  tray.setContextMenu(buildContextMenu())

  // 左键单击显示/隐藏主窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
}

let trayIconDataUrl = null // 缓存 renderer 传来的图标数据

// 接收 renderer 进程生成的托盘图标
ipcMain.on('tray-icon-data', (event, dataUrl) => {
  trayIconDataUrl = dataUrl
  if (tray) {
    tray.setImage(nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 }))
  }
})

// ========================= 系统托盘 =========================
const createTray = async () => {
  if (tray) return

  // 先尝试从 build 目录加载 ICO 文件
  const iconPath = path.join(__dirname, 'build', 'icon128.ico')
  let trayIcon = null

  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) throw new Error('ICO 文件加载为空')
  } catch (e) {
    console.log('ICO 文件加载失败，尝试从应用 exe 提取图标:', e.message)
    try {
      trayIcon = await app.getFileIcon(app.getPath('exe'))
      if (!trayIcon || trayIcon.isEmpty()) throw new Error('exe 图标提取失败')
    } catch (e2) {
      console.error('托盘图标加载彻底失败:', e2.message)
      return
    }
  }

  setupTray(trayIcon)

  // 如果已有 renderer 传来的图标数据，立即更新为音符图标
  if (trayIconDataUrl) {
    tray.setImage(nativeImage.createFromDataURL(trayIconDataUrl).resize({ width: 16, height: 16 }))
  }
}

// 更新托盘 tooltip 显示播放状态
const updateTrayTooltip = (isPlaying, title) => {
  if (!tray) return
  if (isPlaying && title) {
    tray.setToolTip(`正在播放: ${title}\nNorthpark Music Player`)
  } else {
    tray.setToolTip('Northpark Music Player')
  }
}

// ========================= 设为默认播放器（Windows 注册表） =========================
const PROG_ID = 'NorthparkMusicPlayer'
const DEFAULT_EXTS = ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a']

// 使用 spawn 执行 reg 命令，避免 shell 引号转义问题
const execReg = (args) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('reg', args, { shell: false })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `reg 命令退出码 ${code}`))
      else resolve(stdout)
    })
  })
}

const isDefaultPlayer = async () => {
  if (process.platform !== 'win32') return false
  try {
    const stdout = await execReg(['query', 'HKEY_CURRENT_USER\\Software\\Classes\\.mp3', '/ve'])
    const match = stdout.match(/REG_SZ\s+(\S+)/)
    return match && match[1] === PROG_ID
  } catch (e) {
    return false
  }
}

const setAsDefaultPlayer = async () => {
  if (process.platform !== 'win32') {
    throw new Error('仅支持 Windows 系统')
  }
  const exePath = app.getPath('exe')
  const command = `"${exePath}" "%1"`

  // 1. 创建 ProgID
  await execReg(['add', `HKEY_CURRENT_USER\\Software\\Classes\\${PROG_ID}`, '/ve', '/d', 'Northpark Music Player', '/f'])
  await execReg(['add', `HKEY_CURRENT_USER\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`, '/ve', '/d', command, '/f'])
  await execReg(['add', `HKEY_CURRENT_USER\\Software\\Classes\\${PROG_ID}\\DefaultIcon`, '/ve', '/d', `${exePath},0`, '/f'])

  // 2. 注册到 Windows "默认应用" 设置界面（RegisteredApplications + Capabilities）
  await execReg(['add', 'HKEY_CURRENT_USER\\Software\\RegisteredApplications', '/v', PROG_ID, '/d', `Software\\${PROG_ID}\\Capabilities`, '/f'])
  await execReg(['add', `HKEY_CURRENT_USER\\Software\\${PROG_ID}\\Capabilities`, '/v', 'ApplicationName', '/d', 'Northpark Music Player', '/f'])
  await execReg(['add', `HKEY_CURRENT_USER\\Software\\${PROG_ID}\\Capabilities`, '/v', 'ApplicationDescription', '/d', 'A minimalist and elegant music player crafted by northpark.cn', '/f'])

  for (const ext of DEFAULT_EXTS) {
    await execReg(['add', `HKEY_CURRENT_USER\\Software\\${PROG_ID}\\Capabilities\\FileAssociations`, '/v', `.${ext}`, '/d', PROG_ID, '/f'])
  }

  // 3. 为每个扩展名设置默认值
  for (const ext of DEFAULT_EXTS) {
    await execReg(['add', `HKEY_CURRENT_USER\\Software\\Classes\\.${ext}`, '/ve', '/d', PROG_ID, '/f'])
  }
}

// 单实例锁：确保只有一个应用实例运行，Windows 双击文件时通过 second-instance 传递
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv, cwd) => {
    const files = extractAudioFiles(argv)
    if (files.length > 0 && mainWindow) {
      myStore.addTracks(files, 'all')
      mainWindow.send('playlists-updated', myStore.getPlaylists())
      mainWindow.send('open-external-file', files[0])
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// macOS 上通过 Finder 打开文件
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const ext = path.extname(filePath).toLowerCase().slice(1)
  if (SUPPORTED_AUDIO_EXTS.includes(ext)) {
    if (mainWindow && mainWindow.webContents) {
      myStore.addTracks([filePath], 'all')
      mainWindow.send('playlists-updated', myStore.getPlaylists())
      mainWindow.send('open-external-file', filePath)
    } else {
      pendingExternalFiles.push(filePath)
    }
  }
})

app.on('ready', () => {


  // 在 Electron 主进程中打印 app.getAppPath()
  console.log(app.getAppPath());

  console.log(app.getPath('userData'))

  // 当应用程序准备就绪时触发的事件回调函数
  // 创建主窗口实例，并加载主页HTML文件
  mainWindow = new AppWindow({}, './renderer/index.html')

  // 创建系统托盘
  createTray().catch(err => console.error('创建托盘失败:', err))

  // 处理启动时通过命令行传入的音频文件
  const startupFiles = extractAudioFiles(process.argv)
  if (startupFiles.length > 0) {
    pendingExternalFiles.push(...startupFiles)
  }

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

    // 处理待播放的外部文件（命令行/文件关联打开）
    if (pendingExternalFiles.length > 0) {
      const files = [...pendingExternalFiles]
      pendingExternalFiles = []
      myStore.addTracks(files, 'all')
      mainWindow.send('playlists-updated', myStore.getPlaylists())
      mainWindow.send('open-external-file', files[0])
    }
  })

  // 关闭时最小化到托盘
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      // Windows 上显示托盘气球提示
      if (tray && process.platform === 'win32') {
        tray.displayBalloon({
          iconType: 'none',
          title: 'Northpark Music Player',
          content: '应用已最小化到系统托盘，右键托盘图标可快速控制播放',
          respectQuietTime: true
        })
      }
    }
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
        filters: [{ name: 'Music', extensions: SUPPORTED_AUDIO_EXTS }]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        console.log('选了文件', result.filePaths);
        event.sender.send('selected-file', result.filePaths);
      }
    } catch (error) {
      console.error('打开文件对话框时出错:', error);
    }
  });

  // 监听'open-music-folder'事件，打开文件夹对话框并递归扫描音频文件
  ipcMain.on('open-music-folder', async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0];
        console.log('选了文件夹', folderPath);
        const files = scanMusicFiles(folderPath);
        console.log('扫描到音频文件', files.length, '个');
        if (files.length > 0) {
          event.sender.send('selected-file', files);
        }
      }
    } catch (error) {
      console.error('打开文件夹对话框时出错:', error);
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

  // 监听播放状态变化，更新托盘 tooltip
  ipcMain.on('playback-status-changed', (event, { isPlaying, title }) => {
    updateTrayTooltip(isPlaying, title)
  })

  // 设为默认播放器（保留注册表写入，确保应用出现在默认应用列表中）
  ipcMain.on('set-default-player', async (event) => {
    try {
      await setAsDefaultPlayer()
      event.sender.send('default-player-result', { success: true, message: '已设为默认音乐播放器' })
    } catch (err) {
      event.sender.send('default-player-result', { success: false, message: err.message || '设置失败' })
    }
  })

  // 打开 Windows 默认应用设置界面
  ipcMain.on('open-default-apps-settings', () => {
    if (process.platform === 'win32') {
      shell.openExternal('ms-settings:defaultapps')
    }
  })

  // 检测是否已是默认播放器
  ipcMain.on('check-default-player', async (event) => {
    try {
      const isDefault = await isDefaultPlayer()
      event.sender.send('default-player-status', isDefault)
    } catch (err) {
      event.sender.send('default-player-status', false)
    }
  })

})

// 真正退出前设置标志
app.on('before-quit', () => {
  isQuitting = true
})

// 所有窗口关闭后不退出（托盘还在）
app.on('window-all-closed', () => {
  // macOS 上通常保留应用运行，其他平台也保留（因为有托盘）
})