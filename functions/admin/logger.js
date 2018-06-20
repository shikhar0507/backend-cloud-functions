const {
  sendResponse,
  handleError,
} = require('./utils');

const {
  rootCollections,
} = require('./admin');

const {
  instant,
} = rootCollections;

/**
 * Creates a document in the `/Instant` collection with the
 * timestamp as its `doc-id`.
 *
 * @param {Object} conn Express's Request and Response Object.
 * @param {Object} response Contains Response code and message.
 * @returns {void}
 */
const createInstantLog = (conn, response) => {
  const {
    STATUS_CODES,
  } = require('http');

  /** Some requests don't send any message after completion.
   * Case in point: Update requests. In these cases, the
   * response will remain empty.
   */
  if (!response.message) response.message = '';
  let successful = true;

  if (response.code > 299) {
    successful = false;
  }

  instant
    .doc()
    .set({
      successful,
      requestBody: JSON.stringify(conn.req.body),
      requester: JSON.stringify(conn.requester),
      responseCode: response.code,
      /** @see https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html */
      responseCodeValue: STATUS_CODES[`${response.code}`],
      responseMessage: response.message,
      resourcesAccessed: response.resourcesAccessed || null,
      url: conn.req.url,
      timestamp: new Date(),
    })
    .then(() => sendResponse(conn, response.code, response.message))
    .catch((error) => handleError(conn, error));
};

module.exports = {
  createInstantLog,
};
