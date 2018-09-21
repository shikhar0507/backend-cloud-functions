'use strict';


const {
  sgMailApiKey,
} = require('../../admin/env');
const {
  rootCollections,
  users,
} = require('../../admin/admin');
const {
  sendGridTemplateIds,
} = require('../../admin/constants');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(sgMailApiKey);

const getYesterdaysDateString = () =>
  new Date(new Date().setDate(new Date().getDate() - 1)).toDateString();


const getPersonDetails = (phoneNumber, activityObject) => {
  // const activityObject = employeesObject[phoneNumber];

  if (!activityObject) {
    return {
      employeeName: '',
      employeeContact: '',
      employeeCode: '',
      department: '',
      firstSupervisorPhoneNumber: '',
      secondSupervisorPhoneNumber: '',
    };
  }

  return {
    employeeName: activityObject.attachment.Name.value,
    employeeContact: activityObject.attachment['Employee Contact'].value,
    employeeCode: activityObject.attachment['Employee Code'].value,
    department: activityObject.attachment.Department.value,
    firstSupervisorPhoneNumber: activityObject.attachment['First Supervisor'].value,
    secondSupervisorPhoneNumber: activityObject.attachment['Second Supervisor'].value,
  };
};


const getReadableDateString = (firestoreDateObject) => {
  if (!firestoreDateObject) return firestoreDateObject;

  return firestoreDateObject.toDate().toDateString();
};

const getRow = (phoneNumber, activityObject) => {
  const details = getPersonDetails(phoneNumber, activityObject);
  const addedOn = getReadableDateString(activityObject.addedOn);
  const signedUpOn = getReadableDateString(activityObject.signedUpOn);
  const firstSupervisorDetails = getPersonDetails(details.firstSupervisorPhoneNumber,activityObject);
  const secondSupervisorDetails = getPersonDetails(details.secondSupervisorPhoneNumber,activityObject);

  return `${details.employeeName},`
    + `${details.employeeContact},`
    + `${details.employeeCode},`
    + `${details.department},`
    + `${addedOn},`
    + `${signedUpOn},`
    + `${firstSupervisorDetails.employeeName},`
    + `${details.firstSupervisorPhoneNumber},`
    + `${secondSupervisorDetails.employeeName},`
    + `${details.secondSupervisorPhoneNumber}`
    + `\n`;
};


// Report is 'added'
module.exports = (change) => {
  const {
    cc,
    office,
    include,
  } = change.after.data();

  const locals = {
    authMap: new Map(),
    csvString: `Employee Name,`
      + ` Employee Contact,`
      + ` Employee Code,`
      + `Department,`
      + `Employee Added Date,`
      + `Sign-Up Date,`
      + `First Supervisor's Name,`
      + `Contact Number,`
      + `Second Supervisor's Name,`
      + `Contact Number,`
      + `\n`,
    messageObject: {
      to: [],
      cc,
      from: 'help@growthfile.com',
      attachments: [],
      templateId: sendGridTemplateIds.signUps,
      'dynamic_template_data': {
        office,
        date: getYesterdaysDateString(),
        subject: `${office} Sign-Up Report_${getYesterdaysDateString()}`,
      },
    },
  };

  return rootCollections
    .inits
    .where('report', '==', 'added')
    .where('office', '==', office)
    .limit(1)
    .get()
    .then((docs) => {
      /** No docs. No emails... */
      if (docs.empty) return Promise.resolve();

      const {
        employeesObject,
      } = docs.docs[0].data();

      const employeePhoneNumbersList = Object.keys(employeesObject);
      let totalSignUpsCount = 0;

      employeePhoneNumbersList.forEach((phoneNumber) => {
        const activityObject = employeesObject[phoneNumber];
        const row = getRow(phoneNumber, activityObject);

        /** Can either be an empty string (falsy) value or a valid date object*/
        if (activityObject.signedUpOn && activityObject.signedUpOn !== '') totalSignUpsCount++;

        locals.csvString += row;
      });

      locals
        .messageObject['dynamic_template_data']
        .totalEmployees = employeePhoneNumbersList.length;
      locals
        .messageObject['dynamic_template_data']
        .totalSignUps = totalSignUpsCount;
      locals
        .messageObject['dynamic_template_data']
        .difference = employeePhoneNumbersList.length - totalSignUpsCount;

      const authFetch = [];

      include.forEach(
        (phoneNumber) =>
          authFetch.push(users.getUserByPhoneNumber(phoneNumber))
      );

      return Promise.all(authFetch);
    })
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record.uid) return;

        locals.authMap.set(phoneNumber, {
          email: record.email,
          disabled: record.disabled,
          displayName: record.displayName || '',
          emailVerified: record.emailVerified,
        });
      });

      include.forEach((phoneNumber) => {
        if (!locals.authMap.get(phoneNumber)) return;
        if (!locals.authMap.get(phoneNumber).email) return;
        if (!locals.authMap.get(phoneNumber).emailVerified) return;
        if (locals.authMap.get(phoneNumber).disabled) return;

        locals.messageObject.to.push({
          name: locals.authMap.get(phoneNumber).displayName,
          email: locals.authMap.get(phoneNumber).email,
        });
      });

      /** No mails sent. */
      if (locals.messageObject.to.length === 0) return Promise.resolve();

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Sign-Up Report_${getYesterdaysDateString()}.xlsx`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: 'attachment',
      });

      return sgMail.send(locals.messageObject);
    })
    .catch(console.error);
};
