'use strict';


module.exports = (conn) => {
  const locals = {
    from: new Date(conn.req.query.param),
  };
};
