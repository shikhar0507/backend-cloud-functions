'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  getAuth,
  sendResponse,
  sendJSON,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const {
  dateFormats,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');

module.exports = async conn => {
  if (conn.req.method !== 'GET') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `Method '${conn.req.method}' is not allowed. Use 'GET'`
    );
  }

  const jsonResponse = {
    pendingPayments: [],
    pendingDeposits: [],
    previousDeposits: [],
    payroll: {
      recipient: {
        assignees: [],
        status: '',
        activityId: '',
      },
    },
    reimbursement: {
      recipient: {
        assignees: [],
        status: '',
        activityId: '',
      },
    },
  };

  // payroll and reimbursements recipient docs.
  // then their auth
  // then their employee activity
  const adminOffices = ((conn.requester.customClaims || {}).admin) || [];

  if (adminOffices.length === 0
    || (conn.req.query.hasOwnProperty('office') && !adminOffices.includes(conn.req.query.office))) {
    return sendResponse(
      conn,
      code.unauthorized,
      `Not an admin account`
    );
  }

  if (adminOffices.length > 1
    && !conn.req.query.hasOwnProperty('office')) {
    return sendResponse(
      conn,
      code.badRequest,
      `Missing query param 'office' in the request URL`
    );
  }

  const office = conn.req.query.office
    || adminOffices[0];

  console.log('office', JSON.stringify(office));

  const queries = await Promise
    .all([
      rootCollections
        .offices
        .where('attachment.Name.value', '==', office)
        .limit(1)
        .get(),
      rootCollections
        .recipients
        .where('office', '==', office)
        .where('report', '==', 'payroll')
        .limit(1)
        .get(),
      rootCollections
        .recipients
        .where('office', '==', office)
        .where('report', '==', 'reimbursements')
        .limit(1)
        .get(),
    ]);

  console.log('after queries');

  const [
    officeQueryResult,
    payrollQueryResult,
    reimbursementsQueryResult,
  ] = queries;

  const officeDoc = officeQueryResult.docs[0];
  const payrollRecipientDoc = payrollQueryResult.docs[0];
  const reimbursementsDoc = reimbursementsQueryResult.docs[0];
  const authPromises = [];
  const officeAssigneMap = new Map();
  const payrollRecipients = new Set();
  const reimbursementRecipients = new Set();

  jsonResponse
    .paymentMethods = officeDoc.get('paymentMethods') || [];

  if (payrollRecipientDoc) {
    jsonResponse
      .payroll
      .recipient
      .status = payrollRecipientDoc.get('status');
    jsonResponse
      .payroll
      .recipient
      .activityId = payrollRecipientDoc.id;

    payrollRecipientDoc
      .get('include')
      .forEach(phoneNumber => {
        officeAssigneMap
          .set(
            phoneNumber,
            payrollRecipientDoc.get('office')
          );

        payrollRecipients
          .add(phoneNumber);
      });
  }

  if (reimbursementsDoc) {
    jsonResponse
      .reimbursement
      .recipient
      .status = reimbursementsDoc.get('status');

    jsonResponse
      .reimbursement
      .recipient
      .activityId = reimbursementsDoc.id;

    reimbursementsDoc
      .get('include')
      .forEach(phoneNumber => {
        officeAssigneMap
          .set(
            phoneNumber,
            reimbursementsDoc.get('office')
          );

        reimbursementRecipients
          .add(phoneNumber);
      });
  }

  const allPhoneNumbers = new Set([
    ...reimbursementRecipients.keys(),
    ...payrollRecipients.keys(),
  ]);

  const employeeQueries = [];

  allPhoneNumbers.forEach(phoneNumber => {
    const p = officeDoc
      .ref
      .collection('Activities')
      .where('template', '==', 'employee')
      .where('attachment.Employee Contact.value', '==', phoneNumber)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get();

    employeeQueries.push(p);
  });

  const employeeResults = await Promise
    .all(employeeQueries);

  const employeeSet = new Set();

  employeeResults.forEach(doc => {
    if (!doc.exists) {
      return;
    }

    employeeSet
      .add(doc.get('attachment.Employee Contact.value'));
  });

  allPhoneNumbers
    .forEach(phoneNumber => {
      authPromises
        .push(getAuth(phoneNumber));
    });

  console.log('before userRecords');

  const userRecords = await Promise
    .all(authPromises);

  console.log('after userRecords');

  userRecords
    .forEach(userRecord => {
      const office = officeAssigneMap.get(userRecord.phoneNumber);
      const authRecord = {
        office,
        phoneNumber: userRecord.phoneNumber,
        isEmployee: employeeSet.has(userRecord.phoneNumber),
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
      };

      if (payrollRecipients.has(userRecord.phoneNumber)) {
        jsonResponse
          .payroll
          .recipient
          .assignees
          .push(authRecord);
      }

      if (reimbursementRecipients.has(userRecord.phoneNumber)) {
        jsonResponse
          .reimbursement
          .recipient
          .assignees
          .push(authRecord);
      }
    });

  const timezone = officeDoc.get('attachment.Timezone.value');
  const momentNow = momentTz().tz(timezone);
  const firstDayOfMonthlyCycle = officeDoc.get('attachment.First Day Of Monthly Cycle.value');
  const fetchPreviousMonthDocs = firstDayOfMonthlyCycle > momentNow.date();

  const cycleStart = (() => {
    if (fetchPreviousMonthDocs) {
      const momentPrevMonth = momentNow
        .clone()
        .subtract(1, 'month')
        .date(firstDayOfMonthlyCycle);

      return momentNow
        .diff(momentPrevMonth, 'days');
    }

    return momentNow
      .clone()
      .startOf('month');
  })();

  const cycleEnd = momentNow;

  console.log('cycleStart', cycleStart.format(dateFormats.DATE));
  console.log('cycleEnd', cycleEnd.format(dateFormats.DATE));

  const pendingPaymentsQueryResult = await officeDoc
    .ref
    .collection('Payments')
    .where('createdAt', '>=', cycleStart.valueOf())
    .where('createdAt', '<=', cycleEnd.valueOf())
    .get();

  console.log('pendingPaymentsQueryResult', pendingPaymentsQueryResult.size);

  jsonResponse
    .pendingPayments = pendingPaymentsQueryResult
      .docs
      .map(doc => {
        return Object.assign({}, doc.data(), {
          paymentId: doc.id,
        });
      });

  jsonResponse
    .pendingDeposits = (await rootCollections
      .deposits
      .where('createdOn', '>=', cycleStart.valueOf())
      .where('createdOn', '<=', cycleEnd.valueOf())
      .get()).docs.map(doc => doc.data());

  return sendJSON(
    conn,
    jsonResponse
  );
};
