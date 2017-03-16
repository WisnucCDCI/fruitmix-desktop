/**
 * @component uploadFrame
 * @description upload
 * @time 2017-2-28
 * @author liuhua
**/
import React, { Component } from 'react'
import { ipcRenderer } from 'electron'
import Row from './newUploadRow'
import FileSvg from 'material-ui/svg-icons/editor/insert-drive-file'
import FolderSvg from 'material-ui/svg-icons/file/folder'
import DeleteSvg from 'material-ui/svg-icons/action/delete'
import { command } from '../../lib/command'

const svgStyle = {color: '#000', opacity: 0.54}
class Upload extends Component {
	constructor() {
		super()
	}

	render() {
		let transmission = window.store.getState().transmission
		let userTasks = transmission.downloadingTasks
		let finishTasks = transmission.downloadedTasks
		return (
			<div id='trs-wrap'>
				<div className='trs-title'>
					<span>下载中</span>
					<span>({userTasks.length})</span>
				</div>
				<div className='trs-hr'></div>
				<div className='trs-list-wrapper'>
					{userTasks.map((task) => {
						return <Row key={task.uuid} task={task} pause={this.pause} resume={this.resume}/>
					})}
				</div>
				<div className='trs-title'>
					<span>已完成</span>
					<span>({finishTasks.length})</span>
					<span onClick={this.cleanRecord.bind(this)}>
						<DeleteSvg style={svgStyle}></DeleteSvg>
						<span>清除记录</span>
					</span>
				</div>
				<div className='trs-hr'></div>
				<div className='trs-list-wrapper'>
					{finishTasks.map((task) => {
						return <UploadFinishRow key={task.uuid} task={task}/>
					})}
				</div>
			</div>
		)
	}

	pause(uuid) {
		ipcRenderer.send('PAUSE_DOWNLOADING', uuid)
	}

	resume(uuid) {
		ipcRenderer.send('RESUME_DOWNLOADING', uuid)
	}

	cleanRecord() {
		command('', 'CLEAN_DOWNLOAD_RECORD',{})
	}
}

class UploadFinishRow extends Component {
	constructor() {
		super()
		this.createDate = new Date()
	}

	render() {
		let task = this.props.task
		return (
			<div className='trs-row'>
				<div className='trs-row-name'>
					<span>
						{
							task.type=='folder'?<FolderSvg style={svgStyle}/>:
							<FileSvg style={svgStyle}/>
						}
					</span>
					<span>{task.name}</span>
				</div>
				<div className='trs-row-finishDate'>
					<span>{this.getFinishDate(task.finishDate)}</span>
				</div>
			</div>
			)
	}

	getFinishDate(date) {
		let d = this.createDate
		let year = d.getFullYear()
		let mouth = d.getMonth() + 1
		let day = d.getDate()
		let hour = d.getHours()
		let minute = d.getMinutes()
		if (year === date[0] && mouth === date[1] && day === date[2]) return date[3] + ':' + date[4]
		if (year === date[0] && mouth === date[1] && day === date[2] + 1) return '昨天'
		return date[0] + '-' + date[1] + '-' + date[2]
	}
}

export default Upload
