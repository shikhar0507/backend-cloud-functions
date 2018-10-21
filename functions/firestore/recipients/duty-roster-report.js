'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  sendGridTemplateIds,
} = require('../../admin/constants');
const {
  getPreviousDayMonth,
} = require('./report-utils');
const xlsxPopulate = require('xlsx-populate');



module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  locals.sendMail = true;
  const todaysDateString = new Date().toDateString();
  locals.messageObject.templateId = sendGridTemplateIds.dutyRoster;
  const fileName
    = `${office} Duty Roster Report_${todaysDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  locals.messageObject['dynamic_template_data'] = {
    office,
    date: todaysDateString,
    subject: `Duty Roster Report_Office_${todaysDateString}`,
  };

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .get(),
      rootCollections
        .inits
        .where('report', '==', 'duty roster')
        .where('office', '==', office)
        .where('month', '==', getPreviousDayMonth())
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocQuery,
        workbook,
      ] = result;

      if (initDocQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      const sheet1 = workbook.addSheet('Duty Roster');
      sheet1.row(1).style('bold', true);
      workbook.deleteSheet('Sheet1');

      const firstRowValues = [
        'Duty Type',
        'Description',
        'Reporting Time',
        'Reporting Location',
        'Created By',
        'Created On',
        'Status',
        'When',
        'User',
        'Place',
        'Assignees',
      ];

      const alphabets =
        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

      firstRowValues.forEach((header, index) => {
        sheet1
          .cell(`${alphabets[index]}1`)
          .value(header);
      });

      const employeesData = officeDoc.get('employeesData');
      const dutyRosterObject = initDocQuery.docs[0].get('dutyRosterObject');
      const activityIdsArray = Object.keys(dutyRosterObject);

      const promises = [];

      activityIdsArray.forEach((activityId, index) => {
        const {
          dutyType,
          description,
          reportingTime,
          reportingLocation,
          createdBy,
          createdOn,
          status,
          when,
          user,
          place,
          // assigneesString,
        } = dutyRosterObject[activityId];

        // TODO: Implement this
        const assigneesString = '';

        const columnIndex = index + 2;

        sheet1.cell(`A${columnIndex}`).value(dutyType);
        sheet1.cell(`B${columnIndex}`).value(description);
        sheet1.cell(`C${columnIndex}`).value(reportingTime);
        sheet1.cell(`D${columnIndex}`).value(reportingLocation);
        sheet1.cell(`E${columnIndex}`).value(createdBy);
        sheet1.cell(`F${columnIndex}`).value(createdOn);
        sheet1.cell(`G${columnIndex}`).value(status);
        sheet1.cell(`H${columnIndex}`).value(when);
        sheet1.cell(`I${columnIndex}`).value(user);
        sheet1.cell(`J${columnIndex}`).value(place);
        sheet1.cell(`K${columnIndex}`).value(assigneesString);
      });

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) return Promise.resolve();

      const fs = require('fs');

      locals.messageObject.attachments.push({
        fileName,
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch((error) => {
      console.error(error);
    });
};
