import React from 'react'

import FlatButton from '../common/FlatButton'

import InitWiard from './InitWiard'

const GuideFooter = (props) => {
	return (
		<div style={{width: '100%', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FAFAFA'}}>
			<div style={{marginLeft: 24}}>该设备已安装WISNUC OS，但尚未初始化。</div>
			<FlatButton style={{marginRight: 16}} label={'初始化'} onTouchTap={props.onOpen}/>
		</div>
	)
}

const GuideBox = (props) => {

    return (
			<div style={{width: '100%', height: '100%'}}>
				<div >
					{
						props.toggle ?
							<GuideFooter onOpen={props.onOpen}/> :
							<InitWiard storage={props.storage} />
					}
				</div>
			</div>
    )
}

export default GuideBox
