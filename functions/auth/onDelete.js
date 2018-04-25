const admin = require('../admin/admin');
const stripPlusFromMobile =
  require('../firestore/activity/helpers').stripPlusFromMobile;

const app = (userRecord, context) => {
  const uid = userRecord.uid;
  const mobile = stripPlusFromMobile(userRecord.phoneNumber);
};

module.exports = app;
