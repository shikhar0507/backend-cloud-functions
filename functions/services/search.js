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
    q,
  } = conn.req.query;

  if (!isNonEmptyString(q)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Query param 'q' is missing`
    );
  }

  const docs = await rootCollections
    .offices
    .where('searchables', 'array-contains', q.toLowerCase())
    .get();

  return sendJSON(conn, docs.docs.map(doc => {
    return {
      firstContact: doc.get('attachment.First Contact.value'),
      secondContact: doc.get('attachment.Second Contact.value'),
      name: doc.get('attachment.Name.value'),
      status: doc.get('status'),
    };
  }));
};

module.exports = async conn => {
  try {
    return searchOffice(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
