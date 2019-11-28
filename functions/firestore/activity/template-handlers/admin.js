const { getAuth } = require('../../../admin/utils');
const { auth } = require('firebase-admin');

const Admin = async locals => {
  const {
    attachment,
    status,
    office,
  } = locals.change.after.data();
  const {
    value: adminContact,
  } = attachment.Admin;

  const userRecord = await getAuth(adminContact);

  if (!userRecord.uid) {
    return;
  }

  const customClaims = Object
    .assign({}, userRecord.customClaims);

  customClaims
    .admin = customClaims.admin || [];
  customClaims
    .admin.push(office);
  customClaims
    .admin = Array.from(new Set(customClaims.admin));

  if (status === 'CANCELLED') {
    const index = customClaims.admin.indexOf(office);

    customClaims
      .admin = customClaims.admin.splice(index, 1);
  }

  return auth()
    .setCustomUserClaims(userRecord.uid, customClaims);
};

module.exports = Admin;
