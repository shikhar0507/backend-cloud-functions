const now = (conn) => {
  if (conn.req.method === 'GET') {
    sendResponse(conn, 200, (new Date()).toUTCString(), conn.headers);
  } else {
    sendResponse(conn, 405, 'METHOD NOT ALLOWED', conn.headers);
  }
};

const sendResponse = (conn, statusCode, statusMessage, headers) => {
  conn.headers['Content-Type'] = 'application/json';
  conn.res.writeHead(statusCode, headers);
  conn.res.end(JSON.stringify({
    message: statusMessage,
  }));
};

const handleError = (conn, error) => {
  console.log(error);
  sendResponse(conn, 500, 'INTERNAL SERVER ERROR', conn.headers);
};

module.exports = {
  sendResponse,
  handleError,
  now,
};
