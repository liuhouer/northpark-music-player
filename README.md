# northpark-music-player

**本项目使用 Electron 完成了一个本地音乐播放器**

使用本项目

第一步安装依赖

```bash
npm install
```

本地运行项目

```bash
npm start
```

项目打包成 App

```bash
npm run dist
```

```bash
 ico图标256 *256 ;size <=50kb
```



## 1.1.0 实现歌单上下文传递和全新UI设计

###  新增
- 重构整体UI布局，采用现代化网格系统设计播放器界面
- 添加左侧边栏导航和歌单管理功能
- 桌面歌词自定义颜色以及锁定和字体大小
- 添加歌单上下文接收功能，在添加音乐时传递当前歌单ID
- 实现拖拽排序和歌单操作菜单功能

###  调整
- 实现深色模式紫罗兰主题样式系统，使用CSS变量统一管理颜色
- 实现底部播放器栏和歌曲列表表格布局
- 集成搜索功能和播放控制组件
- 添加音乐频谱可视化效果

![1 1 0](https://github.com/user-attachments/assets/bbfa1b9e-d5fd-414d-9233-7921286c8580)
![1 1 0 b](https://github.com/user-attachments/assets/73b6f0be-222c-412b-9c63-359649919026)

