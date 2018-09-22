'use strict';

const {
  rootCollections,
  users,
} = require('../../admin/admin');

const getYesterdaysDateString = () =>
  new Date(new Date().setDate(new Date().getDate() - 1)).toDateString();


const getPersonDetails = (phoneNumber, activityObject) => {
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


// Report is install
// change doc ==> Recipient doc
module.exports = (change, sgMail) => {
  const {
    cc,
    include,
    dataObject,
    office,
  } = change.after.data();

  const locals = {
    authFetch: [],
    authMap: new Map(),
    employeeDataMap: new Map(),
    messageObject: {
      to: [],
      cc,
      from: 'gcloud@growthfile.com',
      attachments: [],
      templateId: ``,
      'dynamic_template_data': {
        // Substitutions: totalInstalls, extra installs.
        office,
        date: getYesterdaysDateString(),
        subject: `Install Report_${office}_${getYesterdaysDateString()}`,
      },
    },
  };

  return Promise.resolve();
};
