'use strict';

const {
  rootCollections,
  db,
} = require('../../admin/admin');


const handleProfiles = (doc, context, locals) =>
  Promise
    .all(locals.promises)
    .then((profileDocs) => {
      locals.batch = db.batch();

      profileDocs.forEach((profile) => {
        const phoneNumber = profile.id;
        const canEdit = doc.get('canEdit');
        const activityRef = locals.result[0];
        const activityId = activityRef.id;
        const timestamp = activityRef.get('timestamp');

        if (!profile.exists) {
          // Create profile
          locals.batch.set(rootCollections
            .profiles
            .doc(phoneNumber), {
              uid: null,
            }
          );
        }

        locals.batch.set(rootCollections
          .profiles
          .doc(phoneNumber)
          .collection('Activities')
          .doc(activityId), {
            canEdit,
            timestamp,
          }
        );
      });

      return;
    });


const handleResult = (doc, context, locals) => {
  const assigneesArray = locals.result[1];

  locals.promises = [];

  assigneesArray.forEach((doc) => {
    const phoneNumber = doc.id;

    locals.promises.push(
      rootCollections
        .profiles
        .doc(phoneNumber)
        .get()
    );
  });

  return handleProfiles(doc, context, locals);
};


module.exports = (doc, context) => {
  const activityId = context.params.activityId;
  const activityRef = rootCollections.activities.doc(activityId);

  return Promise
    .all([
      activityRef
        .get(),
      activityRef
        .collection('Assignees')
        .get(),
    ])
    .then((result) => {
      /** Object to store local data... */
      const locals = {
        result,
      };

      return handleResult(doc, context, locals);
    })
    .catch(console.error);
};
