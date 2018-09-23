'use strict';

const {
  sendGridTemplateIds,
} = require('../../admin/constants');
const {
  rootCollections,
  users,
} = require('../../admin/admin');

const getEmployeeDataObject = (employeeActivityDoc, phoneNumber) => {
  if (!employeeActivityDoc) {
    return {
      baseLocation: '',
      dailyEndTime: '',
      dailyStartTime: '',
      department: '',
      employeeCode: '',
      employeeContact: phoneNumber,
      firstSupervisorPhoneNumber: '',
      secondSupervisorPhoneNumber: '',
      name: '',
      weeklyOff: '',
    };
  }

  return {
    baseLocation: employeeActivityDoc.get('attachment.Base Location.value'),
    dailyEndTime: employeeActivityDoc.get('attachment.Daily End Time.value'),
    dailyStartTime: employeeActivityDoc.get('attachment.Daily Start Time.value'),
    department: employeeActivityDoc.get('attachment.Department.value'),
    employeeCode: employeeActivityDoc.get('attachment.Employee Code.value'),
    employeeContact: phoneNumber,
    firstSupervisorPhoneNumber: employeeActivityDoc.get('attachment.First Supervisor.value'),
    secondSupervisorPhoneNumber: employeeActivityDoc.get('attachment.Second Supervisor.value'),
    name: employeeActivityDoc.get('attachment.Name.value'),
    weeklyOff: employeeActivityDoc.get('attachment.Weekly Off.value'),
  };
};

const getYesterdaysDateString = () =>
  new Date(new Date().setDate(new Date().getDate() - 1)).toDateString();

const getYesterdaysStartTime = () =>
  new Date(
    new Date(new Date().setDate(new Date().getDate() - 1)).setHours(0, 0, 0)
  );


module.exports = (change, sgMail) => {
  const {
    installsObject,
    officeId,
    office,
    include,
    cc,
  } = change.after.data();

  const locals = {
    supervisorsFetch: [],
    authFetch: [],
    multiInstallsString: new Map(),
    employeeDataMap: new Map(),
    csvString: `Employee Name,`
      + ` Employee Contact,`
      + ` Employee Code,`
      + ` Department,`
      + ` Install Date,`
      + ` Install Time,`
      + ` Number Of Installs,`
      + ` First Supervisor's Name,`
      + ` Contact Number,`
      + ` Second Supervisor's Name,`
      + ` Contact Number\n`,
    hasInstallsBeforeToday: [],
    messageObject: {
      to: [],
      cc,
      attachments: [],
      templateId: sendGridTemplateIds.installs,
      from: 'gcloud@growthfile.com',
      'dynamic_template_data': {
        office,
        date: getYesterdaysDateString(),
        subject: `Install Report_${office}_${getYesterdaysDateString()}`,
      },
    },
  };

  locals.phoneNumbersList = Object.keys(installsObject);
  const employeeToFetch = [];

  locals.messageObject['dynamic_template_data'].totalInstalls = locals.phoneNumbersList.length;
  locals.phoneNumbersList.forEach((phoneNumber) => {
    const installs = installsObject[phoneNumber];
    const query = rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('template', '==', 'employee')
      .where('attachment.Employee Contact.value', '==', phoneNumber)
      .limit(1)
      .get();

    employeeToFetch.push(query);

    installs.forEach((install) => {
      const timestamp = install.toDate().getTime();

      if (timestamp < getYesterdaysStartTime().getTime()) {
        locals.hasInstallsBeforeToday.push(phoneNumber);
      }
    });

    locals.messageObject['dynamic_template_data']
      .extraInstalls = locals.hasInstallsBeforeToday.length;
  });

  return Promise
    .all(employeeToFetch)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          const filters = snapShot._query._fieldFilters;
          const phoneNumber = filters[1]._value;

          locals
            .employeeDataMap
            .set(phoneNumber, getEmployeeDataObject(null, phoneNumber));

          return;
        }

        const employeeActivityDoc = snapShot.docs[0];
        const phoneNumber = employeeActivityDoc.get('attachment.Employee Contact.value');

        const firstSupervisorPhoneNumber =
          employeeActivityDoc.get('attachment.First Supervisor.value');
        const secondSupervisorPhoneNumber =
          employeeActivityDoc.get('attachment.Second Supervisor.value');

        locals.employeeDataMap
          .set(
            phoneNumber,
            getEmployeeDataObject(employeeActivityDoc, phoneNumber)
          );

        if (firstSupervisorPhoneNumber) {
          const query = rootCollections
            .offices
            .doc(officeId)
            .collection('Activities')
            .where('template', '==', 'employee')
            .where('attachment.Employee Contact.value', '==', firstSupervisorPhoneNumber)
            .limit(1)
            .get();

          locals.supervisorsFetch.push(query);
        }

        if (secondSupervisorPhoneNumber) {
          const query = rootCollections
            .offices
            .doc(officeId)
            .collection('Activities')
            .where('template', '==', 'employee')
            .where('attachment.Employee Contact.value', '==', secondSupervisorPhoneNumber)
            .limit(1)
            .get();

          locals.supervisorsFetch.push(query);
        }
      });

      return Promise.all(locals.supervisorsFetch);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          const filters = snapShot._query._fieldFilters;
          const phoneNumber = filters[1]._value;

          locals
            .employeeDataMap
            .set(phoneNumber, getEmployeeDataObject(null, phoneNumber));

          return;
        }

        const employeeActivityDoc = snapShot.docs[0];
        const phoneNumber = employeeActivityDoc.get('attachment.Employee Contact.value');

        locals.employeeDataMap
          .set(
            phoneNumber,
            getEmployeeDataObject(employeeActivityDoc, phoneNumber)
          );
      });

      locals.hasInstallsBeforeToday.forEach((phoneNumber) => {
        const installs = installsObject[phoneNumber];
        let str = 'Phone Number, Install Date, Install Time\n';

        installs.forEach((date) => {
          const installDate = date.toDate().toDateString();
          const installTime = date.toDate().toTimeString();

          str += `${phoneNumber}, ${installDate}, ${installTime}\n`;
        });

        locals.multiInstallsString.set(phoneNumber, str);
      });

      include.forEach((phoneNumber) => {
        locals.authFetch.push(users.getUserByPhoneNumber(phoneNumber));
      });

      return Promise.all(locals.authFetch);
    })
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record.uid) return;
        const email = record.email;
        const disabled = record.disabled;
        const emailVerified = record.emailVerified;

        if (!email) return;
        if (disabled) return;
        if (!emailVerified) return;

        locals.messageObject.to.push({
          email,
          name: record.displayName || '',
        });
      });

      locals.phoneNumbersList.forEach((phoneNumber) => {
        const data = locals.employeeDataMap.get(phoneNumber);
        const installDate =
          installsObject[phoneNumber][0].toDate().toDateString();
        const installTime =
          installsObject[phoneNumber][0].toDate().toTimeString();
        const numberOfInstalls = installsObject[phoneNumber].length;
        let firstSupervisorsName = '';
        let secondSupervisorsName = '';

        if (locals.employeeDataMap.get(data.firstSupervisorPhoneNumber)) {
          firstSupervisorsName =
            locals.employeeDataMap.get(data.firstSupervisorPhoneNumber).name;
        }

        if (locals.employeeDataMap.get(data.secondSupervisorPhoneNumber)) {
          secondSupervisorsName =
            locals.employeeDataMap.get(data.secondSupervisorPhoneNumber).name;
        }

        locals.csvString +=
          `${data.name},`
          + `[${data.employeeContact}],`
          + `${data.employeeCode},`
          + `${data.department},`
          + `${installDate},`
          + `${installTime},`
          + `${numberOfInstalls},`
          + `${firstSupervisorsName},`
          + `${data.firstSupervisorPhoneNumber},`
          + `${secondSupervisorsName},`
          + `${data.secondSupervisorPhoneNumber}`
          + `\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Install Report_${getYesterdaysDateString()}.xlsx`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: 'attachment',
      });

      locals.hasInstallsBeforeToday.forEach((phoneNumber) => {
        const data = locals.multiInstallsString.get(phoneNumber);

        locals.messageObject.attachments.push({
          content: new Buffer(data).toString('base64'),
          fileName: `${phoneNumber}.txt`,
          type: 'text/plain',
          disposition: 'attachment',
        });
      });

      return sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
