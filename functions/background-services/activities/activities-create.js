const handleBulkObject = (conn) => {
  const csvtojsonV2 = require('csvtojson/v2');
  const path = require('path');

  const office = 'IND Innovation Private Limited';
  const templateName = 'subscription';

  // TODO: Add csv file name
  const filePath =
    path.join(process.cwd(), `file.csv`);

  console.log({ filePath });

  Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', templateName)
        .limit(1)
        .get(),
      csvtojsonV2()
        .fromFile(filePath),
    ])
    .then((result) => {
      const [
        templateQuery,
        arrayOfObjects,
      ] = result;
      const templateObject =
        templateQuery.docs[0].data();

      const myObject = {
        timestamp: Date.now(),
        geopoint: {
          latitude: 28.6998822,
          longitude: 77.2549399,
        },
        template: templateName,
        office,
        data: [],
      };

      const attachmentFieldsSet =
        new Set(Object.keys(templateObject.attachment));

      const scheduleFieldsSet = new Set();

      templateObject.schedule.forEach((field) => scheduleFieldsSet.add(field));

      // console.log({ scheduleFieldsSet });

      const venueFieldsSet = new Set();

      templateObject.venue.forEach((field) => venueFieldsSet.add(field));

      arrayOfObjects.forEach((object, index) => {
        const fields = Object.keys(object);

        const obj = {
          attachment: {},
          schedule: [],
          venue: [],
          share: [],
        };

        fields.forEach((field) => {
          if (attachmentFieldsSet.has(field)) {
            obj.attachment[field] = {
              type: templateObject.attachment[field].type,
              value: arrayOfObjects[index][field],
            };
          }

          if (scheduleFieldsSet.has(field)) {
            const ts = (() => {
              const date = arrayOfObjects[index][field];
              if (!date) return date;

              return new Date(date).getTime();
            })();

            obj.schedule.push({
              startTime: ts,
              name: field,
              endTime: ts,
            });
          }

          if (venueFieldsSet.has(field)) {
            const geopoint = (() => {
              const split =
                arrayOfObjects[index][field].split(',');

              return {
                latitude: Number(split[0]),
                longitude: Number(split[1]),
              };
            })();

            const address = (() => {
              // if (index === 0) return '#83, 1stMain, 1st Cross Near Karnataka Bank, MICO Layout BTM 2nd Stage Bangalore - 560076';
              // if (index === 1) return 'C-6, 2nd Floor, Main Market, Malviya Nagar, New Delhi - 110017';
              // if (index === 2) return '122, 1st Floor, Corporate Avenue, Sonawala Road, Goregaon East, Mumbai - 400063';
              // return '';
            })();

            const location = (() => {
              // if (index === 0) return 'Bangalore Office';
              // if (index === 1) return 'HO Malviya Nagar';
              // if (index === 2) return 'Mumbai Office';
              // return '';
            })();

            obj.venue.push({
              geopoint,
              venueDescriptor: field,
              address,
              location,
            });
          }
        });

        myObject.data.push(obj);
      });

      conn.req.body = myObject;

      console.log(JSON.stringify(myObject, ' ', 2));

      // checkAuthorizationToken(conn);

      getUserAuthFromIdToken(conn, { uid: 'qYNAtPg5cMOksMk3DF2lrk2wMFP2' });

      // sendResponse(conn, code.ok);

      return;
    })
    .catch((error) => handleError(conn, error));
};
