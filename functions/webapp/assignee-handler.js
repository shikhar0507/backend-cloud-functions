'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');


module.exports = (conn, requester) => {
  const isSupport = requester.isSupport;
  const isAdmin = !requester.isAdmin
    && requester.adminOffices.includes(conn.req.body.office);

  if (!isSupport && !isAdmin) {
    return {
      success: false,
      code: code.unauthorized,
      message: 'Not allowed',
    };
  }

  if (conn.req.body.template !== 'recipient'
    && conn.req.body.template !== 'subscription') {
    return {
      success: false,
      code: code.unauthorized,
      message: `Template: ${conn.req.body.template} is not allowed`,
    };
  }

  const batch = db.batch();
  let activityDoc;
  const oldAssignees = [];
  const adminFetchPromises = [];
  const adminsSet = new Set();
  let failed;

  return rootCollections
    .activities
    .doc(conn.req.body.activityId)
    .get()
    .then(doc => {
      failed = doc.exists;

      if (doc.empty) {
        return ({
          success: false,
          message: `Activity doesn't exist`,
          code: code.badRequest,
        });
      }

      batch.set(doc.ref, {
        timestamp: Date.now(),
        addendumDocRef: null,
      }, {
          merge: true,
        });

      return doc
        .ref
        .collection('Assignees')
        .get();
    })
    .then(snapShot => {
      snapShot.forEach(doc => {
        oldAssignees.push(doc.id);

        batch.delete(doc.ref);
      });

      conn.req.body.share.forEach(phoneNumber => {
        const promise = rootCollections
          .activities
          .where('office', '==', conn.req.body.office)
          .where('template', '==', 'admin')
          .where('attachment.Admin.value', '==', phoneNumber)
          .where('status', '==', 'CONFIRMED')
          .limit(1)
          .get();

        adminFetchPromises.push(promise);
      });

      return Promise.all(adminFetchPromises);
    })
    .then(snapShots => {
      snapShots.forEach(snapShot => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('attachment.Admin.value');

        adminsSet.add(phoneNumber);
      });

      conn.req.body.share.forEach(phoneNumber => {
        const assigneeRef = activityDoc
          .ref
          .collection('Assigness')
          .doc(phoneNumber);

        batch.set(assigneeRef, {
          canEdit: adminsSet.has(phoneNumber),
          addToInclude: false,
        });
      });

      return batch.commit();
    })
    .then(() => {
      if (failed) return;

      return ({ success: true });
    });
};
