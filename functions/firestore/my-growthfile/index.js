/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const {rootCollections} = require('../../admin/admin');
const {subcollectionNames} = require('../../admin/constants');
const {
  sendJSON,
  sendResponse,
  locationFilter,
  getAuth,
} = require('../../admin/utils');
const {code} = require('../../admin/responses');

const isAnAdmin = ({office, customClaims = {}}) =>
  Array.isArray(customClaims.admin) && customClaims.admin.includes(office);

/**
 * If `query.field` is a single item, express will set it as a string.
 * We are handling an array only, so this function returns an array
 * if the field is array or returns the array with the single item.
 *
 * @param {String | Array<String>} query Query param from URL.
 * @returns {Array<String>} Fields expected in the response from the client.
 */
const getFieldQueryParam = query => {
  if (typeof query.field === 'string') {
    return [query.field];
  }

  return query.field;
};

const activityFieldsSelector = () => [
  'template',
  'status',
  'schedule',
  'venue',
  'timestamp',
  'activityName',
  'office',
  'officeId',
  'attachment',
  'hidden',
  'creator',
];

const getLocations = async ({officeId}) =>
  (
    await rootCollections.activities
      .where('officeId', '==', officeId)
      .where('template', 'in', ['customer', 'branch'])
      .where('status', '==', 'CONFIRMED')
      .get()
  ).docs.map(locationFilter);

const getRecipients = async ({officeId}) => {
  const authPromises = [];
  const phoneNumberUniques = new Set();
  const detailsFromAuth = new Map();
  const recipients = await rootCollections.recipients
    .where('officeId', '==', officeId)
    .select(...['office', 'officeId', 'include', 'cc', 'report', 'status'])
    .get();

  recipients.forEach(doc => {
    const {include = []} = doc.data();

    include.forEach(phoneNumber => {
      // This is to avoid fetching same phoneNumber's auth multiple
      // times since that is redundant and useless.
      if (phoneNumberUniques.has(phoneNumber)) {
        return;
      }

      authPromises.push(getAuth(phoneNumber));
    });
  });

  (await Promise.all(authPromises)).forEach(userRecord => {
    const {
      phoneNumber,
      uid = null,
      displayName = '',
      email = '',
      emailVerified = false,
    } = userRecord;

    detailsFromAuth.set(phoneNumber, {
      phoneNumber,
      uid,
      displayName,
      email,
      emailVerified,
    });
  });
  return recipients.docs.map(recipient => {
    const {include: assignees = []} = recipient.data();

    return Object.assign({}, recipient.data(), {
      recipientId: recipient.id,
      createTime: recipient.createTime.toMillis(),
      updateTime: recipient.updateTime.toMillis(),
      include: assignees.map(phoneNumber => detailsFromAuth.get(phoneNumber)),
    });
  });
};

const getCreatorForActivity = creator => {
  if (typeof creator === 'string') {
    return {
      phoneNumber: creator,
      displayName: '',
      email: '',
    };
  }

  return creator;
};

const activityFilter = doc =>
  Object.assign({}, doc.data(), {
    activityId: doc.id,
    creator: getCreatorForActivity(doc.get('creator')),
  });

const getTypes = async ({officeId}) =>
  (
    await rootCollections.activities
      .where('officeId', '==', officeId)
      .where('isType', '==', true)
      .select(...activityFieldsSelector())
      .get()
  ).docs.map(activityFilter);

const getRoles = async ({officeId}) => {
  const docs = await rootCollections.activities
    .where('officeId', '==', officeId)
    .where('template', 'in', ['employee', 'admin', 'subscription'])
    .select(...activityFieldsSelector())
    .get();

  const roleReducer = (prevValue, doc) => {
    const {template} = doc.data();

    prevValue[template] = prevValue[template] || [];
    prevValue[template].push(activityFilter(doc));

    return prevValue;
  };

  return docs.docs.reduce(roleReducer, {});
};

const getVouchers = async ({vouchers, officeId}) => {
  const refs = [];
  const result = [];
  const rolePromises = [];
  const beneficiaryIdUniques = new Set();
  const beneMap = new Map();

  vouchers.forEach(voucher => {
    const {beneficiaryId} = voucher.data();

    if (!beneficiaryIdUniques.has(beneficiaryId)) {
      refs.push(rootCollections.updates.doc(beneficiaryId).get());
    }

    beneficiaryIdUniques.add(beneficiaryId);
  });

  (await Promise.all(refs)).forEach(doc => {
    console.log('doc', doc);
    if (!doc.exists) {
      return;
    }

    const {phoneNumber} = doc.data();
    const {id: uid} = doc;

    beneMap.set(phoneNumber, uid);

    // This is very inefficient. We will need to iterate over the result
    // of the result of these queries and then the final object will
    // become available.
    rolePromises.push(
      rootCollections.activities
        .where('attachment.Phone Number.value', '==', phoneNumber)
        .where('officeId', '==', officeId)
        .get(),
    );
  });

  const snaps = await Promise.all(rolePromises);
  const roleMap = new Map();
  snaps.forEach(snap => {
    console.log('snap', snap.size);
    snap.forEach(doc => {
      const {template} = doc.data();
      const phoneNumber = doc.get('attachment.Phone Number.value');

      if (template !== 'admin' && template !== 'subscription') {
        const beneficiaryId = beneMap.get(phoneNumber);

        roleMap.set(beneficiaryId, activityFilter(doc));
      }
    });
  });

  vouchers.forEach(voucher => {
    const {beneficiaryId} = voucher.data();

    result.push(
      Object.assign(
        {},
        voucher.data(),
        {id: voucher.id},
        {
          roleDoc: roleMap.get(beneficiaryId) || null,
        },
      ),
    );
  });

  return result;
};

const getVouchersDepositsAndBatches = async ({officeId}) => {
  const [vouchers, deposits, batches] = await Promise.all([
    rootCollections.offices
      .doc(officeId)
      .collection(subcollectionNames.VOUCHERS)
      .where('batchId', '==', null)
      .select(
        'amount',
        'batchId',
        'beneficiaryId',
        'cycleEnd',
        'cycleStart',
        'office',
        'officeId',
        'createdAt',
        'updatedAt',
        'type',
      )
      .get(),
    rootCollections.deposits.where('officeId', '==', officeId).get(),
    rootCollections.batches.where('officeId', '==', officeId).get(),
  ]);

  const objectMapper = doc => Object.assign({}, doc.data(), {id: doc.id});

  return {
    vouchers: await getVouchers({vouchers, officeId}),
    deposits: deposits.docs.map(objectMapper),
    batches: batches.docs.map(objectMapper),
  };
};

const handleGetRequest = async conn => {
  const {office, field: expectedFields} = conn.req.query;

  if (!office) {
    return sendResponse(
      conn,
      code.badRequest,
      `Missing 'office' in query params`,
    );
  }

  if (!expectedFields && !Array.isArray(expectedFields)) {
    return sendResponse(conn, code.badRequest, `Missing query param 'field'`);
  }

  if (!isAnAdmin({office, customClaims: conn.requester.customClaims})) {
    return sendResponse(conn, code.unauthorized, `You are not an admin`);
  }

  const field = getFieldQueryParam(conn.req.query);

  const {
    /**
     * Office might not exist since we are expecting user
     * input in the office value.
     */
    docs: [{id: officeId} = {}],
  } = await rootCollections.offices
    .where('office', '==', office)
    .limit(1)
    .get();

  if (!officeId) {
    return sendResponse(
      conn,
      code.conflict,
      `No office found with the name: '${office}'`,
    );
  }

  return sendJSON(
    conn,
    Object.assign(
      {},
      {
        locations: !field.includes('locations')
          ? []
          : await getLocations({officeId}),
        recipients: !field.includes('recipients')
          ? []
          : await getRecipients({officeId}),
        types: !field.includes('types') ? [] : await getTypes({officeId}),
        roles: !field.includes('roles') ? [] : await getRoles({officeId}),
      },
      /**
       * Vouchers are sent always.
       * Optional fields are locations, recipients, types and roles.
       */
      await getVouchersDepositsAndBatches({officeId}),
    ),
  );
};

module.exports = async conn => {
  const {method} = conn.req;

  if (method === 'GET') {
    return handleGetRequest(conn);
  }

  return sendResponse(
    conn,
    code.methodNotAllowed,
    `${method} is not allowed. Use 'GET'`,
  );
};
