import path from 'path'
import fs from 'fs'

import request from 'request'
import uuid from 'node-uuid'
import { ipcMain } from 'electron'

import store from '../serve/store/store'
import { userTasks, finishTasks} from './newDownload'
import utils from './util'
import { getMainWindow } from './window'

let server
let user
let httpRequestConcurrency = 4
let visitConcurrency = 2
let sendHandler = null

const runningQueue = []
const readyQueue = []
const visitlessQueue = []
const visitingQueue = []

const initArgs = () => {
  server = 'http://' + store.getState().config.ip + ':3721'
  user = store.getState().login.obj
}

const sendMessage = () => {
	let shouldSend = false
	for(let i = 0; i < userTasks.length; i++) {
		if (userTasks[i].state !== 'pause') {
			shouldSend = true
			break
		}
	}
	if (shouldSend && !sendHandler) {
		console.log('开始发送传输信息')
		sendHandler = setInterval(sendMsg, 2000)
		sendMsg()
	}else if (!shouldSend && sendHandler) {
		console.log('停止发送传输信息')
		clearInterval(sendHandler)
		sendHandler = null
		sendMsg()
	}
}

const sendMsg = () => {
	let mainWindow = getMainWindow()
  mainWindow.webContents.send('UPDATE_DOWNLOAD', userTasks.map(item => item.getSummary()), finishTasks.map(i => i.getSummary?i.getSummary():i))
}

//TaskManager creater
//new job :init manager with default parameter
//old job :init manager with defined parameter(uuid, dwonloadpath, downloading information)
const createTask = (target, name, size, type, newWork, p, u, d) => {
	console.log(size)
	initArgs()
	let taskUUID = u?u:uuid.v4()
	let abspath = p?p:store.getState().config.download
	let downloadingList = d?d:[]
	let task = new TaskManager(taskUUID, abspath, target, name, size, type, newWork, downloadingList)
	task.createStore()
	userTasks.push(task)
	task.readyToVisit()
	sendMessage()
}

class TaskManager {
	constructor(taskUUID, downloadPath, target, name, rootSize, type, newWork, downloadingList) {
		this.uuid = taskUUID
		this.downloadPath = downloadPath
		this.target = target
		this.name = name
		this.rootSize = rootSize //for visit
		this.type = type
		this.newWork = newWork

		this.size = 0
		this.completeSize = 0
		this.lastTimeSize = 0 // for count speed
		this.speed = ''
		this.restTime = ''
		this.state = ''
		this.pause = false
		this.count = 0
		this.finishCount = 0
		this.finishDate = null

		this.downloadIndex = 0
		this.tree = []
		this.worklist = []
		this.downloading = []
		this.downloadingList = downloadingList //for continue downloading
		this.record = []

		this.countSpeed = setInterval(() => {
			let s = (this.completeSize - this.lastTimeSize) / 1
			this.speed = utils.formatSize(s) + ' / 秒'
			this.restTime = utils.formatSeconds((this.size - this.completeSize) / s)
			this.lastTimeSize = this.completeSize
		}, 1000)
	}

	// summary send to browser
	getSummary() {
		return {
			uuid: this.uuid,
			type: this.type,
			name: this.name,
			size: this.size,
			completeSize: this.completeSize,
			count: this.count,
			finishCount: this.finishCount,
			restTime: this.restTime,
			finishDate: this.finishDate,
			state: this.state,
			pause: this.pause,
			speed: this.speed
		}
	}

	//record log information
	recordInfor(msg) {
		if (this.record.length > 50) this.record.splice(0,20)
		console.log(msg)
		this.record.push(msg)
	}

	//add to visit queue
	readyToVisit() {
		this.state = 'visitless'
		addToVisitlessQueue(this)
	}

	//consist tree from server
	visit() {
		this.state = 'visiting'
		let _this = this
		this.recordInfor('开始遍历文件树...')
		removeOutOfVisitlessQueue(this)
		addToVisitingQueue(this)
		visitTask(this.target, this.name, this.type, this.rootSize, this.tree, this, (err, data) => {
			if (err) return _this.recordInfor('遍历服务器数据出错')
			_this.tree[0].downloadPath = _this.downloadPath
			removeOutOfVisitingQueue(this)
			_this.recordInfor('遍历文件树结束...')
			fs.readdir(this.downloadPath, (err, files) => {
				if (err) return this.recordInfor('下载目录未找到')
				console.log(files)
				isFileNameExist(this.tree[0].name, files)
				_this.diff()	
			})
			
		})
	}

	diff() {
		this.state = 'diffing'
		if (!this.newWork) {
			fs.stat(path.join(this.downloadPath, this.name), (err, stat) => {
				if (err) {
					this.recordInfor('已下载的文件查找错误')
					this.schedule()
				}else {
					if (stat.isFile()) {
						this.recordInfor('文件下载任务 继续下载文件')
						this.schedule()
					}else {
						this.recordInfor('文件夹下载任务 查找本地已下载文件信息')
						let localObj = []
						visitLocalFiles(path.join(this.downloadPath, this.name), localObj, (err) => {
							if (err) {
								this.recordInfor('校验本地文件出错')
								this.schedule()
							}else {
								this.recordInfor('校验本地文件结束')
								diffTree(this.tree[0], localObj[0], this, err => {
									if (err) console.log(err)
									this.schedule()
								})
							}
						})
					}
				}
			})
		}else {
			this.recordInfor('新任务 不需要与服务器进行比较')
			this.schedule()
		}
	}

	pauseTask() {
		this.pause = true
		this.downloading.forEach(work => {
			if (work.type === 'file') work.pause()
		})
	}

	resumeTask() {
		this.pause = false
		this.downloading.forEach(work => {
			if (work.type === 'file') work.resume() 
		})
	}

	schedule() {
		this.state = 'schedule'
		if (this.pause || !this.count) return
		this.downloadSchedule()
	}

	downloadSchedule() {
		console.log('进行下载调度...')
		if (this.pause) return this.recordInfor('下载任务已暂停')
		if (this.finishCount === this.worklist.length) return this.recordInfor('文件全部下载结束')
		if (this.downloading.length >=2 ) return this.recordInfor('任务下载队列已满')
		if (this.downloadIndex === this.worklist.length) return this.recordInfor('所有文件下载调度完成')
		this.recordInfor('正在调度第 ' + (this.downloadIndex + 1) + ' 个文件,总共 ' + this.worklist.length + ' 个')
		let _this = this
		let obj = this.worklist[this.downloadIndex]
		if (obj.stateName === 'finish') {
			this.recordInfor('文件已被下载，跳过...')
			this.downloadIndex++
			this.downloadSchedule()
			return
		}
		if (obj.downloadPath === '') return this.recordInfor('文件的父文件夹尚未创建，缺少目标，等待..')
		let stateMachine = obj.type == 'folder'? createFolderSTM : DownloadFileSTM
		obj.setState(stateMachine)
		this.downloading.push(obj)
		this.downloadIndex++
		obj.requestProbe()
		this.downloadSchedule()
	}

	workFinishCall() {
		if (this.finishCount === this.worklist.length) {
			this.state = 'finish'
			this.finishDate = utils.formatDate()
			userTasks.splice(userTasks.indexOf(this),1)
			finishTasks.push(this)
			clearInterval(this.countSpeed)
			sendMessage()
			this.recordInfor(this.name + ' 下载完成')
			this.finishStore()
		}else {
			this.downloadSchedule()
		}
	}

	getStoreObj() {
		let downloadingArr = []
		this.downloading.forEach(item => {
			if (item.type === 'file') {
				downloadingArr.push(item.getSummary())
			}
		})
		return {
			_id: this.uuid,
			downloadPath: this.downloadPath,
			target: this.target,
			name: this.name,
			rootSize: this.rootSize,
			type: this.type,
			downloading: downloadingArr,
			finishDate: this.finishDate
		}
	}

	createStore() {
		if (!this.newWork) return
		db.downloading.insert(this.getStoreObj(), (err, data) => {})
	}

	updateStore() {
		let downloadingArr = []
		this.downloading.forEach(item => {
			if (item.type === 'file') {
				downloadingArr.push(item.getSummary())
			}
		})
		db.downloading.update({_id: this.uuid}, {$set: {downloading:downloadingArr}}, (err, data) => {
			// console.log(data)
		})
	}

	finishStore() {
		db.downloading.remove({_id: this.uuid}, {}, (err,data) => {
			if (err) return console.log(err)
		})

		db.downloaded.insert(this.getStoreObj(), (err, data) => {
			if (err) return console.log(err) 
			console.log(data)
		})
	}
}

const visitTask = (target, name, type, size, position, manager, callback) => {
	manager.count++
	manager.size += size
	let obj = type === 'file'?
  	new FileDownloadTask(target, name, type, size, manager):
  	new FolderDownloadTask(target, name, type, size, manager)

  let index = manager.downloadingList.findIndex(item => item.target === target)
  if (index !== -1) {
  	// may be local file has been removed
  	obj.seek = manager.downloadingList[index].seek
  	obj.timeStamp = manager.downloadingList[index].timeStamp
  	manager.completeSize += manager.downloadingList[index].seek
  }
  manager.worklist.push(obj)
	position.push(obj)

	if (type === 'file') return callback(null)

	let options = {
		method: 'GET',
		url: server + '/files/' + target,
		headers: {
			Authorization: user.type + ' ' + user.token
		}
	}

	request(options, (err, data) => {
		let tasks = JSON.parse(data.body)
		if (err) return callback(err)
		if (!tasks.length) return callback(null)
		let count = tasks.length
		let index = 0
		let task = tasks[index]
		let next = () => {visitTask(task.uuid, task.name, task.type, task.size?task.size:0, obj.children, manager, call)}
		let call = (err) => {
			if (err) return callback(err)
			if (++index === count) return callback(null)
			task = tasks[index]
			next()
		}
		next()
	})
}

const visitLocalFiles = (abspath, position, callback) => {
	fs.stat(abspath, (err, stat) => {
		if (err || ( !stat.isDirectory() && !stat.isFile())) return callback(err)
		let type = stat.isDirectory()?'folder':'file'
		let obj = {name: path.basename(abspath), type, children: []}
		position.push(obj)
		if (stat.isFile()) return callback(null)
		fs.readdir(abspath, (err, entries) => {
			if (err) return callback(err)
			if (!entries.length) return callback(null)
			let count = entries.length
			let index = 0
			let next = () => {visitLocalFiles(path.join(abspath, entries[index]), obj.children, call)}
			let call = err => {
				if (err) return callback(err)
				if (++index == count) return callback()
				else next()
			}
			next()
		})
	})
}

const diffTree = (taskPosition, localPosition, manager ,callback) => {
	if (taskPosition.name !== localPosition.name) return callback()
	taskPosition.stateName = 'finish'
	manager.finishCount++
	manager.completeSize += taskPosition.size?taskPosition.size:0
	if(taskPosition.type === 'file') return callback()
	let children = taskPosition.children
	if(!children.length) return callback()
	children.forEach(item => item.downloadPath = path.join(taskPosition.downloadPath, taskPosition.name))
	let count = children.length
	let index = 0
	let next = () => {
		let currentObj = taskPosition.children[index]
		let i = localPosition.children.findIndex(item => item.name == currentObj.name)
		if (i !== -1) {
			diffTree(currentObj, localPosition.children[i], manager, call)
		}else {
			call()
		}
	}
	let call = (err) => {
		if (++index == count) return callback()
		else next()
	}
	next()
}

class DownloadTask {
	constructor(target, name, type, size, manager) {
		this.target = target
		this.name = name
		this.type = type
		this.size = size
		this.manager = manager
		
		this.downloadPath = ''
		this.state = null
    this.stateName = ''
	}

	setState(NextState) {
		this.state = new NextState(this)
	}

	requestProbe() {
		this.state.requestProbe()
	}

	downloadFinish() {
		let manager = this.manager
		this.recordInfor(this.name + ' 下载完毕')
		this.state = null
		this.stateName = 'finish'
		manager.downloading.splice(manager.downloading.indexOf(this), 1)
		manager.finishCount++
		manager.workFinishCall()
	}

	recordInfor(msg) {
		this.manager.recordInfor(msg)
	}

	pause() {
		this.state.pause()
	}

	resume() {
		this.state.resume()
	}
}

class FileDownloadTask extends DownloadTask{
	constructor(type, target, name, size, manager) {
		super(type, target, name, size, manager)
		this.progress = 0
		this.seek = 0
		this.timeStamp = (new Date()).getTime()
	}

	getSummary() {
		return {
			name: this.name,
			target: this.target,
			downloadPath: this.downloadPath,
			seek: this.seek,
			timeStamp: this.timeStamp
		}
	}
}

class FolderDownloadTask extends DownloadTask{
	constructor(type, target, name, size, manager) {
		super(type, target, name, size, manager)
		this.children = []
	}
}

class STM {
	constructor(wrapper) {
		this.wrapper = wrapper
	}

	requestProbe() {
		this.wrapper.stateName = 'ready'
		addToReadyQueue(this)
	}

	destructor() {
	}
}

class createFolderSTM extends STM {
	constructor(wrapper) {
		super(wrapper)
		this.handle = null
	}

	downloading() {
		let _this = this
		let wrapper = this.wrapper
		wrapper.stateName = 'running'
		removeOutOfReadyQueue(this)
		addToRunningQueue(this)
    wrapper.recordInfor(wrapper.name + ' 开始创建...')
    fs.mkdir(path.join(wrapper.downloadPath, wrapper.name), err => {
    	if (!err) {
    		removeOutOfRunningQueue(_this)
    		wrapper.children.forEach(item => item.downloadPath = path.join(wrapper.downloadPath, wrapper.name))
    		wrapper.downloadFinish()
    	}else {

    	}
    })
	}
}

class DownloadFileSTM extends STM {
	constructor(wrapper) {
		super(wrapper)
		this.handle = null
	}

	downloading() {
		let _this = this
		let wrapper = this.wrapper
		wrapper.stateName = 'running'
		removeOutOfReadyQueue(this)
		addToRunningQueue(this)
		wrapper.manager.updateStore()
    wrapper.recordInfor(wrapper.name + ' 开始创建...')

    let options = {
			method: 'GET',
			url: server + '/files/' + wrapper.target,
			headers: {
				Authorization: user.type + ' ' + user.token,
				Range: 'bytes=' + this.wrapper.seek + '-'
			}
		}
		let streamOptions = {
			flags: this.wrapper.seek==0?'w':'r+', 
			start: this.wrapper.seek,
			defaultEncoding: 'utf8',
		  fd: null,
		  mode: 0o666,
		  autoClose: true
		}
		let tmpDownloadPath = path.join(tmpTransPath, wrapper.manager.uuid + wrapper.timeStamp + wrapper.name)
		let stream = fs.createWriteStream(tmpDownloadPath, streamOptions)
		stream.on('error', (err) => {
			console.log('stream error trigger')
			console.log(err)
		})

		stream.on('pipe', (src) => {
			// console.log('stream pipe trigger')
			// console.log(src)
		})

		stream.on('drain', () => {
			// console.log('stream drain trigger')
			wrapper.manager.updateStore()
			_this.wrapper.seek = stream.bytesWritten
		})

		stream.on('finish', () => {
			// console.log('stream finish trigger')
			this.rename(tmpDownloadPath)
		})

		stream.on('close', () => {
			// console.log('stream close trigger')
		})

		this.handle = request(options)
			.on('error',(err)=>{
				console.log('readstream error...')
				console.log(err)
			})
			.on('complete',(err) => {
				// console.log('readstream complete...')
				// console.log(err)
				// console.log(data)
			})
			.on('data',(data) =>{
				this.wrapper.manager.completeSize += data.length
				// console.log(data.length)
			})
			.on('close',() => {
				// console.log('readstream close...')
			})
			.on('end',() => {
				// console.log('readstream end...')
			})
		
		_this.handle.pipe(stream)
	}

	rename(oldPath) {
		let _this = this
		let wrapper = this.wrapper
		fs.rename(oldPath, path.join(wrapper.downloadPath, wrapper.name), (err,data) => {
			removeOutOfRunningQueue(_this)
			_this.wrapper.downloadFinish()
		})
	}

	pause() {		
		if (this.wrapper.stateName !== 'running') return
		this.wrapper.stateName = 'pause'
		this.handle.pause()
		this.wrapper.recordInfor(this.wrapper.name + '暂停了')
	}

	resume() {
		if (this.wrapper.stateName !== 'pause') return
		this.wrapper.stateName = 'running'
		this.handle.resume()
		this.wrapper.recordInfor(this.wrapper.name + '继续下载')
	}
}

const scheduleVisit = () => {
	while (visitlessQueue.length < visitConcurrency && visitlessQueue.length)
		visitlessQueue[0].visit()
}

const scheduleHttpRequest = () => {
  while (runningQueue.length < httpRequestConcurrency && readyQueue.length)
    readyQueue[0].downloading()
}

//visitless
const addToVisitlessQueue = (task) => {
	visitlessQueue.push(task)
	scheduleVisit()
}

const removeOutOfVisitlessQueue = (task) => {
	visitlessQueue.splice(visitlessQueue.indexOf(task),1)
}

//visiting
const addToVisitingQueue = (task) => {
	visitingQueue.push(this)
}

const removeOutOfVisitingQueue = (task) => {
	visitingQueue.splice(visitingQueue.indexOf(task),1)
	scheduleVisit()
}

// ready
const addToReadyQueue = (task) => {
  readyQueue.push(task)
  scheduleHttpRequest()
}

const removeOutOfReadyQueue = (task) => {
  readyQueue.splice(readyQueue.indexOf(task), 1)
}

// running
const addToRunningQueue = (task) => {
  runningQueue.push(task)
}

const removeOutOfRunningQueue = (task) => {
  runningQueue.splice(runningQueue.indexOf(task), 1)
  scheduleHttpRequest()
}

ipcMain.on('PAUSE_DOWNLOADING', (e, uuid) => {
	if (!uuid) return
	let task = userTasks.find(item => item.uuid === uuid)
	task.pauseTask()
})

ipcMain.on('RESUME_DOWNLOADING', (e, uuid) => {
	if (!uuid) return
	let task = userTasks.find(item => item.uuid === uuid)
	task.resumeTask()
})

export default createTask

export { sendMsg }