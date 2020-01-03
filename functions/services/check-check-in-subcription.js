const {rootCollections} = require('../admin/admin');
const {code} = require('../admin/responses');
const {subcollectionNames} = require('../admin/constants');
const {sendJSON, sendResponse, handleError} = require('../admin/utils');

const hasCheckInSubscription = async conn => {
  if (conn.req.method !== 'GET') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'GET'`,
    );
  }

  const [checkInSubscriptionDoc] = (
    await rootCollections.profiles
      .doc(conn.requester.phoneNumber)
      .collection(subcollectionNames.SUBSCRIPTIONS)
      .where('template', '==', 'check-in')
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get()
  ).docs;

  return sendJSON(conn, {
    hasCheckInSubscription: !!checkInSubscriptionDoc,
  });
};

module.exports = async conn => {
  try {
    return hasCheckInSubscription(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
