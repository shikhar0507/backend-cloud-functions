/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */


const {
  rootCollections,
  users,
  getGeopointObject,
  db,
} = require('../../admin/admin');

const {
  activities,
  profiles,
  updates,
  enums,
  activityTemplates,
  offices,
} = rootCollections;

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  code,
} = require('../../admin/responses');

const {
  handleCanEdit,
  isValidDate,
  isValidString,
  isValidPhoneNumber,
  isValidLocation,
  filterSchedules,
  filterVenues,
  attachmentCreator,
} = require('./helper');


/**
 * Commits the batch and sends a response to the client.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const commitBatch = (conn) => conn.batch.commit()
  .then((metadata) => sendResponse(
    conn,
    code.created,
    'The activity was successfully created.',
    true
  )).catch((error) => handleError(conn, error));


/**
 * Adds docs for each assignee of the activity to the batch.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const handleAssignedUsers = (conn) => {
  const promises = [];

  /**
   * create docs in Assignees collection if assign is in the reqeuest body.
   * */
  conn.req.body.assign.forEach((val) => {
    if (!isValidPhoneNumber(val)) return;

    conn.batch.set(activities.doc(conn.activityRef.id)
      .collection('Assignees').doc(val), {
        canEdit: handleCanEdit(
          conn.data.subscription.get('canEditRule'),
          val,
          conn.requester.phoneNumber,
          conn.data.subscription.get('include')
        ),
      }, {
        merge: true,
      });

    /** phone numbers exist uniquely in the Profiles root collection */
    promises.push(profiles.doc(val).get());

    conn.batch.set(profiles.doc(val).collection('Activities')
      .doc(conn.activityRef.id), {
        canEdit: handleCanEdit(
          conn.data.subscription.get('canEditRule'),
          val,
          conn.requester.phoneNumber,
          conn.data.subscription.get('include')
        ),
        timestamp: new Date(conn.req.body.timestamp),
      });
  });

  Promise.all(promises).then((snapShots) => {
    /** The doc exists inside Profiles collection. */
    snapShots.forEach((doc) => {
      if (!doc.exists) {
        /** Create profiles for the phone numbers which are not in the DB. */
        conn.batch.set(profiles.doc(doc.id), {
          uid: null,
        });

        conn.batch.set(profiles.doc(doc.id).collection('Activities')
          .doc(conn.activityRef.id), {
            canEdit: handleCanEdit(
              conn.data.subscription.get('canEditRule'),
              doc.id,
              conn.requester.phoneNumber,
              conn.data.subscription.get('include')
            ),
            timestamp: new Date(conn.req.body.timestamp),
          });
      }

      /** uid shouldn't be null OR undefined */
      if (doc.exists && doc.get('uid')) {
        conn.batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), conn.addendumData);
      }
    });

    commitBatch(conn, conn.batch);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Adds activity root doc to batch.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 */
const createActivity = (conn) => {
  /** description is a non-essential field */
  if (!conn.req.body.description) conn.req.body.description = '';

  conn.batch.set(conn.activityRef, {
    title: conn.req.body.title || conn.req.body.description
      .substring(0, 30) || conn.data.template.get('defaultTitle'),
    description: conn.req.body.description,
    status: conn.data.template.get('statusOnCreate'),
    office: conn.req.body.office,
    template: conn.req.body.template,
    schedule: filterSchedules(
      conn.req.body.schedule,
      /** schedule object from the template */
      conn.data.template.get('schedule')
    ),
    venue: filterVenues(
      conn.req.body.venue,
      /** venue object from the template */
      conn.data.template.get('venue')
    ),
    timestamp: new Date(conn.req.body.timestamp),
    /** The docRef is the reference to the document which the
     * activity handled in the request. It will ne null for an
     * activity with the template 'plan' with office 'personal'.
     */
    docRef: conn.docRef || null,
    canEditRule: conn.data.subscription.get('canEditRule'),
  });

  conn.addendumData = {
    activityId: conn.activityRef.id,
    user: conn.requester.displayName || conn.requester.phoneNumber,
    comment: `${conn.requester.displayName || conn.requester.phoneNumber}
      created ${conn.data.template.get('name')}`,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: new Date(conn.req.body.timestamp),
  };

  /** The addendum doc is always created for the requester */
  conn.batch.set(updates.doc(conn.requester.uid)
    .collection('Addendum').doc(), conn.addendumData);

  /** The 'include' array will always have the requester's
   * phone number, so we don't need to explictly add their number
   * in order to add them to a batch.
   */
  conn.data.subscription.get('include').forEach((val) => {
    conn.batch.set(activities.doc(conn.activityRef.id)
      .collection('Assignees').doc(val), {
        canEdit: handleCanEdit(
          conn.data.subscription.get('canEditRule'),
          val,
          conn.requester.phoneNumber,
          conn.data.subscription.get('include')
        ),
      });
  });

  conn.batch.set(profiles.doc(conn.requester.phoneNumber)
    .collection('Activities').doc(conn.activityRef.id), {
      canEdit: handleCanEdit(
        conn.data.subscription.get('canEditRule'),
        /** The phone Number to check and the one with which we are
         * going to verify the edit rule with are same because this
         * block is writing the doc for the user themselves.
         */
        conn.requester.phoneNumber,
        conn.requester.phoneNumber,
        conn.data.subscription.get('include')
      ),
      timestamp: new Date(conn.req.body.timestamp),
    });

  if (Array.isArray(conn.req.body.assign)) {
    handleAssignedUsers(conn);
    return;
  }

  commitBatch(conn);
};


/**
 * Adds subscription to the user's profile based on the request body.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 */
const createSubscription = (conn) => {
  conn.docRef = profiles.doc(conn.requester.phoneNumber)
    .collection('Subscriptions').doc();

  conn.batch.set(conn.docRef, {
    include: [conn.requester.phoneNumber],
    timestamp: new Date(conn.req.body.timestamp),
    template: conn.data.subscription.id,
    office: conn.req.body.office,
    activityId: conn.activityRef.id,
    status: conn.data.template.get('statusOnCreate'),
  });

  createActivity(conn);
};


/**
 * Creates a new document inside Office root collection based on the
 * attachment, template, and the request body.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 */
const createCompany = (conn) => {
  conn.docRef = offices.doc(conn.req.body.office);

  conn.batch.set(conn.docRef, {
    activityId: conn.activityRef.id,
    attachment: attachmentCreator(
      conn.req.body.attachment,
      conn.data.template.get('attachment')
    ),
  });

  createActivity(conn);
};


/**
 * Creates a new document inside the specified Office from the
 * attachment based on the attachment, template and, the request body.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 */
const addNewEntityInOffice = (conn) => {
  conn.docRef = office.doc(conn.req.body.office)
    .collection(conn.req.body.template).doc();

  conn.batch.set(conn.docRef, {
    attachment: attachmentCreator(
      conn.req.body.attachment,
      conn.data.template.get('attachment')
    ),
    schedule: filterSchedules(
      conn.req.body.schedule,
      conn.data.template.get('schedule')
    ),
    venue: filterVenues(
      conn.req.body.venue,
      conn.data.template.get('venue')
    ),
    activityId: conn.activityRef.id,
    status: conn.data.template.get('statusOnCreate'),
  });

  createActivity(conn);
};


/**
 * Checks the template and office combination and handles the request
 * based on that.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 */
const processRequestType = (conn) => {
  /** reference of the batch and the activity instance will be used
   * multiple times throughout the activity creation
   */
  conn.activityRef = activities.doc();
  conn.batch = db.batch();

  if (conn.req.body.office === 'personal') {
    if (conn.req.body.template === 'plan') {
      createActivity(conn);
      return;
    }

    sendResponse(
      conn,
      code.badRequest,
      `This combination of office: ${conn.req.body.office} and`
      + `template: ${conn.req.body.template} does not exist in`
      + ' your subscriptions',
      false
    );
    return;
  } else {
    /** if office is not personal */
    if (!conn.data.office.exists) {
      /** office does not exist with the name from the request */
      sendResponse(
        conn,
        code.badRequest,
        `An office with the name: ${conn.data.office.get('name')}`
        + 'does not exist.',
        false
      );
      return;
    }

    /** For creating a subscription or company, an attachment is required */
    if (!conn.req.body.attachment) {
      sendResponse(
        conn,
        code.badRequest,
        'Template is not present in the request body',
        false
      );
      return;
    }

    if (conn.req.body.template === 'subscription') {
      createSubscription(conn);
      return;
    }

    if (conn.req.body.template === 'company') {
      createCompany(conn);
      return;
    }

    addNewEntityInOffice(conn);
  }
};


/**
 * Fetches the template and the subscriptions of the requester form Firestore.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 */
const fetchDocs = (conn) => {
  const promises = [
    activityTemplates.where('name', '==', conn.req.body.template)
      .limit(1).get(),
    profiles.doc(conn.requester.phoneNumber).collection('Subscriptions')
      .where('template', '==', conn.req.body.template).limit(1).get(),
    offices.where('name', '==', conn.req.body.office).limit(1).get(),
  ];

  Promise.all(promises).then((result) => {
    /** template sent in the request body is not a doesn't exist */
    if (result[0].empty) {
      sendResponse(
        conn,
        code.badRequest,
        'Template: ' + conn.req.body.template + ' does not exist',
        false
      );
      return;
    }

    if (result[1].empty) {
      /** The template with that field does not exist in the user's
       * subscriptions. This probably means that they are either not subscribed
       *  to the template that they requested to create the activity
       * with, OR the template with that name simply does not exist.
       */
      sendResponse(
        conn,
        code.forbidden,
        `A template with the name: ${conn.req.body.template}`
        + ' does not exist in your subscriptions.',
        false
      );
      return;
    }

    if (result[1].docs[0].get('office') !== conn.req.body.office) {
      /** Template from the request body and the office do not match so,
       * the requester probably doesn't have the permission to create
       * an activity with this template.
       */
      sendResponse(
        conn,
        code.forbidden,
        'You do not have the permission to create' +
        ` an activity with the template ${conn.req.body.template}.`,
        false
      );
      return;
    }

    conn.data = {};
    conn.data.template = result[0].docs[0];
    conn.data.subscription = result[1].docs[0];
    conn.data.office = result[2].docs[0];

    processRequestType(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp) &&
    isValidString(conn.req.body.template) &&
    isValidString(conn.req.body.office) &&
    isValidLocation(conn.req.body.geopoint)
    && conn.req.body.template) {
    fetchDocs(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper' +
    ' values. Please make sure that the timestamp, template, office' +
    ' and the geopoint are included in the request with appropriate values.',
    false
  );
};

module.exports = app;
