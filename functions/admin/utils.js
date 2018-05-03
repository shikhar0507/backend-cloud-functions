const now = (conn) => {
  if (conn.req.method === 'GET') {
    sendResponse(conn, 200, (new Date()).toUTCString());
  } else {
    sendResponse(conn, 405, 'METHOD NOT ALLOWED');
  }
};

const sendResponse = (conn, statusCode, message, error) => {
  conn.headers['Content-Type'] = 'application/json';
  conn.res.writeHead(statusCode, conn.headers);

  if (error) {
    conn.res.end(JSON.stringify({
      code: statusCode,
      error: message,
    }));
    return;
  }

  conn.res.end(JSON.stringify({
    code: statusCode,
    message,
  }));
};

const handleError = (conn, error) => {
  console.log(error);
  sendResponse(conn, 500, 'INTERNAL SERVER ERROR', error);
};


module.exports = {
  sendResponse,
  handleError,
  now,
};
