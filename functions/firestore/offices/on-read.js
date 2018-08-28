'use strict';

const { sendJSON, handleError, } = require('../../admin/utils');
const { rootCollections, } = require('../../admin/admin');

const getReports = (conn, locals) => {
  // TODO: Implement when the report template are completed.
  sendJSON(conn, locals.jsonObject);
};

const getTemplates = (conn, locals) => {
  rootCollections
    .activityTemplates
    .where('timestamp', '>=', locals.from)
    .get()
    .then((docs) => {
      docs.forEach((doc) => {
        const templateId = doc.id;
        const attachment = doc.get('attachment');
        const name = doc.get('name');
        const schedule = doc.get('schedule');
        const venue = doc.get('venue');

        locals.jsonObject.templates[templateId] = {
          attachment, name, schedule, venue,
        };
      });

      getReports(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const getActivities = (conn, locals) => {
  Promise
    .all(locals.activitiesToFetch)
    .then((activitiesSubcollectionArray) => {
      activitiesSubcollectionArray.forEach((querySnapshot) => {
        querySnapshot.forEach((doc) => {
          const activityId = doc.id;
          const office = doc.get('office');
          const timestamp = doc.get('timestamp');
          const attachment = doc.get('attachment');
          const schedule = doc.get('schedule');
          const venue = doc.get('venue');
          const status = doc.get('status');
          const template = doc.get('template');

          locals.jsonObject.activities[activityId] = {
            office,
            timestamp,
            attachment,
            schedule,
            venue,
            status,
            template,
          };
        });
      });

      getTemplates(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  const from = new Date(parseInt(conn.req.query.from));

  const locals = {
    from,
    jsonObject: {
      from,
      activities: {},
      templates: {},
    },
    activitiesToFetch: [],
  };

  const promises = [];
  const officeNames = conn.requester.customClaims.admin;

  officeNames.forEach(
    (name) => promises.push(rootCollections
      .offices
      .where('attachment.Name.value', '==', name)
      .get()
    )
  );

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        const doc = snapShot.docs[0];
        const officeId = doc.id;
        const timestamp = doc.get('timestamp');

        if (timestamp.toDate().getTime() < locals.from.getTime()) return;

        const status = doc.get('status');

        if (status === 'CANCELLED') return;

        locals.jsonObject.activities[officeId] = {
          status,
          timestamp,
          office: doc.get('office'),
          attachment: doc.get('attachment'),
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          template: doc.get('template'),
        };

        locals.activitiesToFetch
          .push(rootCollections
            .offices
            .doc(officeId)
            .collection('Activities')
            .where('timestamp', '>=', locals.from)
            .get()
          );
      });

      getActivities(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};
