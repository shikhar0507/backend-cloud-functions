const winston = require('winston');
const { LoggingWinston } = require('@google-cloud/logging-winston');

// Create a Winston logger that streams to Stackdriver Logging
// Logs will be written to: "projects/YOUR_PROJECT_ID/logs/winston_log"
const logger = winston.createLogger({
  format: winston.format.json(),
  level: 'info',
  transports: [
    new winston.transports.Console(),
    // Add Stackdriver Logging
    new LoggingWinston(),
  ],
});

const objectHelper = value => {
  if (typeof value == 'string') {
    return value.replace(/\//g, '\\/');
  }

  return value;
};

const beautifier = value => JSON.stringify(value, objectHelper);

module.exports = { logger, beautifier };
