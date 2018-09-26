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
    firstSupervisorsName: employeeActivityDoc.firstSupervisorsName,
    secondSupervisorsName: employeeActivityDoc.secondSupervisorsName,
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

const getYesterdaysDateString = () => {
  const today = new Date();

  return new Date(today.setDate(today.getDate() - 1)).toDateString();
};

/**
 * Returns yesterday's Day start timestamp.
 * @returns {Object} JS date object of the previous day starting timestamp.
 */
const getYesterdaysStartTime = () => {
  const today = new Date();
  today.setHours(0, 0, 0);

  return new Date(today.setDate(today.getDate() - 1));
};


module.exports = (change, sgMail) => {
  const {
    cc,
    office,
    include,
    officeId,
    installsObject,
  } = change.after.data();

  /** Prevents crashes in case of data not being available */
  if (!installsObject) {
    console.log('Data not available:', {
      after: change.after.data(),
      before: change.before.data(),
    });

    return Promise.resolve();
  }

  const phoneNumbersList = Object.keys(installsObject);

  /** No data. No email... */
  if (phoneNumbersList.length === 0) {
    console.log('Empty phone numbers list:', installsObject);

    return Promise.resolve();
  }

  const locals = {
    phoneNumbersList,
    supervisorsFetch: [],
    authFetch: [],
    multiInstallsStringSet: new Map(),
    employeeDataMap: new Map(),
    csvString: `Employee Name,`
      + ` Employee Contact,`
      + ` Employee Code,`
      + ` Department,`
      + ` Installed On,`
      + ` Number Of Installs,`
      + ` First Supervisor's Name,`
      + ` Contact Number,`
      + ` Second Supervisor's Name,`
      + ` Contact Number\n`,
    hasInstallsBeforeYesterday: [],
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

  const employeeToFetch = [];
  let totalInstalls = 0;

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

    // Collecting the list of people who have multiple installs for yesterday.
    const yesterdaysStartTime = getYesterdaysStartTime().getTime();

    installs.forEach((timestamp) => {
      totalInstalls++;
      const installTime = new Date(timestamp).getTime();

      if (installTime > yesterdaysStartTime) return;

      locals.hasInstallsBeforeYesterday.push(phoneNumber);
    });

    locals
      .messageObject['dynamic_template_data']
      .totalInstalls = totalInstalls;

    locals.messageObject['dynamic_template_data']
      .extraInstalls = totalInstalls - locals.phoneNumbersList.length;
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
        const phoneNumber =
          employeeActivityDoc.get('attachment.Employee Contact.value');
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
        const phoneNumber =
          employeeActivityDoc.get('attachment.Employee Contact.value');

        locals.employeeDataMap
          .set(
            phoneNumber,
            getEmployeeDataObject(employeeActivityDoc, phoneNumber)
          );
      });

      /**
       * Time complexity here is O(n^2) but this loop probably doesn't need optimization
       * This is because per person installs will mostly be 1. So the internal loop
       * is absent for most cases. An anomaly in this assumption also causes
       * the extra attachments for the person performing multiple installs.
       * So, the office for which this person works can know.
       */
      locals.hasInstallsBeforeYesterday.forEach((phoneNumber) => {
        const installs = installsObject[phoneNumber];
        let str = 'Install Date and Time\n\n';

        installs.forEach((timestampString) => str += `${timestampString}\n`);

        locals.multiInstallsStringSet.set(phoneNumber, str);
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
        const installedOn = installsObject[phoneNumber][0];
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
          + ` ${data.employeeContact},`
          + ` ${data.employeeCode},`
          + ` ${data.department},`
          + ` ${installedOn},`
          + ` ${numberOfInstalls},`
          + ` ${firstSupervisorsName},`
          + ` ${data.firstSupervisorPhoneNumber},`
          + ` ${secondSupervisorsName},`
          + ` ${data.secondSupervisorPhoneNumber}`
          + `\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Install Report_${getYesterdaysDateString()}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      locals.hasInstallsBeforeYesterday.forEach((phoneNumber) => {
        const data = locals.multiInstallsStringSet.get(phoneNumber);

        locals.messageObject.attachments.push({
          content: new Buffer(data).toString('base64'),
          fileName: `${phoneNumber}.txt`,
          type: 'text/plain',
          disposition: 'attachment',
        });
      });

      return sgMail.sendMultiple(locals.messageObject);
    })
    .catch((error) => JSON.stringify(error));
};
