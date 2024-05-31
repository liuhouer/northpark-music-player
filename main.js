
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
      height: 600,
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


app.on('ready', () => {


  // 在 Electron 主进程中打印 app.getAppPath()
  console.log(app.getAppPath());

  console.log(app.getPath('userData'))

  // 当应用程序准备就绪时触发的事件回调函数
  // 创建主窗口实例，并加载主页HTML文件
  const mainWindow = new AppWindow({}, './renderer/index.html')

  // 在主窗口的webContents完成加载后，发送获取音乐数据的请求
  mainWindow.webContents.on('did-finish-load',() => {
    //恢复音乐列表
    mainWindow.send('getTracks', myStore.getTracks())
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
  // 监听'add-music-window'事件，创建添加音乐窗口实例
  ipcMain.on('add-music-window',(event, isDarkMode) => {
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
        addWindowInstance = addWindow; // 设置addWindowInstance为当前打开的addWindow实例
      });

      addWindow.on('closed', () => {
        addWindowInstance = null; // 清空addWindowInstance
      });

      // 在子窗口的webContents完成加载后，发送获取音乐数据的请求
      addWindow.webContents.on('did-finish-load',() => {
        addWindow.send('apply-dark-mode', isDarkMode);
      })

      addWindow.setMenu(null); // 移除菜单栏
    }

    console.log('add-music-window:::' + isDarkMode);

  })

  // 监听'add-tracks'事件，添加音乐到数据存储，并发送更新后的音乐数据给主窗口
  ipcMain.on('add-tracks', (event, tracks) => {
    const updatedTracks = myStore.addTracks(tracks).getTracks()
    mainWindow.send('getTracks', updatedTracks)

    mainWindow.focus();

    if (addWindowInstance !== null) {
      addWindowInstance.close(); // 关闭 addWindow 窗口
    }



  })

  // 监听'clean-tracks'事件，清空播放列表
  ipcMain.on('clean-tracks', (event, tracks) => {
    console.log('监听到clean-tracks事件')
    const updatedTracks = []
    myStore.cleanTracks();
    mainWindow.send('getTracks', updatedTracks)
  })

  // 监听'delete-track'事件，从数据存储中删除音乐，并发送更新后的音乐数据给主窗口
  ipcMain.on('delete-track', (event, id) => {
    const updatedTracks = myStore.deleteTrack(id).getTracks()
    mainWindow.send('getTracks', updatedTracks)
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
      //保存到配置文件
      myStore.saveShowLyricWindow(false);

    }
    mainWindow.webContents.send('updateLyricWindowStatus', false);
  });

  // 监听来自桌面歌词窗口的打开
  ipcMain.on('showLyricWindow',(event) => {
    //保存到配置文件
    myStore.saveShowLyricWindow(true);
    console.log('showLyricWindow---->   lyricWindow states',lyricWindow);
    // 发送showLyricWindow事件给歌词窗口
    if (!lyricWindow) {

      const { screen } = require('electron');
      // 获取屏幕的宽度和高度
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;

      // 创建歌词窗口
      lyricWindow = new BrowserWindow({
        width: 900,
        height: 100,
        x: (width - 900) / 2, // 将窗口水平居中
        y: height - 120, // 将窗口设置在屏幕最下方
        alwaysOnTop: true, // 窗口始终显示在最上层
        transparent: true, // 设置窗口为透明
        frame: false, // 移除窗口的边框
        skipTaskbar: true, // 不显示在任务栏
        webPreferences: {
          nodeIntegration: true, // 允许在窗口中使用Node.js API
          contextIsolation: false,
          webSecurity: false,
        }
      });

      // 设置窗口透明度为20%
      //lyricWindow.setOpacity(0.9);

      // 启用鼠标穿透
      lyricWindow.setIgnoreMouseEvents(true, { forward: true });

      lyricWindow.setMenu(null); // 移除菜单栏


      // 加载歌词窗口的HTML文件
      lyricWindow.loadFile('./renderer/lyric.html');

      // 当歌词窗口被关闭时将其引用置为空
      lyricWindow.on('closed', () => {
        lyricWindow = null;
        //mainWindow.webContents.send('updateLyricWindowStatus', false);
      });

    }
    mainWindow.webContents.send('updateLyricWindowStatus', true);
  });

  // 监听更新桌面歌词
  ipcMain.on('updateDeskLyric',(event,curLrc) => {


    if(lyricWindow){
      lyricWindow.send('updateDeskLc', curLrc)
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









})
