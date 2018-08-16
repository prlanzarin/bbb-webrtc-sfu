/**
 * @classdesc
 * Model class for external devices
 */

'use strict'

const C = require('../constants/Constants');
const SdpWrapper = require('../utils/SdpWrapper');
const rid = require('readable-id');
const MediaSession = require('./MediaSession');
const config = require('config');
const Logger = require('../../../utils/Logger');
const Balancer = require('../media/balancer');

module.exports = class SdpSession extends MediaSession {
  constructor(
    emitter,
    offer = null,
    room,
    type = 'WebRtcEndpoint',
    options
  ) {
    super(emitter, room, type, options);
    Logger.info("[mcs-sdp-session] New session with options", options);
    // {SdpWrapper} SdpWrapper
    this._offer;
    this._answer;

    if (offer) {
      this.setOffer(offer);
    }
  }

  setOffer (offer) {
    if (offer) {
      this._offer = new SdpWrapper(offer, this._type);
    }
  }

  setAnswer (answer) {
    if (answer) {
      this._answer = new SdpWrapper(answer, this._type);
    }
  }

  process () {
    return new Promise(async (resolve, reject) => {
      try {
        const answer = await this._MediaServer.processOffer(this._mediaElement,
          this._offer.plainSdp,
          { name: this._name }
        );

        this.setAnswer(answer);

        // Checks if the media server was able to find a compatible media line
        if (answer && !this._hasAvailableCodec()) {
          return reject(this._handleError(C.ERROR.MEDIA_NO_AVAILABLE_CODEC));
        }

        if (this._type !== 'WebRtcEndpoint') {
          this._offer.replaceServerIpv4(this.host.ip);
          return resolve(answer);
        }

        await this._MediaServer.gatherCandidates(this._mediaElement);

        this._updateHostLoad();

        resolve(answer);
      }
      catch (err) {
        return reject(this._handleError(err));
      }
    });
  }

  addIceCandidate (candidate) {
    return new Promise(async (resolve, reject) => {
      try {
        await this._MediaServer.addIceCandidate(this._mediaElement, candidate);
        resolve();
      }
      catch (err) {
        return reject(this._handleError(err));
      }
    });
  }

    _hasAvailableCodec () {
    return (this._offer.hasAvailableVideoCodec() === this._answer.hasAvailableVideoCodec()) &&
      (this._offer.hasAvailableAudioCodec() === this._answer.hasAvailableAudioCodec());
  }


  _updateHostLoad () {
    if (this._offer.hasAvailableVideoCodec()) {
      Balancer.incrementHostStreams(this.host.id, 'video');
      this.hasVideo = true;
    }

    if (this._offer.hasAvailableAudioCodec()) {
      Balancer.incrementHostStreams(this.host.id, 'audio');
      this.hasAudio = true;
    }
  }

}
