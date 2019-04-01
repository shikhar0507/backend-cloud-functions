'use strict';


const {
  rootCollections,
} = require('../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');
const {
  alphabetsArray,
} = require('../firestore/recipients/report-utils');
const env = require('../admin/env');
const xlsxPopulate = require('xlsx-populate');
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const filePath = `/tmp/employees.xlsx`;

const validateBody = (body) => {
  return {
    message: null,
    isValid: true,
  };
};

const sendEmail = (conn, locals) => {
  const messageObject = {
    to: conn.req.body.email,
    from: {
      name: 'Growthfile',
      email: env.systemEmail,
    },
    attachments: [],
    subject: `Growthfile Office Signup`,
  };

  const { templateDoc, updatesDoc, officesCreated } = locals;

  return xlsxPopulate
    .fromBlankAsync()
    .then((worksheet) => {
      let lastAlphabet;
      const {
        attachment,
        schedule,
        venue,
      } = templateDoc.data();
      const headers = []
        .concatObject
        .keys(attachment)
        .concat(schedule)
        .concat(venue);
      const employeesSheet = worksheet.addSheet('Employees');
      employeesSheet.row(1).style('bold', true);
      worksheet.deleteSheet('Sheet1');

      headers
        .forEach((value, index) => {
          const alphabet = alphabetsArray[index];

          lastAlphabet = alphabet;
          employeesSheet.cell(`${alphabet}1`).value(value);
        });

      employeesSheet.cell(`${lastAlphabet}1`).value('share');

      return worksheet.toFileAsync(filePath);
    })
    .then(() => {
      sgMail.setApiKey(env.sgMailApiKey);

      messageObject.attachments.push({
        content: fs.readFileSync(filePath).toString('base64'),
        fileName: 'employees.xlsx',
        type: 'text/csv',
        disposition: 'attachment',
      });

      officesCreated.push(conn.req.body.office);

      return Promise
        .all([
          // updatesDoc
          //   .ref
          //   .set({
          //     officesCreated,
          //   }, {
          //       merge: true,
          //     }),
          sgMail
            .sendMultiple(messageObject),
        ]);
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  const result = validateBody(conn.req.body);

  if (!result.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      result.messsage
    );
  }

  const {
    email,
    office,
    template,
  } = conn.req.body;

  return Promise
    .all([
      rootCollections
        .offices
        .where('attachment.Name.value', '==', office)
        .limit(1)
        .get(),
      rootCollections
        .updates
        .where('phoneNumber', '==', conn.requester.phoneNumber)
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', template)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        officeQuery,
        updatesQuery,
        templateQuery,
      ] = result;

      if (officeQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Office not found`
        );
      }

      if (templateQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Template not found`
        );
      }

      const locals = {
        email,
        updatesDoc: updatesQuery.docs[0],
        templateDoc: templateQuery.docs[0],
        officesCreated: updatesQuery.docs[0].get('officesCreated'),
      };

      // This person has already sent a successfuly request to 
      // create an office with the name from the same account
      if (locals.officesCreated.contains(conn.req.body.office)) {
        return sendResponse(
          conn,
          code.badRequest,
          `You have already signed up: ${conn.req.body.office}`
        );
      }

      return sendEmail(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};
