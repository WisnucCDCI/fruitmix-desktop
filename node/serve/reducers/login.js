import path from 'path'
import DataStore from 'nedb'
//define default state
const defaultState = {
  state: 'READY',
  obj: {},
  device: [],
  selectIndex : 0
}

const listeners = []

export const addListener = listener => listeners.push(listener)

const loginState = (state = defaultState, action) => {
  // logged in listener
  if (action.type === 'LOGGEDIN') {
   	db.uploading = new DataStore({filename: path.join('dbCache', action.obj.uuid + 'uploading.db'), autoload: true})
		db.finish = new DataStore({filename: path.join('dbCache', action.obj.uuid + 'finish.db'), autoload: true})
    setImmediate(() => listeners.forEach(l => l(action.type)))
   }
	switch (action.type) {
		case 'LOGIN':
			return Object.assign({}, state, {state: 'BUSY'})
		case 'LOGGEDIN':
			return Object.assign({}, state, {obj:action.obj, state:'LOGGEDIN'})
		case 'REJECTED':
			return Object.assign({}, state, {state: 'REJECTED'})
		case 'LOGIN_OFF':
			return Object.assign({}, state, {state: 'READY', obj: {}})
		case 'LOGINOUT':
			return Object.assign({}, state, {state: 'READY'})

    case 'CONFIG_SET_IP': {
      let selectIndex = state.device.findIndex(dev => dev.address === action.data)
      return (selectIndex !== -1) ? Object.assign({}, state, { selectIndex }) : state
    }

		case 'SET_DEVICE':
			return Object.assign({},state,{device: action.device});
		default:
			return state
	}
}

export default loginState

