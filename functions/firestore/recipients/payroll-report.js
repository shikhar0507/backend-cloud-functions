'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

const {
  sendGridTemplateIds,
} = require('../../admin/constants');

module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  locals.messageObject.templateId = sendGridTemplateIds.payroll;
  locals.csvString =
    ` Employee Name,`
    + ` Employee Contact,`
    + ` Department,`
    + ` Base Location,`
    + ` Live Since,`;

  return Promise.all([
    rootCollections
      .offices
      .doc(officeId)
      .get(),
    rootCollections
      .inits
      .where('office', '==', office)
      .get();
  ])
  .then((result) => {
    const [
      officeDoc,
      initDocs,
    ] = result;

    return Promise.resolve();
  })
    .catch(console.error);

};
