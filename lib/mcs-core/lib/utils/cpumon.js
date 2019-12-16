const { cpu: MONITOR } = require('node-os-utils');

let MON_INTERVAL = Infinity;
let MON_LOOP = null;
let THRESHOLD_CALLBACK_MAP = {}; // { cpuThreshold: number, callback: function }
let CURRENT_THRESHOLD = 0;

const injectThresholds = (thresholdCallbackMap) => {
  Object.keys(thresholdCallbackMap).forEach(t => {
    const callback = thresholdCallbackMap[t];

    if (THRESHOLD_CALLBACK_MAP[t] == null) {
      THRESHOLD_CALLBACK_MAP[t] = [];
    }

    if (Array.isArray(callback)) {
      THRESHOLD_CALLBACK_MAP[t] = THRESHOLD_CALLBACK_MAP[t].concat(callback);
    } else {
      THRESHOLD_CALLBACK_MAP[t].push(callback);
    }
  });
};

const getNewThreshold = (thresholds, currentUsage, currentThreshold) => {
  return thresholds.find((threshold) => {
    return threshold !== 0 && currentUsage <= threshold;
  });
}

const start = (interval, usageCallback) => {
  USAGE_CALLBACK = usageCallback;
  MON_INTERVAL = interval;

  if (!!MON_LOOP) {
    return;
  }

  MON_LOOP = setInterval(() => {
    MONITOR.usage(MON_INTERVAL)
      .then(usage => {
        if (usageCallback) {
          usageCallback(usage);
        }

        const newThreshold = getNewThreshold(Object.keys(THRESHOLD_CALLBACK_MAP), usage, CURRENT_THRESHOLD);

        if (newThreshold !== CURRENT_THRESHOLD) {
          CURRENT_THRESHOLD = newThreshold;
          const callbacks = THRESHOLD_CALLBACK_MAP[newThreshold] || [];
          callbacks.forEach(callback => {
            if (typeof callback === 'function') {
              callback(newThreshold);
            }
          });
        };
      })
      .catch(error => {
        console.error("[cpumon]", `Failed to fetch CPU stats due to ${error.message}`);
      });

  }, MON_INTERVAL);
};

const stop = () => {
  if (MON_LOOP) {
    clearInterval(MON_LOOP);
    MON_LOOP = null;
    THRESHOLD_CALLBACK_MAP = null
    CURRENT_THRESHOLD = 0;
  }
};

module.exports = { start, stop, injectThresholds };
