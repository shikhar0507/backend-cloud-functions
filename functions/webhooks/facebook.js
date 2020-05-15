/**
 * Copyright (c) 2020 GrowthFile
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

const { rootCollections,db } = require('../admin/admin');
const { activityCreator,addendumCreator } = require('../firestore/activity/helper');
const { httpsActions,subcollectionNames } = require('../admin/constants');
const env = require('../admin/env');
const momentTz = require('moment-timezone');
const rpn = require('request-promise-native');
const {Attachment,Creator}  = require('../admin/protos');

const getDataFromLead = leadData => {
  const mainData={};
  leadData.forEach(fieldObject=>{
    mainData[fieldObject.name]=fieldObject.values[0];
  });
  return mainData;
};

const getAddendumRef = officeId =>
    rootCollections.offices
        .doc(officeId)
        .collection(subcollectionNames.ADDENDUM)
        .doc();

const createOfficeFromLead = async ({leadGenId}) => {
  const token = env.fbPageToken;
  const getLeadDataUri = `https://graph.facebook.com/v7.0/${leadGenId}?access_token=${token}`;
  const responseFromGraphApi = await rpn(getLeadDataUri, {
    json: true,
    method:'GET'
  });
  const leadData = getDataFromLead(responseFromGraphApi.field_data);
  const {work_email,full_name,work_phone_number,company_name,company_address} = leadData;
  const officeCheck = await rootCollections.activities.where('template','==','office').where('office','==',company_name).limit(1).get()
  if (!officeCheck.empty) {
    // office already exists
    const batch = db.batch();
    batch.set(
        rootCollections.instant.doc(),
        {
          subject:'Office Already Exists, Facebook webhook LEADGEN',
          messageBody : `Office ${company_name} already exists, LEADGEN-ID: ${leadGenId}`
        }
    );
    return batch.commit();
  } else {
    // create the office
    const [
      {
        docs: [templateDoc],
      },
    ] = await Promise.all([
      rootCollections.activityTemplates
          .where('name', '==', 'office')
          .limit(1)
          .get(),
    ]);
    const batch = db.batch();
    const activityRef = rootCollections.activities.doc();
    const { id: activityId } = activityRef;
    const officeId = activityId;
    const creator = new Creator(work_phone_number, full_name, '').toObject();
    const timezone = 'Asia/Kolkata';

    const officeActivity = activityCreator(
        {
          attachment: new Attachment(
              {
                Name: company_name,
                'First Contact': work_phone_number,
                Timezone: timezone,
                'Registered Office Address': company_address,
                Currency: 'INR',
              },
              templateDoc.get('attachment'),
          ).toObject(),
          dateConflict:false,
          dates:[],
          venue:templateDoc.get('venue').map(venueDescriptor => ({
            venueDescriptor,
            geopoint: {
              latitude: '',
              longitude: '',
            },
            location: '',
            address: '',
          })),
          schedule:templateDoc.get('schedule').map(name => ({
            name,
            startTime: '',
            endTime: '',
          })),
          report:'type',
          timestamp:Date.now(),
          office:company_name,
          addendumDocRef:getAddendumRef(activityId),
          template:'office',
          status:templateDoc.get('statusOnCreate'),
          canEditRule:templateDoc.get('canEditRule'),
          officeId,
          activityName: `OFFICE: ${company_name}`,
          creator,
        },
        {
          isCancelled:false,
          adjustedGeopoints:'',
          relevantTime:'',
          scheduleDates:[],
          relevantTimeAndVenue:'',
          createTimestamp:Date.now(),
        },
    );

    const { date, months: month, years: year } = momentTz().toObject();
    const assignees = Array.from(
        new Set([
          work_phone_number
        ]),
        // Doing this because secondContact is optional in the request body
    ).filter(Boolean);

    const finalAddendum = addendumCreator(
        { ms_timestamp:Date.now(),
          ms_month:month,
          ms_date:date,
          ms_year:year,
          ms_action:httpsActions.create },
        {
          ms_displayName:full_name,
          ms_phoneNumber:work_phone_number,
          ms_email:work_email,
          ms_displayUrl:'',
          ms_isSupportRequest:false,
          ms_potentialSameUsers:[],
        },
        {},
        {
          ms_template:templateDoc.get('name'),
          ms_name:'',
          ms_lat:'',
          ms_long:'',
          ms_url:'',
          ms_route:'',
          ms_locality:'',
          ms_adminstrative_area_level_2:'',
          ms_adminstrative_area_level_1:'',
          ms_country:'',
          ms_postalCode:'',
        },
        0.0,
        '',
        officeActivity,
    );
    batch
        .set(activityRef, officeActivity)
        .set(officeActivity.addendumDocRef, finalAddendum);
    assignees.forEach(phoneNumber => {
      batch.set(
          activityRef.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber),
          {
            addToInclude: true,
          },
      );
    });
    await batch.commit();
  }
};

const storeEvents = async conn => {
  const { date, months: month, years: year } = momentTz().toObject();
  const ref = rootCollections.facebookEvents.doc();

  console.log('ref', ref.path);

  await ref.set({
    date,
    month,
    year,
    type: conn.req.body.object || null,
    body: conn.req.body,
    query: conn.req.query,
    receivedAt: Date.now(),
  });

  return '';
};

module.exports = async conn => {
  // This way of verifying is perhaps not correct.
  // We should store this event details somewhere and then
  // verify them in the subsequent POST request.
  // Not sure, though.
  if (
    conn.req.method === 'GET' &&
    conn.req.query['hub.verify_token'] === env.fbVerificationToken
  ) {
    return parseInt(conn.req.query['hub.challenge']);
  }

  if (conn.req.method === 'POST') {
    await storeEvents(conn);
    if (conn.req.body.entry) {
      if (Array.isArray(conn.req.body.entry) && conn.req.body.entry[0].changes[0].field==='leadgen') {
        await createOfficeFromLead({leadGenId: conn.req.body.entry[0].changes[0].value.leadgen_id});
      }
    }
  return '';
  }

  return null;
};
