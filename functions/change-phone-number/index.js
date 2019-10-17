'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const {
  getAuth,
  handleError,
  sendResponse,
  isE164PhoneNumber,
} = require('../admin/utils');
const {
  subcollectionNames,
} = require('../admin/constants');
const {
  code,
} = require('../admin/responses');

const validator = body => {
  if (!body.hasOwnProperty('newPhoneNumber')) {
    return `Field 'newPhoneNumber' is missing`
      + ` from the request body`;
  }

  if (!isE164PhoneNumber(body.newPhoneNumber)) {
    return `Invalid phone number:`
      + ` '${body.newPhoneNumber}' in the request body`;
  }

  return null;
};


const populateActivities = async (oldPhoneNumber, newPhoneNumber) => {
  const updateActivities = async (query, resolve, reject) => {
    const snap = await query
      .get();

    if (snap.empty) {
      return resolve();
    }

    const batch = db.batch();

    snap
      .forEach(doc => {
        // replace old phone number in activities
        // creator, creator.phoneNumber
        const data = doc.data();
        const attachment = doc.get('attachment');

        data
          .addendumDocRef = null;

        const creator = (() => {
          if (typeof doc.get('creator') === 'string') {
            return {
              displayName: '',
              photoURL: '',
              phoneNumber: doc.get('creator'),
            };
          }

          return doc.get('creator');
        })();

        if (creator.phoneNumber === oldPhoneNumber) {
          data
            .creator
            .phoneNumber = newPhoneNumber;
        }
        const fields = Object.keys(attachment);

        fields
          .forEach(field => {
            const { value, type } = attachment[field];

            if (type === 'phoneNumber') {
              return;
            }

            if (value === oldPhoneNumber) {
              data
                .attachment[field]
                .value = newPhoneNumber;
            }
          });

        const ref = rootCollections
          .activities
          .doc(doc.id);

        batch
          .delete(
            ref
              .collection(subcollectionNames.ASSIGNEES)
              .doc(oldPhoneNumber)
          );

        batch
          .set(
            ref
              .collection(subcollectionNames.ASSIGNEES)
              .doc(newPhoneNumber), {
            addToInclude: data.template === 'subscription',
          });

        batch
          .set(ref,
            Object.assign({}, data), {
            merge: true,
          });
      });

    await batch
      .commit();

    const lastDoc = snap.docs[snap.size - 1];

    if (!lastDoc) {
      return resolve();
    }

    process
      .nextTick(() => {
        const newQuery = query
          .startAfter(lastDoc.id);

        return updateActivities(
          newQuery,
          resolve,
          reject
        );
      });
  };

  const promiseCallback = (resolve, reject) => {
    const query = rootCollections
      .profiles
      .doc(oldPhoneNumber)
      .collection(subcollectionNames.ACTIVITIES)
      .orderBy('__name__')
      .limit(100);

    return updateActivities(
      query,
      resolve,
      reject
    );
  };

  return new Promise(promiseCallback);
};

const populateWebapp = async (oldPhoneNumber, newPhoneNumber) => {

  const promiseCallback = (resolve, reject) => {
    const moveWebapp = async (query, resolve, reject) => {
      const snap = await query.get();
      const batch = db.batch();

      snap.docs.forEach(doc => {
        const ref = rootCollections
          .profiles
          .doc(newPhoneNumber)
          .collection(subcollectionNames.WEBAPP)
          .doc(doc.id);
        const data = doc.data();

        if (data.phoneNumber === oldPhoneNumber) {
          data
            .phoneNumber = newPhoneNumber;
        }

        batch
          .set(ref, data, { merge: true });
      });

      await batch.commit();

      const lastDoc = snap.docs[snap.size - 1];


      if (!lastDoc) {
        return resolve();
      }

      return process.nextTick(() => {
        const newQuery = query
          .startAfter(lastDoc.id);

        return moveWebapp(
          newQuery,
          resolve,
          reject
        );
      });
    };

    const query = rootCollections
      .profiles
      .doc(oldPhoneNumber)
      .collection(subcollectionNames.WEBAPP)
      .orderBy('__name__')
      .limit(100);

    return moveWebapp(
      query,
      resolve,
      reject
    );
  };

  return new Promise(promiseCallback);
};

module.exports = async conn => {
  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(
      conn,
      code.badRequest,
      v,
    );
  }

  try {
    const newAuth = await getAuth(
      conn.req.body.newPhoneNumber
    );

    if (newAuth.uid) {
      return sendResponse(
        conn,
        code.badRequest,
        `The phone number: '${conn.req.body.newPhoneNumber}'`
        + ` is already in use`
      );
    }

    conn
      .req
      .body
      .oldPhoneNumber = conn.requester.phoneNumber;

    await populateActivities(
      conn.req.body.oldPhoneNumber,
      conn.req.body.newPhoneNumber,
    );

    await populateWebapp(
      conn.req.body.oldPhoneNumber,
      conn.req.body.newPhoneNumber,
    );

    const profileData = (
      await rootCollections
        .profiles
        .doc(conn.req.body.oldPhoneNumber)
        .get()
    ).data() || {};

    delete profileData.uid;

    await rootCollections
      .profiles
      .doc(conn.req.body.newPhoneNumber)
      .set(profileData, {
        merge: true,
      });

    return sendResponse(
      conn,
      code.accepted,
      'Phone Number change is in progress.'
    );
  } catch (error) {
    handleError(conn, error);
  }
};
