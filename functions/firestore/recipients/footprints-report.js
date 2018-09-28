'use strict';

module.exports = (locals) => {
  const {
    office,
    officeId,
    footprintsObject,
  } = locals.change.after.data();

  // if (!footprintsObject) {
  //   console.log('Footprints object not found.');

  //   return Promise.resolve();
  // }

  // const phoneNumbersList = Object.keys(footprintsObject);

  // if (phoneNumbersList.length === 0) {
  //   console.log('Footprints object empty');

  //   return Promise.resolve();
  // }

  // locals.csvString +=
  //   ` Date,`
  //   + ` Department,`
  //   + ` Employee Name,`
  //   + ` Time,`
  //   + ` Locality,`
  //   + ` City,`
  //   + ` Remark,`
  //   + ` Distance Travelled,`
  //   + ` Address`
  //   + ` \n`;

  // locals['dynamic_template_data']

  // phoneNumbersList.forEach((phoneNumber) => {

  // });

  return Promise.resolve();
};
