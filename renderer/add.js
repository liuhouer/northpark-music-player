const { ipcRenderer } = require('electron')
const { $ } = require('./helper')
const path = require('path')
let musicFilesPath = []


$('select-music').addEventListener('click', () => {
  console.log('发送了事件---打开文件')
  ipcRenderer.send('open-music-file')
})

//点击了导入音乐
$('add-music').addEventListener('click', () => {
  ipcRenderer.send('add-tracks', musicFilesPath)
})

const renderListHTML = (pathes) => {
  const musicList = $('musicList')
  const musicItemsHTML = pathes.reduce((html, music) => {
    html += `<li class="list-group-item">${path.basename(music)}</li>`
    return html
  }, '')
  musicList.innerHTML = `<ul class="list-group">${musicItemsHTML}</ul>`
}

//选择音乐
ipcRenderer.on('selected-file', (event, path) => {
  if(Array.isArray(path)) {
    renderListHTML(path)
    musicFilesPath = path
  }
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
