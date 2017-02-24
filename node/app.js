import path from 'path'
import fs from'fs'
import os from 'os'

import Debug from 'debug'
import { app } from 'electron'

import store from './serve/store/store'
import configObserver from './lib/config'
import adapter from './lib/adapter'

import { registerCommandHandler } from './lib/command'
import migration from './lib/migration'
import systemModule from './lib/system'

//init api
import loginApi from './lib/login'
import fileApi from './lib/file'
import mediaApi from './lib/media'
// import upload from './lib/upload'
import newUpload from './lib/newUpload'
import download from './lib/download'
//init window
import { initMainWindow, getMainWindow } from './lib/window'
import { initTestWindow } from './lib/testHook'

import mdns from './lib/mdns'
import misc from './lib/misc'

global.entryFileDir = __dirname

const debug = Debug('main')

var mocha = false

// initialize mdns
mdns().on('stationUpdate', device => {
  store.dispatch({
    type: 'SET_DEVICE',
    device
  })
})

// read config file
try {
  let raw = fs.readFileSync(path.join(tmpPath, 'server'))
  let config = JSON.parse(raw) 
  store.dispatch({
    type: 'CONFIG_INIT',
    data: config
  }) 
}
catch (e) { // e.code === 'ENOENT' && e.syscall === 'read'
  console.log(e)
}

store.subscribe(configObserver)
store.subscribe(adapter)

//app ready and open window ------------------------------------
app.on('ready', function() {
  initMainWindow()
  if (os.platform() == 'darwin') {
    console.log('system is osx')
    let data = app.getPath('downloads')
    console.log('download path is : ' + data)
    store.dispatch({type:'CONFIG_SET_DOWNLOAD_PATH',data})
  }
  
  if (mocha) initTestWindow()

  setTimeout(() => {
    if (true) {
      store.dispatch({
        type: 'CONFIG_SET_IP',
        data: '192.168.5.197'
      })
      dispatch({
        type: 'LOGGEDIN',
        obj: {
          "type": "JWT",
          "uuid": "384ae38b-d840-420b-bc64-763654522b70",
          "username": "liu",
          "avatar": null,
          "email": null,
          "isAdmin": true,
          "isFirstUser": true,
          "home": "3ecb3b93-b3c1-4415-ae02-3af9b8c5fa19",
          "library": "ef8bae54-b5f6-41a2-bae0-cb164f7e205b",
          "unixUID": 2000,
          "token":'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiMzg0YWUzOGItZDg0MC00MjBiLWJjNjQtNzYzNjU0NTIyYjcwIn0.H4szymqLtQ1dNGYNDrCWQ0q-jGvLK094E0-I8LAxASg'
        }
      })
    }
  },1000)
})

app.on('window-all-closed', () => app.quit())