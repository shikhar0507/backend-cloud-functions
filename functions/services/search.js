const {
  rootCollections,
} = require('../admin/admin');
const {
  isNonEmptyString,
  sendResponse,
  sendJSON,
  handleError,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');

const searchOffice = async conn => {
  if (conn.req.method !== 'GET') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `Method '${conn.req.method}' is not allowed. Use 'GET'`
    );
  }

  const {
    q: placeId,
  } = conn.req.query;

  if (!isNonEmptyString(placeId)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Query param 'q' is missing`
    );
  }

  const branches = await rootCollections
    .activities
    .where('placeId', '==', placeId)
    .where('status', '==', 'CONFIRMED')
    .get();

  const officeNames = new Set();
  const officePromises = [];

  branches.forEach(branch => {
    const {
      office
    } = branch.data();

    if (officeNames.has(office)) {
      return;
    }

    officePromises.push(
      rootCollections
      .offices
      .where('office', '==', office)
      .select('status', 'office', 'attachment.Registered Office Address.value')
      .limit(1)
      .get()
    );

    officeNames.add(office);
  });

  const officeSnaps = await Promise.all(officePromises);

  const results = [];
  officeSnaps.forEach(snap => {
    const [doc] = snap.docs;

    if (doc.get('status') === 'CANCELLED') {
      return;
    }

    results.push({
      status: doc.get('status'),
      name: doc.get('office'),
      registeredOfficeAddress: doc.get('attachment.Registered Office Address.value')
    });
  });

  return sendJSON(conn, results);
};

module.exports = async conn => {
  try {
    return searchOffice(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
