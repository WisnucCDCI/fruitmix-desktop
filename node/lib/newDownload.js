import os from 'os'
import child_process from 'child_process'
import createTask, { sendMsg } from './downloadTaskCreater'
import { getMainWindow } from './window'
import { dialog, ipcMain, shell } from 'electron'

const userTasks = []
const finishTasks = []

// args have imformation about file/folder get from server
// name,uuid,size,type were used to create manager
const downloadHandle = (event, args, callback) => {
  const files = args.files
  const folders = args.folders
  // console.log('downloadHandle:')
  // console.log(files)
  files.forEach(item => createTask(item.uuid, item.name, item.size, item.type, args.dirUUID, true))
  folders.forEach(item => createTask(item.uuid, item.name, 0, item.type, args.dirUUID ? args.dirUUID : item.uuid, true))

  const count = files.length + folders.length
  getMainWindow().webContents.send('snackbarMessage', { message: `${count}个任务添加至下载队列` })
}

const openHandle = (event, args, callback) => {
  console.log('openHandle start')
  console.log(args)
  console.log('openHandle start download')
  // downloadHandle(event, args, callback)
  shell.openItem('/home/lxw/Desktop/PC_Design/PC_Client_Design_Function_Avatar.pdf')
  console.log('openHandle end')
}

const startTransmissionHandle = () => {
  db.downloading.find({}, (err, tasks) => {
    if (err) return
    tasks.forEach(item => createTask(item.target, item.name, item.rootSize, item.type, item.dirUUID,
      false, item.downloadPath, item._id, item.downloading, item.createTime))
  })

  db.downloaded.find({}).sort({ finishDate: -1 }).exec((err, tasks) => {
    if (err) return console.log(err)
    tasks.forEach(item => item.uuid = item._id)
    finishTasks.splice(0, 0, ...tasks)
    sendMsg()
  })
}

const deleteDownloadingHandle = (e, tasks) => {
  tasks.forEach((item) => {
    const obj = userTasks.find(task => task.uuid === item.uuid)
    if (obj) obj.delete(cleanRecord)
  })
}

const deleteDownloadedHandle = (e, tasks) => {
  console.log(tasks)
  tasks.forEach((item) => {
    const obj = finishTasks.find(task => task.uuid === item.uuid)
    if (obj) cleanRecord('finish', item.uuid)
  })
}

const cleanRecord = (type, uuid) => {
  const list = type === 'finish' ? finishTasks : userTasks
  const d = type === 'finish' ? db.downloaded : db.downloading
  const index = list.findIndex(item => item.uuid === uuid)
  if (index === -1) return console.log('任务没有在任务列表中')

  console.log(`删除列表中任务... 第${index + 1}个 共${list.length}个`)
  list.splice(index, 1)
  console.log(`列表中任务删除完成 剩余${list.length}个`)
  d.remove({ _id: uuid }, {}, (err, doc) => {
    if (err) return console.log('删除数据库记录出错')
    console.log('删除数据库记录成功')
    sendMsg()
  })
}

ipcMain.on('START_TRANSMISSION', startTransmissionHandle)
ipcMain.on('GET_TRANSMISSION', sendMsg)
ipcMain.on('DELETE_DOWNLOADING', deleteDownloadingHandle)
ipcMain.on('DELETE_DOWNLOADED', deleteDownloadedHandle)
ipcMain.on('DOWNLOAD', downloadHandle)
ipcMain.on('OPEN_FILE', openHandle)

ipcMain.on('PAUSE_DOWNLOADING', (e, uuid) => {
  if (!uuid) return
  const task = userTasks.find(item => item.uuid === uuid)
  if (task) { task.pauseTask() }
})

ipcMain.on('RESUME_DOWNLOADING', (e, uuid) => {
  if (!uuid) return
  const task = userTasks.find(item => item.uuid === uuid)
  if (task) task.resumeTask()
})

ipcMain.on('LOGIN_OUT', (e) => {
  console.log('LOGIN_OUT in download')
  userTasks.forEach(item => item.pauseTask())
  userTasks.length = 0
  sendMsg()
})


export { userTasks, finishTasks }
