'use strict';


const {
  users,
} = require('../../admin/admin');
const {
  sendGridTemplateIds,
} = require('../../admin/constants');

const getYesterdaysDateString = () => {
  const today = new Date();

  return new Date(today.setDate(today.getDate() - 1)).toDateString();
};

const getPersonDetails = (phoneNumber, employeesObject) => {
  const activityObject = employeesObject[phoneNumber];

  if (!activityObject || !phoneNumber || phoneNumber === '') {
    return {
      employeeName: '',
      employeeContact: '',
      employeeCode: '',
      department: '',
      firstSupervisorPhoneNumber: '',
      secondSupervisorPhoneNumber: '',
      addedOn: '',
      signedUpOn: '',
    };
  }

  return {
    employeeName: activityObject.attachment.Name.value,
    employeeContact: activityObject.attachment['Employee Contact'].value,
    employeeCode: activityObject.attachment['Employee Code'].value,
    department: activityObject.attachment.Department.value,
    firstSupervisorPhoneNumber: activityObject.attachment['First Supervisor'].value,
    secondSupervisorPhoneNumber: activityObject.attachment['Second Supervisor'].value,
    addedOn: activityObject.addedOn,
    signedUpOn: activityObject.signedUpOn || '',
  };
};


const getRow = (phoneNumber, employeesObject) => {
  const details = getPersonDetails(phoneNumber, employeesObject);
  const firstSupervisorDetails =
    getPersonDetails(details.firstSupervisorPhoneNumber, employeesObject);
  const secondSupervisorDetails =
    getPersonDetails(details.secondSupervisorPhoneNumber, employeesObject);

  return `${details.employeeName},`
    + `[${details.employeeContact}],`
    + `${details.employeeCode},`
    + `${details.department},`
    + `${details.addedOn},`
    + `${details.signedUpOn},`
    + `${firstSupervisorDetails.employeeName},`
    + `[${details.firstSupervisorPhoneNumber}],`
    + `${secondSupervisorDetails.employeeName},`
    + `[${details.secondSupervisorPhoneNumber}]`
    + `\n`;
};


// Report is 'added'
module.exports = (change, sgMail) => {
  const {
    cc,
    office,
    include,
    employeesObject,
  } = change.after.data();

  const locals = {
    authMap: new Map(),
    csvString: `Employee Name,`
      + ` Employee Contact,`
      + ` Employee Code,`
      + ` Department,`
      + ` Employee Added Date,`
      + ` Sign-Up Date,`
      + ` First Supervisor's Name,`
      + ` Contact Number,`
      + ` Second Supervisor's Name,`
      + ` Contact Number,`
      + `\n`,
    messageObject: {
      cc,
      to: [],
      from: 'gcloud@growthfile.com',
      templateId: sendGridTemplateIds.signUps,
      attachments: [],
      'dynamic_template_data': {
        office,
        date: new Date().toDateString(),
        subject: `${office} Sign-Up Report_${getYesterdaysDateString()}`,
      },
    },
  };

  const authFetch = [];

  include.forEach(
    (phoneNumber) =>
      authFetch.push(users.getUserByPhoneNumber(phoneNumber))
  );

  return Promise
    .all(authFetch)
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record.uid) return;
        if (!record.email) return;
        if (!record.emailVerified) return;
        if (record.disabled) return;

        locals.messageObject.to.push({
          name: record.displayName || '',
          email: record.email,
        });
      });

      /** No mails sent. */
      if (locals.messageObject.to.length === 0) {
        console.log('No messages sent...');

        return Promise.resolve();
      }

      const employeePhoneNumbersList = Object.keys(employeesObject);
      let totalSignUpsCount = 0;

      /** No data. No email... */
      if (employeePhoneNumbersList.length === 0) {
        console.log('No emails sent.', 'employeePhoneNumbersList.length', employeePhoneNumbersList.length);

        return Promise.resolve();
      }

      employeePhoneNumbersList.forEach((phoneNumber) => {
        const activityObject = employeesObject[phoneNumber];
        const row = getRow(phoneNumber, employeesObject);

        /** Can either be an empty string (falsy) value or a valid date object*/
        if (activityObject.signedUpOn) totalSignUpsCount++;

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

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Sign-Up Report_${getYesterdaysDateString()}.csv`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: 'attachment',
      });

      console.log({
        office,
        csv: locals.csvString,
        msg: locals.messageObject,
      });

      return sgMail.send(locals.messageObject);
    })
    .catch(console.error);
};
