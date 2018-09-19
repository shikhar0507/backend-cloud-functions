'use strict';


const {
  sgMailApiKey,
} = require('../../admin/env');
const {
  rootCollections,
  users,
} = require('../../admin/admin');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(sgMailApiKey);

const getYesterdaysDateString = () =>
  new Date(new Date().setDate(new Date().getDate() - 1)).toDateString();


// Report is added
module.exports = (change) => {
  const {
    cc,
    office,
    include,
    officeId,
  } = change.after.data();

  const locals = {
    authFetch: [],
    employeeDataMap: new Map(),
    activityFetch: [],
    authMap: new Map(),
    initDoc: {},
    subject: '',
    messageObject: {
      to: [],
      cc,
      from: 'help@growthfile.com',
      attachments: [],
      templateId: 'd-a73b2f579c8746758ba2753fbb0341df',
      'dynamic_template_data': {
        office,
        date: getYesterdaysDateString(),
        subject: `${office} Sign-Up Report_${getYesterdaysDateString()}`,
      },
    },
  };

  /**
   * Query Inits
   * Get all docs where event === 'added'
   * Get all employees of that office
   * Create report
   * Exit
   */

  return Promise
    .all([
      rootCollections
        .inits
        .where('event', '==', 'added')
        .where('office', '==', office)
        .get(),
      rootCollections
        .offices
        .doc(officeId)
        .collection('Activities')
        // .activities
        .where('template', '==', 'employee')
        .get(),
    ])
    .then((result) => {
      const [
        initDocs,
        employeeDocs,
      ] = result;

      employeeDocs.forEach((employee) => {
        const phoneNumber = employee.get('attachment.Employee Contact.value');
        const firstSupervisorPhoneNumber =
          employee.get('attachment.First Supervisor.value');
        const secondSupervisorPhoneNumber =
          employee.get('attachment.Second Supervisor.value');

        locals.authFetch.push(employee.get('attachment.Employee Contact.value'));
        locals.authFetch.push(firstSupervisorPhoneNumber);
        locals.authFetch.push(secondSupervisorPhoneNumber);

        locals.employeeDataMap.set(phoneNumber, {
          firstSupervisorPhoneNumber,
          secondSupervisorPhoneNumber,
          employeeContact: phoneNumber,
          name: employee.get('attachment.Name.value'),
          employeeCode: employee.get('attachment.Employee Code.value'),
          department: employee.get('attachment.Department.value'),
        });
      });

      initDocs.forEach((doc) => {
        if (!locals.employeeDataMap.get(doc.get('phoneNumber'))) return;

        let addedOn = doc.get('addedOn');
        let signedUpOn = doc.get('signedUpOn');

        if (addedOn !== '') {
          addedOn = addedOn.toDate().toDateString();
        }

        if (signedUpOn !== '') {
          signedUpOn = signedUpOn.toDate().toDateString();
        }

        locals
          .employeeDataMap.get(doc.get('phoneNumber')).addedOn =
          addedOn;
        locals
          .employeeDataMap.get(doc.get('phoneNumber')).signedUpOn =
          signedUpOn;
      });

      locals
        .messageObject['dynamic_template_data']['totalEmployees'] =
        employeeDocs.size;
      locals
        .messageObject['dynamic_template_data']['totalSignUps'] =
        initDocs.size;
      locals
        .messageObject['dynamic_template_data']['difference'] =
        employeeDocs.size - initDocs.size;

      include.forEach((phoneNumber) => {
        locals.authFetch.push(users.getUserByPhoneNumber(phoneNumber));
      });

      return Promise.all(locals.authFetch);
    })
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];
        if (!record) return;

        const displayName = record.displayName || '';
        const disabled = record.disabled;
        const email = record.email;
        const emailVerified = record.emailVerified;

        locals.authMap.set(phoneNumber, {
          displayName,
          email,
          disabled,
          emailVerified,
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

      return;
    })
    .then(() => {
      let str = `Employee Name,`
        + ` Employee Contact,`
        + ` Employee Code,`
        + `Department,`
        + `Employee Added Date,`
        + `Sign-Up Date,`
        + `First Supervisor's Name,`
        + `Contact Number,`
        + `Second Supervisor's Name,`
        + `Contact Number,`
        + `\n`;

      locals.employeeDataMap.forEach((employee) => {
        let firstSupervisorName = '';
        let secondSupervisorName = '';

        if (locals.authMap.get(employee.firstSupervisorPhoneNumber)) {
          firstSupervisorName =
            locals.authMap.get(employee.firstSupervisorPhoneNumber)
              .displayName;
        }

        if (locals.authMap.get(employee.secondSupervisorPhoneNumber)) {
          secondSupervisorName =
            locals.authMap.get(employee.secondSupervisorPhoneNumber)
              .displayName;
        }

        const row = `${employee.name},`
          + `${employee.employeeContact},`
          + `${employee.employeeCode},`
          + `${employee.department},`
          + `${employee.addedOn},`
          + `${employee.signedUpOn},`
          + `${firstSupervisorName},`
          + `${employee.firstSupervisorPhoneNumber},`
          + `${secondSupervisorName},`
          + `${employee.secondSupervisorPhoneNumber}`;

        str += `${row}\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(str).toString('base64'),
        fileName: `${office} Sign-Up Report_${getYesterdaysDateString()}.xlsx`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: 'attachment',
      });

      return sgMail.send(locals.messageObject);
    })
    .catch(console.error);
};
