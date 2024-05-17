
//引入了Electron模块中的app、BrowserWindow、ipcMain和dialog对象，并引入了自定义的MusicDataStore模块。
const { app, BrowserWindow, ipcMain, dialog ,nativeTheme } = require('electron')
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
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true
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

app.on('ready', () => {
  // 在 Electron 主进程中打印 app.getAppPath()
  console.log(app.getAppPath());

  console.log(app.getPath('userData'))

  // 当应用程序准备就绪时触发的事件回调函数
  // 创建主窗口实例，并加载主页HTML文件
  const mainWindow = new AppWindow({}, './renderer/index.html')

  // 在主窗口的webContents完成加载后，发送获取音乐数据的请求
  mainWindow.webContents.on('did-finish-load',() => {
    mainWindow.send('getTracks', myStore.getTracks())
  })


  let addWindowInstance = null;
  // 监听'add-music-window'事件，创建添加音乐窗口实例
  ipcMain.on('add-music-window',(event, isDarkMode) => {
    if (addWindowInstance === null) {
      const addWindow = new BrowserWindow({
        width: 500,
        height: 400,
        parent: mainWindow,
        webPreferences: {
          nodeIntegration: true
        }
      });

      addWindow.loadFile('./renderer/add.html');

      addWindow.once('ready-to-show', () => {
        addWindow.show();
        addWindowInstance = null; // 窗口关闭后将实例设为null
      });

      addWindow.on('closed', () => {
        addWindowInstance = null; // 清空addWindowInstance
      });

      addWindowInstance = addWindow; // 设置addWindowInstance为当前打开的addWindow实例

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
  ipcMain.on('open-music-file', (event) => {
    dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Music', extensions: ['mp3'] }]
    }, (files) => {
      if (files) {
        event.sender.send('selected-file', files)
      }
    })
  })


  // 监听来自渲染进程的 toggle-dark-mode 消息
  ipcMain.on('toggle-dark-mode', (event, isDarkMode) => {
    // 在这里处理切换深色模式的逻辑
    // 例如，通过窗口对象进行样式的修改
    mainWindow.webContents.send('apply-dark-mode', isDarkMode);

  });




})
