/**
 *  @classdesc
 *  Utils class for mcs-core
 *  @constructor
 *
 */

const C = require('../constants/constants');
const Logger = require('./logger');

exports.isError = (error) => {
  return error && error.stack && error.message && typeof error.stack === 'string'
    && typeof error.message === 'string';
}

exports.handleError = (logPrefix, error) => {
  let { message, code, stack, data, details } = error;

  if (code && code >= C.ERROR.MIN_CODE && code <= C.ERROR.MAX_CODE) {
    return error;
  }

  if (code == null) {
    ({ code, message } = C.ERROR.MEDIA_GENERIC_ERROR);
  }
  else {
    ({ code, message } = error);
  }

  if (!this.isError(error)) {
    error = new Error(message);
  }

  error.code = code;
  error.message = message;
  error.stack = stack

  if (details) {
    error.details = details;
  }
  else {
    error.details = message;
  }

  if (stack && !error.stackWasLogged)  {
    Logger.error(logPrefix, `Stack trace for error ${error.code} | ${error.message} ->`,
      { errorStack: error.stack.toString() });
    error.stackWasLogged = true;
  }

  return error;
}

exports.convertRange = (originalRange, newRange, value) => {
  const newValue  = Math.round(((value - originalRange.floor) / (originalRange.ceiling - originalRange.floor)) * (newRange.ceiling - newRange.floor) + newRange.floor);

  return newValue;
}

/*
 * hrTime
 * Gets monotonic system time in milliseconds
 */
exports.hrTime = function () {
  let t = process.hrtime();

  return t[0]*1000 + parseInt(t[1]/1000000);
}

const bitrateThresholdDictionary = () => {
  return {
    audio: [ { threshold: 0, bitrateMultiplier: 1 } ],
    main: [ { threshold: 0, bitrateMultiplier: 1 } ],
    content: [ { threshold: 0, bitrateMultiplier: 1 } ],
  }
}

exports.bitrateThresholdDictionary = bitrateThresholdDictionary;

exports.sortBitrateThresholds = (thresholds = bitrateThresholdDictionary()) => {
  const newThresholds = { ...thresholds }
  Object.keys(newThresholds).forEach(t => {
    newThresholds[t] = newThresholds[t].sort((td1, td2) => {
      return td1.threshold - td2.threshold;
    });
  });
  return newThresholds;
}

exports.getNewBitrateThreshold = (thresholds, nofMedias, currentThreshold = bitrateThresholdDictionary()) => {
  // Unlimited threshold or current threshold or maximum threshold
  console.log("AYOW SILVER", thresholds, nofMedias, currentThreshold);
  if (currentThreshold.threshold === 0
    || nofMedias <= currentThreshold.threshold
    || currentThreshold.threshold === thresholds[thresholds.length - 1].threshold) {
    return currentThreshold;
  }

  return thresholds.find(({ threshold, bitrate }) => {
    return threshold !== 0 && nofMedias <= threshold;
  });
}

exports.getMediaSessionsOfType = (mediaSessions, mediaType) => {
    return mediaSessions.filter(({ medias }) => {
      return medias.some(({ mediaTypes }) => mediaTypes[mediaType]);
    });
  }
