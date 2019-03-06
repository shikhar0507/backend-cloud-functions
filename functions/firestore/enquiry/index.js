'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  sendJSON,
  handleError,
  sendResponse,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const {
  reportNames,
} = require('../../admin/constants');

const validateBody = (body) => {
  const result = {
    isValid: true,
    message: null,
  };

  // TODO: Add validation

  return result;
};


module.exports = (conn) => {
  const validation = validateBody(conn.req.body);

  if (!validation.isValid) {
    return sendResponse(conn, code.badRequest, validation.message);
  }

  let createEnquiry = true;
  const dateObject = new Date();
  const date = dateObject.getDate();
  const month = dateObject.getMonth();
  const year = dateObject.getFullYear();

  return Promise
    .resolve()
    .then(() => Promise
      .all([
        rootCollections
          .offices
          .where('slug', '==', conn.req.body.office)
          .limit(1)
          .get(),
        rootCollections
          .recipients
          .where('office', '==', conn.req.body.office)
          .where('report', '==', reportNames.ENQUIRY)
          .limit(1)
          .get(),
      ]))
    .then((result) => {
      const [
        officeDocQuery,
        recipientsDocQuery,
      ] = result;

      if (officeDocQuery.empty) {
        createEnquiry = false;

        return sendResponse(conn, code.conflict, `Office does not exist`);
      }

      if (recipientsDocQuery.empty) {
        createEnquiry = false;

        return sendResponse(
          conn,
          code.conflict,
          `Office doesn't accept enquiry`
        );
      }

      return rootCollections
        .inits
        .where('report', '==', reportNames.ENQUIRY)
        .where('office', '==', conn.req.body.office)
        .where('date', '==', date)
        .where('month', '==', month)
        .where('year', '==', year)
        .limit(1)
        .get();
    })
    .then((snapShot) => {
      if (!createEnquiry) {
        return Promise.resolve();
      }

      const ref = (() => {
        if (snapShot.empty) {
          return rootCollections.inits.doc();
        }

        return snapShot.docs[0].ref;
      })();

      const enquiryArray = (() => {
        if (snapShot.empty) {
          return [];
        }

        return snapShot.docs[0].get('enquiryArray');
      })();

      // emailId, and enquiry
      const enquiryObject = [{
        phoneNumber: conn.requester.phoneNumber,
        companyName: conn.req.body.companyName,
        enquiryText: conn.req.body.enquiryText,
      }];

      enquiryArray.push(enquiryObject);

      return Promise
        .all([
          ref
            .set({
              date,
              month,
              year,
              enquiryArray,
              office: conn.req.body.office,
              report: reportNames.ENQUIRY,
            }, {
                merge: true,
              }),
          Promise
            .resolve(sendResponse(conn, code.noContent)),
        ]);
    })
    .catch((error) => handleError(conn, error));
};
