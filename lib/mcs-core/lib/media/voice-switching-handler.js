'use strict';

const config = require('config');
const Logger = require('../utils/logger.js');
const C = require('../constants/constants.js');
const GLOBAL_EVENT_EMITTER = require('../utils/emitter.js');
const BaseStrategyHandler = require('./base-strategy-handler.js');

const LOG_PREFIX = "[mcs-voice-switching-handler]";

class VoiceSwitchingHandler extends BaseStrategyHandler {
  constructor (room, name) {
    super(room, name);
    this.conferenceFloor;
    this.contentFloor;
    this.previousConferenceFloors = [];
    this.previousContentFloors = [];

    this._handleConferenceFloorChanged = this._handleConferenceFloorChanged.bind(this);
    this._handleContentFloorChanged = this._handleContentFloorChanged.bind(this);
    this.runStrategy = this.runStrategy.bind(this);
  }

  start () {
    GLOBAL_EVENT_EMITTER.on(C.EVENT.CONFERENCE_FLOOR_CHANGED, this._handleConferenceFloorChanged);
    this.registerEvent(C.EVENT.CONFERENCE_FLOOR_CHANGED, this._handleConferenceFloorChanged)
    GLOBAL_EVENT_EMITTER.on(C.EVENT.CONTENT_FLOOR_CHANGED, this._handleContentFloorChanged);
    this.registerEvent(C.EVENT.CONTENT_FLOOR_CHANGED, this._handleContentFloorChanged)
    GLOBAL_EVENT_EMITTER.on(C.EVENT.MEDIA_CONNECTED, this.runStrategy);
    this.registerEvent(C.EVENT.MEDIA_CONNECTED, this.runStrategy);
    GLOBAL_EVENT_EMITTER.on(C.EVENT.MEDIA_DISCONNECTED, this.runStrategy);
    this.registerEvent(C.EVENT.MEDIA_DISCONNECTED, this.runStrategy);
  }

  stop () {
    this.room = null;
    this.conferenceFloor = null;
    this.contentFloor = null;
    this.previousConferenceFloors = null;
    this.previousContentFloors = null;
    this._registeredEvents.forEach(({ event, callback }) => {
      GLOBAL_EVENT_EMITTER.removeListener(event, callback);
    });

    this._registeredEvents = [];
  }

  runStrategy () {
    return this._floorJanitor();
  }

  _assembleFloorList (floor, previousFloors, fallbackPreviousFloors) {
    // Create a unified floor list which guarantees every member is unique and
    // order is preserved. Floor is the current floor, previousFloors are the
    // past floors (if any) and the fallbackPreviousFloors are all media sessions
    // not in the previous two that are in this room and are capable of sending media
    return [...new Set([].concat([...floor, ...previousFloors, ...fallbackPreviousFloors]))];
  }

  _filterMediasByMediaType (medias) {
    return medias.filter(({ type }) => type === C.MEDIA_TYPE.WEBRTC || type === C.MEDIA_TYPE.RTP);
  }

  async _handleConferenceFloorChanged (event) {
    const { roomId, floor, previousFloor = [] } = event;

    // Not supposed to be handled by this handler, skip
    if (roomId !== this.room.id) {
      return;
    }

    Logger.info(LOG_PREFIX, "Conference floor for room", roomId, "changed");

    // Reassign conference floors and re-run the strategy
    this.conferenceFloor = this.room.getMediaSession(floor.mediaSessionId);
    const previousFloorSessions = previousFloor
      .map(({ mediaSessionId }) => this.room.getMediaSession(mediaSessionId));

    this.previousConferenceFloors = this._filterMediasByMediaType(previousFloorSessions);
    // TODO remove this log once this handler is stable
    Logger.info(LOG_PREFIX, "Previous floors for", this.room.id, this.previousConferenceFloors.map(m => [m.name, m.userId, m.id]));

    try {
      await this.runStrategy();
    } catch (e) {
      // TODO decide what the frick to do with this error
      Logger.error(e);
    }
  }

  async _handleContentFloorChanged (event) {
    const { roomId, floor, previousFloor } = event;

    // Not supposed to be handled by this handler, skip
    if (roomId !== this.room.id) {
      return;
    }

    Logger.info(LOG_PREFIX, "Content floor for room", roomId, "changed");

    // Reassign content floors and re-run the strategy
    this.contentFloor = floor;
    this.previousContentFloors = previousFloor || [];

    try {
      await this.runStrategy();
    } catch (e) {
      // TODO decide what the frick to do with this error
      Logger.error(e);
    }
  }

  async _floorJanitor () {
    const hasContent = !!this.contentFloor;

    // Check if content is in place. If so, avoid running the floor connection procedure.
    // Subscribe any orphaned endpoints to the content stream
    // The voice floors are accounted for and preserver in the meantime
    if (hasContent) {
      return this._reviewMeetingFloors(this.contentFloor, this.previousConferenceFloors);
    }


    // Get the room's media sources and filter them by type. Accepted types are
    // WebRTC and RTP for now.
    const fallbackPreviousFloors = this._filterMediasByMediaType(
      this.room.getSourceMediaSessionsOfType('video')
    );

    // Wrap the floor into a fake array to assemble the single floor list
    const floor = this.conferenceFloor? [this.conferenceFloor] : [];

    // Single floor list used for connecting everything
    const floorList = this._assembleFloorList(
      floor,
      this.previousConferenceFloors,
      fallbackPreviousFloors
    );

    if (floorList.length > 0) {
      this._reviewMeetingFloors(floorList);
    }
  }

  _reviewMeetingFloors (floorList) {
    // We need to work only over media sessions with this handler, so ignore
    // users, rooms and medias as those can be inferred
    const mediaSessions = this.members.filter(m => m.memberType === C.MEMBERS.MEDIA_SESSION);

    // Group sink medias by user as to not duplicate connections among a same user
    // that negotiates multiple media sessions
    const userSinkMedias = mediaSessions.reduce((acc, msInfo) => {
      const { userId, mediaSessionId } = msInfo;
      if (!acc[userId]) {
        acc[userId] = [];
      }

      const mediaSession = this.room.getMediaSession(mediaSessionId);

      if (mediaSession) {
        acc[userId].push(...mediaSession.medias);
      }
      return acc;
    }, {});

    // Deep copy the floor medias array. We take every media session, spread them
    // into media units and re-filter them to get only sources
    const floorMedias = [].concat(
      ...floorList
      .map(({ medias }) => medias)
    ).filter(({ mediaTypes }) => mediaTypes.video && mediaTypes.video !== 'recvonly');


    // TODO the array map in the log is for debugging purporses, remove it once
    // this is stable
    Logger.info(LOG_PREFIX, "Number of floor medias for", this.room.id, floorMedias.map(m => [m.name, m.userId, m.id]));

    Object.keys(userSinkMedias).forEach(userId => {
      const sinkMedias = userSinkMedias[userId];
      this._connectMediaFloors(sinkMedias, floorMedias);
    });
  }

  _connectMediaFloors (sinkMedias, floorMedias) {
    if (sinkMedias) {
      // Get only the video medias from the session that are capable of receiving
      let availableSinkMedias = sinkMedias.filter(sm => {
        const { mediaTypes } = sm;
        if (mediaTypes.video && (mediaTypes.video === 'sendrecv' ||
          mediaTypes.video === 'recvonly')) {
          return true;
        }
        return false;
      });

      const numberOfSinkMedias = availableSinkMedias.length;
      const floorsInRange = floorMedias.splice(0, numberOfSinkMedias);

      const mishMashConnect = (floors, sinks) => {
        floors.every(fm => {
          const validSink = sinks.find(sm => {
            const shouldConnect = this._shouldConnect(sm, fm)
            return shouldConnect;
          });

          if (validSink) {
            Logger.info(LOG_PREFIX, "Connecting", fm.id, "to", validSink.id);
            fm.connect(validSink, C.CONNECTION_TYPE.VIDEO);
            sinks = sinks.filter(sm => sm.id !== validSink.id);
          } else if (sinks.length <= 1) {
            // This case covers endpoints that have only on receiving media left.
            // If shouldConnect failed to match the sink to the floor,
            // it means it's already connected to the floor or one of its media
            // units. So we skip (since we're using Array.every, false skips)
            return false;
          }

          // Keep running over the floors. This is a multi-recv session, so keep
          // going
          return true;
        });

        return sinks;
      }

      availableSinkMedias = mishMashConnect(floorsInRange, availableSinkMedias);

      // There are still unconnected floors, search for the remaining things
      if (availableSinkMedias.length > 0 && floorMedias.length > 0) {
        mishMashConnect(floorMedias, availableSinkMedias);
      }
    }
  }

  _sinkUserHasSubscribedToMedia (sink, floor) {
    const sinkUser = this.room.getUser(sink.userId);
    // Expand the sink user media sessions into media units for comparison
    const sinkUserMedias = [].concat(... sinkUser.getUserMedias().map(({ medias }) => medias));
    return sinkUserMedias.some(m => m.subscribedTo === floor.id);
  }

  _shouldConnect (sink, floor) {
    // Check if the floor media should be connected to the sink. This is asserted
    // by doing a series of checks in this short-circuit'ed order:
    // 1 - Check if the sink media unit isn't already subscribed to the floor media unit
    // 2 - Check if the sink media unit isn't the floor media unit
    // 3 - check if the sink media session isn't the same as the floor media session
    // 4 - Check if the sink media user hasn't got another separated media unit already
    // subscribed to the floor media unit
    return sink.subscribedTo !== floor.id &&
      sink.id !== floor.id &&
      sink.mediaSessionId !== floor.mediaSessionId &&
      !this._sinkUserHasSubscribedToMedia(sink, floor);
  }
}


module.exports = VoiceSwitchingHandler;
