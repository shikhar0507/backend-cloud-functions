'use strict';


// Report is install
// change doc ==> Recipient doc
module.exports = (change) => {
  const {
    cc,
    include,
    office,
  } = change.after.data();

  const locals = {
    messageObject: {
      cc,
      to: [],
    },
  };

  return Promise.resolve();
};
