/*
 * Lucas Fialho Zawacki
 * Paulo Renato Lanzarin
 * (C) Copyright 2017 Bigbluebutton
 *
 */

'use strict';

const config = require('config');
const MULTIPROCESS = config.get('multiprocess');
const http = require('http');
const EventEmitter = require('events');
const BigBlueButtonGW = require('../bbb/pubsub/bbb-gw');
const C = require('../bbb/messages/Constants');
const Logger = require('../utils/Logger');

// Global variables
module.exports = class ConnectionManager {

  constructor () {
    this._screenshareSessions = {};

    this._setupBBB();

    this._emitter = this._setupEventEmitter();
    this._adapters = [];
  }

  setHttpServer(httpServer) {
    this.httpServer = httpServer;
  }

  listen(callback) {
    this.httpServer.listen(callback);
  }

  addAdapter(adapter) {
    adapter.setEventEmitter(this._emitter);
    this._adapters.push(adapter);
  }

  _setupEventEmitter() {
    const emitter = new EventEmitter();

    // advanced highlandism
    if (!MULTIPROCESS) {
      GLOBAL.CM_ROUTER = emitter;
    }

    emitter.on(C.WEBSOCKET_MESSAGE, (data) => {
      switch (data.type) {
        case "screenshare":
          this.innardDispatcher(data, C.TO_SCREENSHARE, emitter);
          //self._bbbGW.publish(JSON.stringify(data), C.TO_SCREENSHARE);
          break;

        case "video":
          this.innardDispatcher(data, C.TO_VIDEO, emitter);
          //self._bbbGW.publish(JSON.stringify(data), C.TO_VIDEO);
          break;

        case "audio":
          this.innardDispatcher(data, C.TO_AUDIO, emitter);
          //self._bbbGW.publish(JSON.stringify(data), C.TO_AUDIO);
          break;

        case "default":
          // TODO handle API error message;
      }
    });

    return emitter;
  }

  innardDispatcher (data, channel, emitter) {
    if (MULTIPROCESS) {
      const nicelyParsedMessage = JSON.stringify(data);
      this._bbbGW.publish(nicelyParsedMessage, channel);
      return;
    }
    emitter.emit(channel, data);
  }

  async _setupBBB() {
    this._bbbGW = new BigBlueButtonGW();

    try {
      const screenshare = await this._bbbGW.addSubscribeChannel(C.FROM_SCREENSHARE);
      const video = await this._bbbGW.addSubscribeChannel(C.FROM_VIDEO);
      const audio = await this._bbbGW.addSubscribeChannel(C.FROM_AUDIO);

      const emitFunk = (data) => {
        this._emitter.emit('response', data);
      };

      screenshare.on(C.REDIS_MESSAGE, emitFunk);
      video.on(C.REDIS_MESSAGE, emitFunk);
      audio.on(C.REDIS_MESSAGE, emitFunk);
      this._emitter.on(C.REDIS_MESSAGE, emitFunk);

      Logger.info('[ConnectionManager] Successfully subscribed to processes redis channels');
    }
    catch (err) {
      Logger.info('[ConnectionManager] ' + err);
      this._stopAll;
    }
  }

  _stopSession(sessionId) {
  }

  _stopAll() {
  }
}
